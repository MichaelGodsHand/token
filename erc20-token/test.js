#!/usr/bin/env node

/**
 * Test script for ERC-20 Token contract
 * Tests: init, name, symbol, decimals, total_supply, balance_of, transfer, approve, transfer_from, pause, unpause, mint, burn
 */

import { ethers } from 'ethers';
import { getProviderAndWallet, getContractAddress, waitForTx, testFunction } from '../test-utils.js';

// ABI for ERC-20 Token contract (hardcoded for use in other codebases)
const TOKEN_ABI = [
  "function init(string name, string symbol, uint256 initial_supply)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function pause()",
  "function unpause()",
  "function mint(address to, uint256 amount)",
  "function burn(uint256 amount)",
  "function transferOwnership(address new_owner)",
  "function balanceOfReadable(address account) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event TokenPaused(address indexed account)",
  "event TokenUnpaused(address indexed account)"
];

async function main() {
  console.log('🚀 Starting ERC-20 Token Contract Tests\n');
  console.log('='.repeat(60));

  const { provider, wallet } = getProviderAndWallet();
  const contractAddress = getContractAddress('erc20-token');
  const contract = new ethers.Contract(contractAddress, TOKEN_ABI, wallet);

  console.log(`📝 Contract Address: ${contractAddress}`);
  console.log(`👤 Test Account: ${wallet.address}\n`);

  const results = [];

  // Test 1: Get token info
  results.push(await testFunction('name()', async () => {
    const name = await contract.name();
    console.log(`  📛 Name: ${name}`);
    return name;
  }));

  results.push(await testFunction('symbol()', async () => {
    const symbol = await contract.symbol();
    console.log(`  🏷️  Symbol: ${symbol}`);
    return symbol;
  }));

  results.push(await testFunction('decimals()', async () => {
    const decimals = await contract.decimals();
    console.log(`  🔢 Decimals: ${decimals}`);
    return decimals;
  }));

  results.push(await testFunction('totalSupply()', async () => {
    const supply = await contract.totalSupply();
    console.log(`  💰 Total Supply: ${ethers.formatEther(supply)} tokens`);
    return supply;
  }));

  // Test 2: Get balance
  results.push(await testFunction('balanceOf()', async () => {
    const balance = await contract.balanceOf(wallet.address);
    console.log(`  💰 Balance: ${ethers.formatEther(balance)} tokens`);
    return balance;
  }));

  // Test 3: Transfer tokens
  const recipient = '0x6666666666666666666666666666666666666666';
  const transferAmount = ethers.parseEther('100');
  
  results.push(await testFunction('transfer()', async () => {
    const tx = await contract.transfer(recipient, transferAmount);
    await waitForTx(tx, 'Transfer');
    
    // Verify balance
    const recipientBalance = await contract.balanceOf(recipient);
    console.log(`  ✅ Recipient balance: ${ethers.formatEther(recipientBalance)} tokens`);
    return tx.hash;
  }));

  // Test 4: Approve
  const spender = '0x7777777777777777777777777777777777777777';
  const approveAmount = ethers.parseEther('50');
  
  results.push(await testFunction('approve()', async () => {
    const tx = await contract.approve(spender, approveAmount);
    await waitForTx(tx, 'Approve');
    
    // Verify allowance
    const allowance = await contract.allowance(wallet.address, spender);
    console.log(`  ✅ Allowance: ${ethers.formatEther(allowance)} tokens`);
    return tx.hash;
  }));

  // Test 5: Transfer from (using allowance)
  // transferFrom allows a third party (spender) to transfer tokens on behalf of the owner
  // Common use cases: DEX swaps, lending protocols, payment processors
  // 
  // Flow:
  // 1. Owner approves a spender address
  // 2. Spender (or anyone) calls transferFrom(owner, recipient, amount)
  // 3. Tokens move from owner to recipient, allowance is deducted
  
  // Create a wallet that will act as the spender (must be different from owner)
  // We'll use a deterministic address for testing
  const spenderPrivateKey = '0x' + '2'.repeat(64); // Different from owner's key
  const spenderWallet = new ethers.Wallet(spenderPrivateKey, provider);
  const spenderAddress = spenderWallet.address;
  const transferToRecipient = '0x9999999999999999999999999999999999999999';
  const transferFromAmount = ethers.parseEther('25');
  
  // Step 1: Owner approves the spender
  results.push(await testFunction('approve() - For transferFrom', async () => {
    const tx = await contract.approve(spenderAddress, transferFromAmount);
    await waitForTx(tx, 'Approve spender');
    
    // Verify allowance was set
    const allowance = await contract.allowance(wallet.address, spenderAddress);
    console.log(`  ✅ Allowance set: ${ethers.formatEther(allowance)} tokens`);
    return tx.hash;
  }));
  
  // Step 2: Spender calls transferFrom to move tokens from owner to recipient
  results.push(await testFunction('transferFrom()', async () => {
    // Create contract instance with the spender's wallet
    const spenderContract = new ethers.Contract(contractAddress, TOKEN_ABI, spenderWallet);
    
    // Spender transfers from owner to recipient
    // This is what DEXs, lending protocols, etc. do
    const tx = await spenderContract.transferFrom(wallet.address, transferToRecipient, transferFromAmount);
    await waitForTx(tx, 'Transfer from');
    
    // Verify tokens were transferred
    const recipientBalance = await contract.balanceOf(transferToRecipient);
    const remainingAllowance = await contract.allowance(wallet.address, spenderAddress);
    console.log(`  ✅ Recipient received: ${ethers.formatEther(recipientBalance)} tokens`);
    console.log(`  ✅ Remaining allowance: ${ethers.formatEther(remainingAllowance)} tokens`);
    return tx.hash;
  }));

  // Test 6: Pause (only owner)
  const owner = await contract.owner();
  if (owner.toLowerCase() === wallet.address.toLowerCase()) {
    results.push(await testFunction('pause()', async () => {
      const tx = await contract.pause();
      await waitForTx(tx, 'Pause');
      
      const isPaused = await contract.paused();
      console.log(`  ⏸️  Paused: ${isPaused}`);
      return tx.hash;
    }));

    // Test 7: Try transfer when paused (should fail)
    results.push(await testFunction('transfer() - When paused (should fail)', async () => {
      await contract.transfer(recipient, ethers.parseEther('1'));
    }, false));

    // Test 8: Unpause
    results.push(await testFunction('unpause()', async () => {
      const tx = await contract.unpause();
      await waitForTx(tx, 'Unpause');
      
      const isPaused = await contract.paused();
      console.log(`  ▶️  Paused: ${isPaused}`);
      return tx.hash;
    }));
  }

  // Test 9: Mint (only owner)
  if (owner.toLowerCase() === wallet.address.toLowerCase()) {
    const mintAmount = ethers.parseEther('1000');
    results.push(await testFunction('mint()', async () => {
      const tx = await contract.mint(wallet.address, mintAmount);
      await waitForTx(tx, 'Mint');
      
      const newBalance = await contract.balanceOf(wallet.address);
      console.log(`  ✅ New balance: ${ethers.formatEther(newBalance)} tokens`);
      return tx.hash;
    }));
  }

  // Test 10: Burn
  const burnAmount = ethers.parseEther('100');
  results.push(await testFunction('burn()', async () => {
    const balanceBefore = await contract.balanceOf(wallet.address);
    const tx = await contract.burn(burnAmount);
    await waitForTx(tx, 'Burn');
    
    const balanceAfter = await contract.balanceOf(wallet.address);
    console.log(`  ✅ Balance before: ${ethers.formatEther(balanceBefore)} tokens`);
    console.log(`  ✅ Balance after: ${ethers.formatEther(balanceAfter)} tokens`);
    return tx.hash;
  }));

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

