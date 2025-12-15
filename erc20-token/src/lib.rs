// SPDX-License-Identifier: MIT
#![cfg_attr(not(feature = "export-abi"), no_main)]
extern crate alloc;

use alloy_primitives::{Address, U256};
use alloy_sol_types::sol;
use stylus_sdk::{prelude::*, msg, evm};

// Declare Solidity error types
sol! {
    error InsufficientBalance(address from, uint256 have, uint256 want);
    error InsufficientAllowance(address owner, address spender, uint256 have, uint256 want);
    error NotOwner();
    error Paused();
    error NotPaused();
}

/// Represents the ways methods may fail.
#[derive(SolidityError)]
pub enum TokenError {
    InsufficientBalance(InsufficientBalance),
    InsufficientAllowance(InsufficientAllowance),
    NotOwner(NotOwner),
    Paused(Paused),
    NotPaused(NotPaused),
}

// Declare Solidity event types
sol! {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event TokenPaused(address indexed account);
    event TokenUnpaused(address indexed account);
}

sol_storage! {
    #[entrypoint]
    pub struct MyToken {
        mapping(address => uint256) balances;
        mapping(address => mapping(address => uint256)) allowances;
        uint256 total_supply;
        address owner;
        bool paused;
        string name;
        string symbol;
        uint256 decimals;
    }
}

#[public]
impl MyToken {
    /// Constructor - initializes the token
    pub fn init(
        &mut self,
        name: String,
        symbol: String,
        initial_supply: U256,
    ) -> Result<(), TokenError> {
        let sender = msg::sender();
        self.owner.set(sender);
        self.paused.set(false);
        self.name.set_str(name);
        self.symbol.set_str(symbol);
        self.decimals.set(U256::from(18));

        // Mint initial supply to sender
        let decimals_multiplier = U256::from(10).pow(U256::from(18));
        let supply = initial_supply
            .checked_mul(decimals_multiplier)
            .ok_or(TokenError::InsufficientBalance(InsufficientBalance {
                from: Address::ZERO,
                have: U256::ZERO,
                want: U256::ZERO,
            }))?;

        self._mint(sender, supply)?;
        Ok(())
    }

    /// Returns the token name
    pub fn name(&self) -> Result<String, TokenError> {
        Ok(self.name.get_string())
    }

    /// Returns the token symbol
    pub fn symbol(&self) -> Result<String, TokenError> {
        Ok(self.symbol.get_string())
    }

    /// Returns the token decimals
    pub fn decimals(&self) -> Result<u8, TokenError> {
        Ok(self.decimals.get().to::<u64>() as u8)
    }

    /// Returns the total supply
    pub fn total_supply(&self) -> Result<U256, TokenError> {
        Ok(self.total_supply.get())
    }

    /// Returns the balance of an account
    pub fn balance_of(&self, account: Address) -> Result<U256, TokenError> {
        Ok(self.balances.get(account))
    }

    /// Returns the allowance
    pub fn allowance(&self, owner: Address, spender: Address) -> Result<U256, TokenError> {
        Ok(self.allowances.getter(owner).get(spender))
    }

    /// Returns the owner address
    pub fn owner(&self) -> Result<Address, TokenError> {
        Ok(self.owner.get())
    }

    /// Returns true if the contract is paused
    pub fn paused(&self) -> Result<bool, TokenError> {
        Ok(self.paused.get())
    }

    /// Transfer tokens
    pub fn transfer(&mut self, to: Address, amount: U256) -> Result<bool, TokenError> {
        if self.paused.get() {
            return Err(TokenError::Paused(Paused {}));
        }
        self._transfer(msg::sender(), to, amount)?;
        Ok(true)
    }

    /// Transfer from
    pub fn transfer_from(
        &mut self,
        from: Address,
        to: Address,
        amount: U256,
    ) -> Result<bool, TokenError> {
        if self.paused.get() {
            return Err(TokenError::Paused(Paused {}));
        }

        let msg_sender = msg::sender();
        let mut sender_allowances = self.allowances.setter(from);
        let mut allowance = sender_allowances.setter(msg_sender);
        let old_allowance = allowance.get();

        if old_allowance < amount {
            return Err(TokenError::InsufficientAllowance(InsufficientAllowance {
                owner: from,
                spender: msg_sender,
                have: old_allowance,
                want: amount,
            }));
        }

        allowance.set(old_allowance - amount);
        self._transfer(from, to, amount)?;
        Ok(true)
    }

