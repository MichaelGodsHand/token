const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { exec } = require("child_process");
const path = require("path");
const { ethers } = require("ethers");

dotenv.config({ path: path.join(__dirname, ".env") });

// ABI for Token Factory contract (matching register-token.js and test.js)
const TOKEN_FACTORY_ABI = [
  "function registerToken(address token_address, string name, string symbol, uint256 initial_supply)",
  "function getTotalTokensDeployed() view returns (uint256)",
  "function getAllDeployedTokens() view returns (address[])",
  "function getTokenInfo(address token_address) view returns (address, string, string, uint256, uint256)",
  "event TokenCreated(address indexed tokenAddress, address indexed creator, string name, string symbol, uint256 initialSupply, uint256 timestamp)",
];

const FACTORY_ADDRESS = "0xed088fd93517b0d0c3a3e4d2e2c419fb58570556";

const app = express();
app.use(cors());
app.use(express.json());

// Handle invalid JSON bodies gracefully
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({
      error: "Invalid JSON in request body",
      details: err.message,
    });
  }
  next(err);
});

// Helper to run a shell command and capture stdout/stderr as a Promise
function runCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    exec(
      command,
      { ...options, maxBuffer: 1024 * 1024 * 10 },
      (error, stdout, stderr) => {
        if (error) {
          return reject({ error, stdout, stderr });
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

// Try to extract a contract address from cargo-stylus deploy output
function extractContractAddress(output) {
  const regex = /(0x[a-fA-F0-9]{40})/;
  const match = output.match(regex);
  return match ? match[1] : null;
}

// POST /deploy-token
// body: { name, symbol, initialSupply, factoryAddress, privateKey (optional), rpcEndpoint (optional) }
// Note: privateKey and rpcEndpoint can be provided in request body or as environment variables
app.post("/deploy-token", async (req, res) => {
  let { name, symbol, initialSupply, factoryAddress } = req.body || {};

  // Priority: explicit body param > env var > hardcoded default
  if (!factoryAddress) {
    if (process.env.FACTORY_ADDRESS) {
      factoryAddress = process.env.FACTORY_ADDRESS;
    } else {
      factoryAddress = FACTORY_ADDRESS;
    }
  }

  if (!name || !symbol || !initialSupply) {
    return res
      .status(400)
      .json({ error: "name, symbol and initialSupply are required" });
  }

  // Get private key and RPC endpoint - priority: request body > env var
  const privateKey = req.body.privateKey || process.env.PRIVATE_KEY;
  const rpcEndpoint = req.body.rpcEndpoint || process.env.RPC_ENDPOINT;

  if (!privateKey || !rpcEndpoint) {
    return res.status(400).json({
      error:
        "PRIVATE_KEY and RPC_ENDPOINT are required (provide in request body as 'privateKey' and 'rpcEndpoint', or set as environment variables)",
    });
  }

  // Validate private key format (should be 64 hex characters, optionally with 0x prefix)
  const privateKeyClean = privateKey.startsWith("0x")
    ? privateKey.slice(2)
    : privateKey;
  if (
    privateKeyClean.length !== 64 ||
    !/^[0-9a-fA-F]+$/.test(privateKeyClean)
  ) {
    return res.status(400).json({
      error:
        "Invalid private key format. Private key must be 64 hex characters (with or without 0x prefix)",
    });
  }

  // Prepare environment variables for child processes
  const env = {
    ...process.env,
    PRIVATE_KEY: privateKey,
    RPC_ENDPOINT: rpcEndpoint,
  };

  // Directories for contracts
  const rootDir = __dirname;
  const erc20Dir = path.join(rootDir, "erc20-token");
  const factoryDir = path.join(rootDir, "token-factory");

  try {
    // 1) Deploy ERC20 contract using cargo-stylus (Linux)
    // Use a single-line command; no trailing backslashes to avoid bad args.
    const deployCmd = `
cd "${erc20Dir.replace(/\\/g, "/")}" && \
cargo stylus deploy \
  --private-key="${privateKey}" \
  --endpoint="${rpcEndpoint}" \
  --no-verify \
  --max-fee-per-gas-gwei 0.1`.trim();

    const deployShell = `bash -lc "${deployCmd.replace(/"/g, '\\"')}"`;

    const deployResult = await runCommand(deployShell, { cwd: rootDir, env });
    const deployOutput = `${deployResult.stdout}\n${deployResult.stderr}`;

    const tokenAddress = extractContractAddress(deployOutput);
    if (!tokenAddress) {
      return res.status(500).json({
        error:
          "Failed to parse deployed token contract address from deploy output",
        deployOutput,
      });
    }

    // 2) Activate the deployed token
    // cargo-stylus expects the address via --address
    const activateCmd = `
cd "${erc20Dir.replace(/\\/g, "/")}" && \
cargo stylus activate \
  --address ${tokenAddress} \
  --private-key="${privateKey}" \
  --endpoint="${rpcEndpoint}" \
  --max-fee-per-gas-gwei 0.1`.trim();

    const activateShell = `bash -lc "${activateCmd.replace(/"/g, '\\"')}"`;
    let activateResult;
    try {
      activateResult = await runCommand(activateShell, { cwd: rootDir, env });
    } catch (e) {
      const stderr = e.stderr || "";
      // If the program is already activated, cargo-stylus returns ProgramUpToDate().
      // Treat that as a non-fatal condition and continue.
      if (stderr.includes("ProgramUpToDate")) {
        activateResult = { stdout: "", stderr };
      } else {
        throw e;
      }
    }

    // 3) Cache-bid (optional but recommended)
    const cacheCmd = `
cd "${erc20Dir.replace(/\\/g, "/")}" && \
cargo stylus cache bid \
  ${tokenAddress} 1 \
  --private-key="${privateKey}" \
  --endpoint="${rpcEndpoint}" \
  --max-fee-per-gas-gwei 0.1`.trim();

    const cacheShell = `bash -lc "${cacheCmd.replace(/"/g, '\\"')}"`;
    let cacheResult;
    try {
      cacheResult = await runCommand(cacheShell, { cwd: rootDir, env });
    } catch (e) {
      const stderr = e.stderr || "";
      // If the contract is already cached, treat as non-fatal and continue.
      if (stderr.includes("already cached")) {
        cacheResult = { stdout: "", stderr };
      } else {
        throw e;
      }
    }

    // 4) Initialize token via cast send
    // initialSupply is passed as human-readable whole units, contract multiplies by 10^18
    // Gas pricing is handled automatically by cast send
    const initCmd = `
cd "${erc20Dir.replace(/\\/g, "/")}" && \
cast send \
  --private-key="${privateKey}" \
  --rpc-url "${rpcEndpoint}" \
  ${tokenAddress} \
  "init(string,string,uint256)" \
  "${name}" "${symbol}" ${initialSupply}`.trim();

    const initShell = `bash -lc "${initCmd.replace(/"/g, '\\"')}"`;
    const initResult = await runCommand(initShell, { cwd: rootDir, env });

    // Wait briefly for initialization transaction to be submitted
    // Arbitrum is fast, but we just need to ensure the transaction is in the mempool
    // Don't wait for full confirmation - registration can proceed once tx is submitted
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 5) Register token in TokenFactory - REQUIRED
    if (!factoryAddress) {
      throw new Error("factoryAddress is required for token registration");
    }

    // Ensure factory contract is activated (Stylus contracts need activation)
    // Run this in parallel/non-blocking - if it fails, we'll catch it during registration
    const factoryActivateCmd = `
cd "${factoryDir.replace(/\\/g, "/")}" && \
cargo stylus activate \
  --address ${factoryAddress} \
  --private-key="${privateKey}" \
  --endpoint="${rpcEndpoint}" \
  --max-fee-per-gas-gwei 0.1`.trim();

    const factoryActivateShell = `bash -lc "${factoryActivateCmd.replace(
      /"/g,
      '\\"'
    )}"`;

    // Don't wait for activation - run it but don't block on it
    // If factory isn't activated, registration will fail with a clear error
    runCommand(factoryActivateShell, { cwd: rootDir, env }).catch((e) => {
      const stderr = e.stderr || "";
      // Only log if it's a real error (not "already activated")
      if (
        !stderr.includes("ProgramUpToDate") &&
        !stderr.includes("already activated")
      ) {
        console.warn("Factory activation check:", stderr.substring(0, 200));
      }
    });

    // Quick factory contract verification (non-blocking, timeout after 5 seconds)
    const codeCheckCmd =
      `cast code ${factoryAddress} --rpc-url "${rpcEndpoint}"`.trim();
    try {
      const codeCheckShell = `bash -lc "${codeCheckCmd.replace(/"/g, '\\"')}"`;
      const codeResult = await Promise.race([
        runCommand(codeCheckShell, { cwd: rootDir, env }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Code check timeout")), 5000)
        ),
      ]);
      const codeOutput = `${codeResult.stdout}\n${codeResult.stderr}`.trim();
      // Check if code is empty or just "0x"
      if (!codeOutput || codeOutput === "0x" || codeOutput.length <= 2) {
        throw new Error(
          `Factory contract has no code at address ${factoryAddress}. Contract may not be deployed.`
        );
      }
    } catch (err) {
      // If verification fails or times out, log but continue - registration will fail with better error
      console.warn("Factory verification skipped:", err.message || "timeout");
    }

    // Check if token is already registered using ethers.js (like register-token.js)
    try {
      const provider = new ethers.JsonRpcProvider(rpcEndpoint);
      const factoryContract = new ethers.Contract(
        factoryAddress,
        TOKEN_FACTORY_ABI,
        provider
      );

      const existingTokens = await factoryContract.getAllDeployedTokens();
      const isAlreadyRegistered = existingTokens.some(
        (addr) => addr.toLowerCase() === tokenAddress.toLowerCase()
      );

      if (isAlreadyRegistered) {
        console.log(
          "Token is already registered in factory - skipping registration"
        );
        // Return success since token is already registered
        return res.json({
          tokenAddress,
          deployOutput,
          activateOutput: `${activateResult.stdout}\n${activateResult.stderr}`,
          cacheOutput: `${cacheResult.stdout}\n${cacheResult.stderr}`,
          initOutput: `${initResult.stdout}\n${initResult.stderr}`,
          registerOutput: "Token already registered - skipped",
          success: true,
          message: "Token deployed and already registered in factory",
          alreadyRegistered: true,
        });
      }
    } catch (checkErr) {
      // If check fails, continue anyway - registration will fail if already registered
      console.warn(
        "Could not verify registration status, proceeding:",
        checkErr.message
      );
    }

    // Skip token verification - it's slow and we just deployed it, so it should exist
    // Registration will fail fast with a clear error if token doesn't exist

    // Try to simulate the call first to get better error messages
    // Note: cast call can't simulate state-changing functions, but we can try to check if the function exists
    // Instead, let's verify the token is ready and parameters are valid
    console.log(
      `Attempting to register token: ${tokenAddress} with name "${name}", symbol "${symbol}", supply ${initialSupply}`
    );

    // Validate parameters match contract requirements
    if (
      !tokenAddress ||
      tokenAddress === "0x0000000000000000000000000000000000000000"
    ) {
      throw new Error("Invalid token address: cannot be zero address");
    }
    if (!name || name.trim().length === 0) {
      throw new Error("Invalid name: cannot be empty");
    }
    if (!symbol || symbol.trim().length === 0) {
      throw new Error("Invalid symbol: cannot be empty");
    }
    if (!initialSupply || initialSupply === 0) {
      throw new Error("Invalid initial supply: cannot be zero");
    }

    // Skip cast run simulation - it's VERY slow (can take minutes) and not necessary
    // The actual registration will provide clear errors if something is wrong

    // Perform the actual registration using ethers.js (like register-token.js)
    // IMPORTANT: The factory expects initialSupply in wei (like the token's totalSupply)
    // Convert human-readable supply to wei (multiply by 10^18)
    const initialSupplyWei = ethers.parseEther(initialSupply.toString());

    try {
      // Setup provider and wallet using ethers.js
      const provider = new ethers.JsonRpcProvider(rpcEndpoint);
      const wallet = new ethers.Wallet(privateKey, provider);
      const factoryContract = new ethers.Contract(
        factoryAddress,
        TOKEN_FACTORY_ABI,
        wallet
      );

      console.log("Sending registration transaction...");

      // Call registerToken (camelCase as per test.js and register-token.js)
      const tx = await factoryContract.registerToken(
        tokenAddress,
        name,
        symbol,
        initialSupplyWei
      );

      console.log(`Transaction hash: ${tx.hash}`);

      // Wait for transaction confirmation
      const receipt = await tx.wait();
      console.log(`Registration confirmed in block ${receipt.blockNumber}`);

      // Try to get TokenCreated event
      let eventInfo = null;
      try {
        const filter = factoryContract.filters.TokenCreated();
        const events = await factoryContract.queryFilter(
          filter,
          receipt.blockNumber
        );
        if (events.length > 0) {
          eventInfo = {
            tokenAddress: events[0].args.tokenAddress,
            creator: events[0].args.creator,
            name: events[0].args.name,
            symbol: events[0].args.symbol,
            initialSupply: ethers.formatEther(events[0].args.initialSupply),
          };
        }
      } catch (eventErr) {
        console.warn("Could not retrieve event:", eventErr.message);
      }

      const registerResult = {
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        event: eventInfo,
      };

      return res.json({
        tokenAddress,
        deployOutput,
        activateOutput: `${activateResult.stdout}\n${activateResult.stderr}`,
        cacheOutput: `${cacheResult.stdout}\n${cacheResult.stderr}`,
        initOutput: `${initResult.stdout}\n${initResult.stderr}`,
        registerOutput: JSON.stringify(registerResult, null, 2),
        success: true,
        message: "Token deployed and registered successfully",
      });
    } catch (err) {
      console.error("Token registration failed:", err.message);

      // Provide detailed error information
      let errorMsg = err.message;
      if (err.reason) {
        errorMsg += ` (Reason: ${err.reason})`;
      }

      // Check if it's because token is already registered
      const errorLower = errorMsg.toLowerCase();
      if (errorLower.includes("revert") || errorLower.includes("require")) {
        errorMsg +=
          "\nPossible causes:\n" +
          "1. Token already registered in factory\n" +
          "2. Invalid parameters (empty name/symbol, zero supply, zero address)\n" +
          "3. Factory contract not properly activated\n" +
          "4. Token contract not fully initialized";
      }

      throw new Error(
        `Token registration FAILED (required step). ` +
          `Factory: ${factoryAddress}, Token: ${tokenAddress}, ` +
          `Name: "${name}", Symbol: "${symbol}", Supply: ${initialSupply}. ` +
          `Error: ${errorMsg}`
      );
    }

    return res.json({
      tokenAddress,
      deployOutput,
      activateOutput: `${activateResult.stdout}\n${activateResult.stderr}`,
      cacheOutput: `${cacheResult.stdout}\n${cacheResult.stderr}`,
      initOutput: `${initResult.stdout}\n${initResult.stderr}`,
      registerOutput: `${registerResult.stdout}\n${registerResult.stderr}`,
      success: true,
      message: "Token deployed and registered successfully",
    });
  } catch (err) {
    console.error("Deployment error:", err);
    return res.status(500).json({
      error: "Deployment flow failed",
      details: {
        message: err.error ? err.error.message : String(err),
        stdout: err.stdout,
        stderr: err.stderr,
      },
    });
  }
});

// Health check endpoint for Cloud Run
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Deployment API server running on port ${PORT}`);
});
