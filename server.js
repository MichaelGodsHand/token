const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { exec } = require('child_process');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const FACTORY_ADDRESS = '0xed088fd93517b0d0c3a3e4d2e2c419fb58570556';

const app = express();
app.use(cors());
app.use(express.json());

// Handle invalid JSON bodies gracefully
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      error: 'Invalid JSON in request body',
      details: err.message,
    });
  }
  next(err);
});

// Helper to run a shell command and capture stdout/stderr as a Promise
function runCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    exec(command, { ...options, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        return reject({ error, stdout, stderr });
      }
      resolve({ stdout, stderr });
    });
  });
}

// Try to extract a contract address from cargo-stylus deploy output
function extractContractAddress(output) {
  const regex = /(0x[a-fA-F0-9]{40})/;
  const match = output.match(regex);
  return match ? match[1] : null;
}

// POST /deploy-token
// body: { name, symbol, initialSupply, factoryAddress }
app.post('/deploy-token', async (req, res) => {
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
    return res.status(400).json({ error: 'name, symbol and initialSupply are required' });
  }

  if (!process.env.PRIVATE_KEY || !process.env.RPC_ENDPOINT) {
    return res.status(500).json({
      error: 'PRIVATE_KEY and RPC_ENDPOINT must be set in .env at project root',
    });
  }

  // Directories for contracts
  const rootDir = __dirname;
  const erc20Dir = path.join(rootDir, 'erc20-token');
  const factoryDir = path.join(rootDir, 'token-factory');

  try {
    // 1) Deploy ERC20 contract using cargo-stylus (Linux)
    // Use a single-line command; no trailing backslashes to avoid bad args.
    const deployCmd = `
cd "${erc20Dir.replace(/\\/g, '/')}" && \
source ../../.env && \
cargo stylus deploy \
  --private-key="$PRIVATE_KEY" \
  --endpoint="$RPC_ENDPOINT" \
  --no-verify \
  --max-fee-per-gas-gwei 0.1`.trim();

    const deployShell = `bash -lc "${deployCmd.replace(/"/g, '\\"')}"`;

    const deployResult = await runCommand(deployShell, { cwd: rootDir });
    const deployOutput = `${deployResult.stdout}\n${deployResult.stderr}`;

    const tokenAddress = extractContractAddress(deployOutput);
    if (!tokenAddress) {
      return res.status(500).json({
        error: 'Failed to parse deployed token contract address from deploy output',
        deployOutput,
      });
    }

    // 2) Activate the deployed token
    // cargo-stylus expects the address via --address
    const activateCmd = `
cd "${erc20Dir.replace(/\\/g, '/')}" && \
source ../../.env && \
cargo stylus activate \
  --address ${tokenAddress} \
  --private-key="$PRIVATE_KEY" \
  --endpoint="$RPC_ENDPOINT" \
  --max-fee-per-gas-gwei 0.1`.trim();

    const activateShell = `bash -lc "${activateCmd.replace(/"/g, '\\"')}"`;
    let activateResult;
    try {
      activateResult = await runCommand(activateShell, { cwd: rootDir });
    } catch (e) {
      const stderr = e.stderr || '';
      // If the program is already activated, cargo-stylus returns ProgramUpToDate().
      // Treat that as a non-fatal condition and continue.
      if (stderr.includes('ProgramUpToDate')) {
        activateResult = { stdout: '', stderr };
      } else {
        throw e;
      }
    }

    // 3) Cache-bid (optional but recommended)
    const cacheCmd = `
cd "${erc20Dir.replace(/\\/g, '/')}" && \
source ../../.env && \
cargo stylus cache bid \
  ${tokenAddress} 1 \
  --private-key="$PRIVATE_KEY" \
  --endpoint="$RPC_ENDPOINT" \
  --max-fee-per-gas-gwei 0.1`.trim();

    const cacheShell = `bash -lc "${cacheCmd.replace(/"/g, '\\"')}"`;
    let cacheResult;
    try {
      cacheResult = await runCommand(cacheShell, { cwd: rootDir });
    } catch (e) {
      const stderr = e.stderr || '';
      // If the contract is already cached, treat as non-fatal and continue.
      if (stderr.includes('already cached')) {
        cacheResult = { stdout: '', stderr };
      } else {
        throw e;
      }
    }

    // 4) Initialize token via cast send
    // initialSupply is passed as human-readable whole units, contract multiplies by 10^18
    const initCmd = `
cd "${erc20Dir.replace(/\\/g, '/')}" && \
source ../../.env && \
cast send \
  --private-key="$PRIVATE_KEY" \
  --rpc-url "$RPC_ENDPOINT" \
  ${tokenAddress} \
  "init(string,string,uint256)" \
  "${name}" "${symbol}" ${initialSupply}`.trim();

    const initShell = `bash -lc "${initCmd.replace(/"/g, '\\"')}"`;
    const initResult = await runCommand(initShell, { cwd: rootDir });

    // 5) Register token in TokenFactory if factoryAddress is provided
    let registerResult = null;
    if (factoryAddress) {
      const registerCmd = `
cd "${factoryDir.replace(/\\/g, '/')}" && \
source ../../.env && \
cast send \
  --private-key="$PRIVATE_KEY" \
  --rpc-url "$RPC_ENDPOINT" \
  ${factoryAddress} \
  "register_token(address,string,string,uint256)" \
  ${tokenAddress} "${name}" "${symbol}" ${initialSupply}`.trim();

      const registerShell = `bash -lc "${registerCmd.replace(/"/g, '\\"')}"`;
      registerResult = await runCommand(registerShell, { cwd: rootDir });
    }

    return res.json({
      tokenAddress,
      deployOutput,
      activateOutput: `${activateResult.stdout}\n${activateResult.stderr}`,
      cacheOutput: `${cacheResult.stdout}\n${cacheResult.stderr}`,
      initOutput: `${initResult.stdout}\n${initResult.stderr}`,
      registerOutput: registerResult
        ? `${registerResult.stdout}\n${registerResult.stderr}`
        : null,
    });
  } catch (err) {
    console.error('Deployment error:', err);
    return res.status(500).json({
      error: 'Deployment flow failed',
      details: {
        message: err.error ? err.error.message : String(err),
        stdout: err.stdout,
        stderr: err.stderr,
      },
    });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Deployment API server running on port ${PORT}`);
});


