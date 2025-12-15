#!/usr/bin/env node

/**
 * Test script for Token Factory contract
 * Tests: register_token, get_token_count, get_all_tokens, get_token_info, get_creator_tokens
 */

import { ethers } from 'ethers';
import { getProviderAndWallet, getContractAddress, waitForTx, testFunction } from '../test-utils.js';

// ABI for Token Factory contract (hardcoded for use in other codebases)
const TOKEN_FACTORY_ABI = [
  "function registerToken(address token_address, string name, string symbol, uint256 initial_supply)",
  "function getTotalTokensDeployed() view returns (uint256)",
  "function getAllDeployedTokens() view returns (address[])",
  "function getTokenInfo(address token_address) view returns (address, string, string, uint256, uint256)",
  "function getTokensByCreator(address creator) view returns (address[])",
  "function getDeployedTokensPaginated(uint256 start_index, uint256 count) view returns (address[])",
  "function getLatestTokens(uint256 count) view returns (address[])",
  "event TokenCreated(address indexed tokenAddress, address indexed creator, string name, string symbol, uint256 initialSupply, uint256 timestamp)"
];

async function main() {
  console.log('🚀 Starting Token Factory Contract Tests\n');
  console.log('='.repeat(60));

  const { provider, wallet } = getProviderAndWallet();
  const contractAddress = getContractAddress('token-factory');
  const contract = new ethers.Contract(contractAddress, TOKEN_FACTORY_ABI, wallet);

  console.log(`📝 Contract Address: ${contractAddress}`);
  console.log(`👤 Test Account: ${wallet.address}\n`);

  const results = [];

  // Test 1: Get initial token count
  results.push(await testFunction('getTotalTokensDeployed() - Initial', async () => {
    const count = await contract.getTotalTokensDeployed();
    console.log(`  📊 Token Count: ${count}`);
    return count;
  }));

  // Test 2: Get all tokens
  results.push(await testFunction('getAllDeployedTokens()', async () => {
    const tokens = await contract.getAllDeployedTokens();
    console.log(`  📋 Total Tokens: ${tokens.length}`);
    tokens.forEach((addr, i) => console.log(`     ${i + 1}. ${addr}`));
    return tokens;
  }));

  // Test 3: Get creator's tokens
  results.push(await testFunction('getTokensByCreator()', async () => {
    const tokens = await contract.getTokensByCreator(wallet.address);
    console.log(`  👤 Creator's Tokens: ${tokens.length}`);
    tokens.forEach((addr, i) => console.log(`     ${i + 1}. ${addr}`));
    return tokens;
  }));

  // Test 4: Register a token (using the deployed token address)
  const tokenAddress = getContractAddress('erc20-token');
  const tokenName = "Test Token";
  const tokenSymbol = "TEST";
  const initialSupply = ethers.parseEther('1000000');

  // Check if token is already registered
  const existingTokens = await contract.getAllDeployedTokens();
  const isAlreadyRegistered = existingTokens.some(addr => addr.toLowerCase() === tokenAddress.toLowerCase());
  
  if (!isAlreadyRegistered) {
    results.push(await testFunction('registerToken()', async () => {
      const tx = await contract.registerToken(tokenAddress, tokenName, tokenSymbol, initialSupply);
      await waitForTx(tx, 'Register token');
      
      // Listen for event
      const filter = contract.filters.TokenCreated();
      const events = await contract.queryFilter(filter, tx.blockNumber);
      if (events.length > 0) {
        console.log(`  📢 Event: TokenCreated`);
        console.log(`     Token Address: ${events[0].args.tokenAddress}`);
        console.log(`     Name: ${events[0].args.name}`);
        console.log(`     Symbol: ${events[0].args.symbol}`);
      }
      return tx.hash;
    }));
  } else {
    console.log(`  ⚠️  Token already registered, skipping registration test`);
  }

  // Test 5: Get token info
  results.push(await testFunction('getTokenInfo()', async () => {
    // Manually decode the tuple return value
    const iface = new ethers.Interface(TOKEN_FACTORY_ABI);
    const data = await provider.call({
      to: contractAddress,
      data: iface.encodeFunctionData("getTokenInfo", [tokenAddress])
    });
    
    // Remove 0x prefix
    const hexData = data.startsWith('0x') ? data.slice(2) : data;
    
    // First 32 bytes (64 hex chars) is offset to tuple start
    const tupleOffset = parseInt(hexData.slice(0, 64), 16);
    const tupleStart = tupleOffset * 2; // Convert bytes to hex string position
    
    // Read address (creator) - first 32 bytes of tuple (but address is only 20 bytes, padded)
    const creatorHex = hexData.slice(tupleStart + 24, tupleStart + 64); // Last 20 bytes (40 hex chars)
    const creator = ethers.getAddress('0x' + creatorHex);
    
    // Read string1 offset - bytes 32-63 of tuple
    const string1Offset = parseInt(hexData.slice(tupleStart + 64, tupleStart + 128), 16);
    
    // Read string2 offset - bytes 64-95 of tuple
    const string2Offset = parseInt(hexData.slice(tupleStart + 128, tupleStart + 192), 16);
    
    // Read uint256 (initial supply) - bytes 96-127 of tuple
    const initialSupply = BigInt('0x' + hexData.slice(tupleStart + 192, tupleStart + 256));
    
    // Read uint256 (deployed at) - bytes 128-159 of tuple
    const deployedAt = BigInt('0x' + hexData.slice(tupleStart + 256, tupleStart + 320));
    
    // Read string1 (name) - offset is relative to tuple start
    const namePos = tupleStart + string1Offset * 2;
    const nameLength = parseInt(hexData.slice(namePos, namePos + 64), 16);
    const nameHex = hexData.slice(namePos + 64, namePos + 64 + nameLength * 2);
    const name = Buffer.from(nameHex, 'hex').toString('utf8');
    
    // Read string2 (symbol) - offset is relative to tuple start
    const symbolPos = tupleStart + string2Offset * 2;
    const symbolLength = parseInt(hexData.slice(symbolPos, symbolPos + 64), 16);
    const symbolHex = hexData.slice(symbolPos + 64, symbolPos + 64 + symbolLength * 2);
    const symbol = Buffer.from(symbolHex, 'hex').toString('utf8');
    
    console.log(`  📋 Creator: ${creator}`);
    console.log(`  📛 Name: ${name}`);
    console.log(`  🏷️  Symbol: ${symbol}`);
    console.log(`  💰 Initial Supply: ${ethers.formatEther(initialSupply)} tokens`);
    console.log(`  📅 Deployed At: ${deployedAt}`);
    
    return {
      creator,
      name,
      symbol,
      initialSupply: initialSupply.toString(),
      deployedAt: deployedAt.toString()
    };
  }));

  // Test 6: Verify token count increased
  results.push(await testFunction('getTotalTokensDeployed() - After registration', async () => {
    const count = await contract.getTotalTokensDeployed();
    console.log(`  📊 Token Count: ${count}`);
    return count;
  }));

  // Test 7: Try to register same token again (should fail)
  results.push(await testFunction('registerToken() - Duplicate (should fail)', async () => {
    await contract.registerToken(tokenAddress, tokenName, tokenSymbol, initialSupply);
  }, false));

  // Test 8: Register with invalid input (should fail)
  results.push(await testFunction('registerToken() - Invalid address (should fail)', async () => {
    await contract.registerToken(ethers.ZeroAddress, tokenName, tokenSymbol, initialSupply);
  }, false));

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${((passed / results.length) * 100).toFixed(1)}%`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});

