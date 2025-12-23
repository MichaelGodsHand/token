# Multi-stage Dockerfile for Stylus Token Deployment Service
# Stage 1: Build Rust contracts
FROM rust:1.80-slim as rust-builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Set up Rust environment
ENV CARGO_HOME=/usr/local/cargo
ENV PATH=$CARGO_HOME/bin:$PATH

# Install wasm32-unknown-unknown target
RUN rustup target add wasm32-unknown-unknown

# Install cargo-stylus
RUN cargo install cargo-stylus
RUN cargo stylus -V

# Install Foundry
RUN curl -L https://foundry.paradigm.xyz | bash
ENV PATH="/root/.foundry/bin:${PATH}"
RUN foundryup
RUN cast --version

# Copy Rust project files
WORKDIR /workspace
COPY erc20-token/ ./erc20-token/
COPY token-factory/ ./token-factory/

# Build contracts (pre-compile for faster startup)
WORKDIR /workspace/erc20-token
RUN cargo build --target wasm32-unknown-unknown --release

WORKDIR /workspace/token-factory
RUN cargo build --target wasm32-unknown-unknown --release

# Stage 2: Node.js runtime
FROM node:20-slim

# Install runtime dependencies for Rust/Foundry tools
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    pkg-config \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Rust toolchain
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install wasm32-unknown-unknown target
RUN rustup target add wasm32-unknown-unknown

# Install cargo-stylus
RUN cargo install cargo-stylus

# Install Foundry
RUN curl -L https://foundry.paradigm.xyz | bash
ENV PATH="/root/.foundry/bin:${PATH}"
RUN foundryup

# Set working directory
WORKDIR /workspace

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application code
COPY server.js ./

# Copy Rust contracts from builder stage
COPY --from=rust-builder /workspace/erc20-token ./erc20-token
COPY --from=rust-builder /workspace/token-factory ./token-factory

# Copy Rust toolchain configs
COPY erc20-token/rust-toolchain.toml ./erc20-token/
COPY token-factory/rust-toolchain.toml ./token-factory/

# Expose port (Cloud Run uses PORT env var)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:${PORT:-8080}/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# Start the server
CMD ["node", "server.js"]

