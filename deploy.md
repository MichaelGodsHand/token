# Stylus Contract Deployment Guide

## Prerequisites

1. Set up `.env` file with:
   ```bash
   PRIVATE_KEY=your_private_key_here
   RPC_ENDPOINT=https://sepolia-rollup.arbitrum.io/rpc
   ```

2. Ensure you have:
   - `cargo-stylus` installed
   - Rust toolchain with `wasm32-unknown-unknown` target
   - Sufficient ETH in your wallet for deployment fees

## Deployment Steps

### 1. Navigate to Contract Directory
```bash
cd /Users/sam/n8nsomnia/backend/arbitrum-stylus-contracts/YOUR_CONTRACT_NAME
```

### 2. Check Contract (Optional but Recommended)
```bash
source ../../.env
cargo stylus check --private-key="${PRIVATE_KEY}" --endpoint="${RPC_ENDPOINT}"
```

### 3. Deploy Contract
```bash
source ../../.env
cargo stylus deploy \
  --private-key="${PRIVATE_KEY}" \
  --endpoint="${RPC_ENDPOINT}" \
  --no-verify \
  --max-fee-per-gas-gwei 0.1
```

**Output:** You'll get:
- Contract address
- Deployment transaction hash
- Project metadata hash

### 4. Activate Contract
```bash
source ../../.env
cargo stylus activate CONTRACT_ADDRESS \
  --private-key="${PRIVATE_KEY}" \
  --endpoint="${RPC_ENDPOINT}" \
  --max-fee-per-gas-gwei 0.1
```

**Note:** Replace `CONTRACT_ADDRESS` with the address from step 3.

### 5. Cache Bid (Optional but Recommended)
Caching makes contract calls cheaper by storing WASM in ArbOS:

```bash
source ../../.env
cargo stylus cache-bid CONTRACT_ADDRESS \
  --private-key="${PRIVATE_KEY}" \
  --endpoint="${RPC_ENDPOINT}" \
  --max-fee-per-gas-gwei 0.1
```

### 6. Initialize Contract (If Required)
If your contract has an `init()` function, call it:

```bash
source ../../.env
cast send CONTRACT_ADDRESS \
  "init(...)" \
  --private-key "${PRIVATE_KEY}" \
  --rpc-url "${RPC_ENDPOINT}" \
  --max-fee-per-gas 0.1gwei
```

**Example for ERC-20 Token:**
```bash
cast send 0x473200e631dc83fdf6a8c48eb9e44414a90cec50 \
  "init(string,string,uint256)" \
  "MyToken" "MTK" 1000000000000000000000000 \
  --private-key "${PRIVATE_KEY}" \
  --rpc-url "${RPC_ENDPOINT}" \
  --max-fee-per-gas 0.1gwei
```

### 7. Verify Contract (Optional)
```bash
source ../../.env
cargo stylus verify CONTRACT_ADDRESS \
  --private-key="${PRIVATE_KEY}" \
  --endpoint="${RPC_ENDPOINT}"
```

## Complete Example: Deploying ERC-20 Token

```bash
# 1. Navigate to contract
cd /Users/sam/n8nsomnia/backend/arbitrum-stylus-contracts/erc20-token

# 2. Source environment
source ../../.env

# 3. Deploy
cargo stylus deploy \
  --private-key="${PRIVATE_KEY}" \
  --endpoint="${RPC_ENDPOINT}" \
  --no-verify \
  --max-fee-per-gas-gwei 0.1

# 4. Activate (replace CONTRACT_ADDRESS with actual address)
cargo stylus activate CONTRACT_ADDRESS \
  --private-key="${PRIVATE_KEY}" \
  --endpoint="${RPC_ENDPOINT}" \
  --max-fee-per-gas-gwei 0.1

# 5. Cache bid
cargo stylus cache-bid CONTRACT_ADDRESS \
  --private-key="${PRIVATE_KEY}" \
  --endpoint="${RPC_ENDPOINT}" \
  --max-fee-per-gas-gwei 0.1

# 6. Initialize
cast send CONTRACT_ADDRESS \
  "init(string,string,uint256)" \
  "MyToken" "MTK" 1000000000000000000000000 \
  --private-key "${PRIVATE_KEY}" \
  --rpc-url "${RPC_ENDPOINT}" \
  --max-fee-per-gas 0.1gwei
```

## Quick Reference: All Commands in One Place

```bash
# Setup
cd /Users/sam/n8nsomnia/backend/arbitrum-stylus-contracts/YOUR_CONTRACT
source ../../.env

# Deploy
cargo stylus deploy --private-key="${PRIVATE_KEY}" --endpoint="${RPC_ENDPOINT}" --no-verify --max-fee-per-gas-gwei 0.1

# Activate (replace ADDRESS)
cargo stylus activate ADDRESS --private-key="${PRIVATE_KEY}" --endpoint="${RPC_ENDPOINT}" --max-fee-per-gas-gwei 0.1

# Cache (replace ADDRESS)
cargo stylus cache-bid ADDRESS --private-key="${PRIVATE_KEY}" --endpoint="${RPC_ENDPOINT}" --max-fee-per-gas-gwei 0.1

# Initialize (replace ADDRESS and function signature)
cast send ADDRESS "init(...)" --private-key "${PRIVATE_KEY}" --rpc-url "${RPC_ENDPOINT}" --max-fee-per-gas 0.1gwei

# Verify (optional, replace ADDRESS)
cargo stylus verify ADDRESS --private-key="${PRIVATE_KEY}" --endpoint="${RPC_ENDPOINT}"
```

## Important Notes

1. **Gas Fees**: Adjust `--max-fee-per-gas-gwei` based on network conditions
2. **Activation**: Must be done after deployment, before contract can be used
3. **Caching**: Recommended for production to reduce call costs
4. **Initialization**: Required for contracts with `init()` functions
5. **Verification**: Optional but recommended for transparency

## Troubleshooting

- **"insufficient funds"**: Add more ETH to your wallet
- **"max fee per gas less than block base fee"**: Increase `--max-fee-per-gas-gwei`
- **"contract not activated"**: Run activation step before using contract
- **"init() failed"**: Check function signature and parameters match contract ABI