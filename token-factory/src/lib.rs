// SPDX-License-Identifier: MIT
#![cfg_attr(not(feature = "export-abi"), no_main)]

extern crate alloc;

use alloy_primitives::{Address, U256};
use alloy_sol_types::sol;
use stylus_sdk::{prelude::*, msg, block, evm};

// Declare Solidity error types
sol! {
    error InvalidInput();
    error TokenNotFound();
}

/// Represents the ways methods may fail.
#[derive(SolidityError)]
pub enum FactoryError {
    InvalidInput(InvalidInput),
    TokenNotFound(TokenNotFound),
}

// Declare Solidity event types
sol! {
    event TokenCreated(
        address indexed tokenAddress,
        address indexed creator,
        string name,
        string symbol,
        uint256 initialSupply,
        uint256 timestamp
    );
}

sol_storage! {
    #[entrypoint]
    pub struct TokenFactory {
        address[] deployed_tokens;
        mapping(address => address[]) creator_to_tokens;
        mapping(address => TokenInfo) token_info;
    }
}

sol_storage! {
    pub struct TokenInfo {
        address token_address;
        address creator;
        string name;
        string symbol;
        uint256 initial_supply;
        uint256 deployed_at;
    }
}

#[public]
impl TokenFactory {
    /// Register a token that was deployed externally
    /// Note: Actual token deployment should be done via cargo-stylus
    /// This function registers the token address and metadata
    pub fn register_token(
        &mut self,
        token_address: Address,
        name: String,
        symbol: String,
        initial_supply: U256,
    ) -> Result<(), FactoryError> {
        if token_address == Address::ZERO {
            return Err(FactoryError::InvalidInput(InvalidInput {}));
        }
        if name.is_empty() || symbol.is_empty() {
            return Err(FactoryError::InvalidInput(InvalidInput {}));
        }
        if initial_supply == U256::ZERO {
            return Err(FactoryError::InvalidInput(InvalidInput {}));
        }

        let creator = msg::sender();
        let timestamp = U256::from(block::timestamp());

        // Check if token already registered
        let existing_info = self.token_info.getter(token_address);
        if existing_info.token_address.get() != Address::ZERO {
            return Err(FactoryError::InvalidInput(InvalidInput {}));
        }

        // Store token information
        let mut info = self.token_info.setter(token_address);
        info.token_address.set(token_address);
        info.creator.set(creator);
        info.name.set_str(name.clone());
        info.symbol.set_str(symbol.clone());
        info.initial_supply.set(initial_supply);
        info.deployed_at.set(timestamp);

        // Add to deployed tokens array
        self.deployed_tokens.push(token_address);

        // Add to creator's token list
        self.creator_to_tokens.setter(creator).push(token_address);

        evm::log(TokenCreated {
            tokenAddress: token_address,
            creator,
            name,
            symbol,
            initialSupply: initial_supply,
            timestamp,
        });

        Ok(())
    }

    /// Get total number of tokens deployed
    pub fn get_total_tokens_deployed(&self) -> Result<U256, FactoryError> {
        Ok(U256::from(self.deployed_tokens.len()))
    }

    /// Get all deployed token addresses
    pub fn get_all_deployed_tokens(&self) -> Result<Vec<Address>, FactoryError> {
        let len = self.deployed_tokens.len();
        let mut tokens = Vec::with_capacity(len);
        for i in 0..len {
            tokens.push(self.deployed_tokens.get(i).unwrap());
        }
        Ok(tokens)
    }

    /// Get tokens created by a specific address
    pub fn get_tokens_by_creator(&self, creator: Address) -> Result<Vec<Address>, FactoryError> {
        let creator_tokens = self.creator_to_tokens.getter(creator);
        let len = creator_tokens.len();
        let mut tokens = Vec::with_capacity(len);
        for i in 0..len {
            tokens.push(creator_tokens.get(i).unwrap());
        }
        Ok(tokens)
    }

    /// Get detailed information about a token
    pub fn get_token_info(
        &self,
        token_address: Address,
    ) -> Result<(Address, String, String, U256, U256), FactoryError> {
        let info = self.token_info.getter(token_address);
        if info.token_address.get() == Address::ZERO {
            return Err(FactoryError::TokenNotFound(TokenNotFound {}));
        }

        Ok((
            info.creator.get(),
            info.name.get_string(),
            info.symbol.get_string(),
            info.initial_supply.get(),
            info.deployed_at.get(),
        ))
    }

    /// Get paginated list of deployed tokens
    pub fn get_deployed_tokens_paginated(
        &self,
        start_index: U256,
        count: U256,
    ) -> Result<Vec<Address>, FactoryError> {
        let start = start_index.to::<u64>() as usize;
        let count_usize = count.to::<u64>() as usize;
        let total = self.deployed_tokens.len();

        if start >= total {
            return Err(FactoryError::InvalidInput(InvalidInput {}));
        }

        let end = (start + count_usize).min(total);
        let mut result = Vec::with_capacity(end - start);

        for i in start..end {
            result.push(self.deployed_tokens.get(i).unwrap());
        }

        Ok(result)
    }

    /// Get the latest N tokens deployed
    pub fn get_latest_tokens(&self, count: U256) -> Result<Vec<Address>, FactoryError> {
        let total = self.deployed_tokens.len();
        if total == 0 {
            return Err(FactoryError::InvalidInput(InvalidInput {}));
        }

        let count_usize = (count.to::<u64>() as usize).min(total);
        let mut result = Vec::with_capacity(count_usize);

        for i in 0..count_usize {
            result.push(self.deployed_tokens.get(total - 1 - i).unwrap());
        }

        Ok(result)
    }
}