    /// Approve spender
    pub fn approve(&mut self, spender: Address, amount: U256) -> Result<bool, TokenError> {
        let msg_sender = msg::sender();
        self.allowances.setter(msg_sender).insert(spender, amount);
        evm::log(Approval {
            owner: msg_sender,
            spender,
            value: amount,
        });
        Ok(true)
    }

    /// Mint tokens (owner only)
    pub fn mint(&mut self, to: Address, amount: U256) -> Result<(), TokenError> {
        if msg::sender() != self.owner.get() {
            return Err(TokenError::NotOwner(NotOwner {}));
        }
        let decimals_multiplier = U256::from(10).pow(U256::from(18));
        let mint_amount = amount
            .checked_mul(decimals_multiplier)
            .ok_or(TokenError::InsufficientBalance(InsufficientBalance {
                from: Address::ZERO,
                have: U256::ZERO,
                want: U256::ZERO,
            }))?;
        self._mint(to, mint_amount)?;
        Ok(())
    }

    /// Burn tokens
    pub fn burn(&mut self, amount: U256) -> Result<(), TokenError> {
        let sender = msg::sender();
        self._burn(sender, amount)?;
        Ok(())
    }

    /// Pause transfers (owner only)
    pub fn pause(&mut self) -> Result<(), TokenError> {
        if msg::sender() != self.owner.get() {
            return Err(TokenError::NotOwner(NotOwner {}));
        }
        if self.paused.get() {
            return Err(TokenError::Paused(Paused {}));
        }
        self.paused.set(true);
        evm::log(TokenPaused {
            account: msg::sender(),
        });
        Ok(())
    }

    /// Unpause transfers (owner only)
    pub fn unpause(&mut self) -> Result<(), TokenError> {
        if msg::sender() != self.owner.get() {
            return Err(TokenError::NotOwner(NotOwner {}));
        }
        if !self.paused.get() {
            return Err(TokenError::NotPaused(NotPaused {}));
        }
        self.paused.set(false);
        evm::log(TokenUnpaused {
            account: msg::sender(),
        });
        Ok(())
    }

    /// Transfer ownership (owner only)
    pub fn transfer_ownership(&mut self, new_owner: Address) -> Result<(), TokenError> {
        if msg::sender() != self.owner.get() {
            return Err(TokenError::NotOwner(NotOwner {}));
        }
        self.owner.set(new_owner);
        Ok(())
    }

    /// Get balance in human-readable format
    pub fn balance_of_readable(&self, account: Address) -> Result<U256, TokenError> {
        let balance = self.balances.get(account);
        let decimals_multiplier = U256::from(10).pow(U256::from(18));
        Ok(balance / decimals_multiplier)
    }
}

// Internal functions (not exposed publicly)
impl MyToken {
    fn _transfer(&mut self, from: Address, to: Address, value: U256) -> Result<(), TokenError> {
        let mut sender_balance = self.balances.setter(from);
        let old_sender_balance = sender_balance.get();
        if old_sender_balance < value {
            return Err(TokenError::InsufficientBalance(InsufficientBalance {
                from,
                have: old_sender_balance,
                want: value,
            }));
        }
        sender_balance.set(old_sender_balance - value);

        let mut to_balance = self.balances.setter(to);
        let new_to_balance = to_balance.get() + value;
        to_balance.set(new_to_balance);

        evm::log(Transfer { from, to, value });
        Ok(())
    }

    fn _mint(&mut self, address: Address, value: U256) -> Result<(), TokenError> {
        let mut balance = self.balances.setter(address);
        let new_balance = balance.get() + value;
        balance.set(new_balance);

        self.total_supply.set(self.total_supply.get() + value);

        evm::log(Transfer {
            from: Address::ZERO,
            to: address,
            value,
        });

        Ok(())
    }

    fn _burn(&mut self, address: Address, value: U256) -> Result<(), TokenError> {
        let mut balance = self.balances.setter(address);
        let old_balance = balance.get();
        if old_balance < value {
            return Err(TokenError::InsufficientBalance(InsufficientBalance {
                from: address,
                have: old_balance,
                want: value,
            }));
        }
        balance.set(old_balance - value);

        self.total_supply.set(self.total_supply.get() - value);

        evm::log(Transfer {
            from: address,
            to: Address::ZERO,
            value,
        });

        Ok(())
    }
}
