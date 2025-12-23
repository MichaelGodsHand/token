# Multi-stage Dockerfile for Stylus Token Deployment Service
# Stage 1: Build Rust contracts
# Use latest stable Rust for cargo-stylus compatibility
FROM rust:latest as rust-builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Set up Rust environment
ENV CARGO_HOME=/usr/local/cargo
ENV PATH=$CARGO_HOME/bin:$PATH

# Install Rust 1.80.0 toolchain (as specified in rust-toolchain.toml)
# but keep latest for cargo-stylus installation
RUN rustup toolchain install 1.80.0-x86_64-unknown-linux-gnu
RUN rustup target add wasm32-unknown-unknown --toolchain 1.80.0-x86_64-unknown-linux-gnu

# Install wasm32-unknown-unknown target for default toolchain (for cargo-stylus)
RUN rustup target add wasm32-unknown-unknown

# Install cargo-stylus using latest Rust toolchain
RUN cargo install cargo-stylus
RUN cargo stylus -V

# Install Foundry
RUN curl -L https://foundry.paradigm.xyz | bash
ENV PATH="/root/.foundry/bin:${PATH}"
RUN /root/.foundry/bin/foundryup
RUN cast --version

# Copy Rust project files
WORKDIR /workspace
COPY erc20-token/ ./erc20-token/
COPY token-factory/ ./token-factory/

# Build contracts (pre-compile for faster startup)
# Use Rust 1.80.0 as specified in rust-toolchain.toml
WORKDIR /workspace/erc20-token
RUN rustup default 1.80.0-x86_64-unknown-linux-gnu
RUN cargo build --target wasm32-unknown-unknown --release

WORKDIR /workspace/token-factory
RUN cargo build --target wasm32-unknown-unknown --release

# Stage 2: Node.js runtime
# Use full node:20 image instead of slim to ensure GLIBC compatibility with cargo-stylus
FROM node:20

# Install runtime dependencies for Rust/Foundry tools
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    pkg-config \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Rust toolchain (latest stable for cargo-stylus)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Rust 1.80.0 toolchain (as specified in rust-toolchain.toml)
RUN rustup toolchain install 1.80.0-x86_64-unknown-linux-gnu
RUN rustup target add wasm32-unknown-unknown --toolchain 1.80.0-x86_64-unknown-linux-gnu

# Install wasm32-unknown-unknown target for default toolchain
RUN rustup target add wasm32-unknown-unknown

# Install cargo-stylus using latest Rust toolchain
RUN cargo install cargo-stylus

# Install Foundry
RUN curl -L https://foundry.paradigm.xyz | bash
ENV PATH="/root/.foundry/bin:${PATH}"
RUN /root/.foundry/bin/foundryup

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

# Copy Foundry binaries from builder stage
# Note: cargo-stylus is installed in this stage (line 76) to ensure GLIBC compatibility
COPY --from=rust-builder /root/.foundry /root/.foundry

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

