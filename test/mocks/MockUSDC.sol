// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Minimal ERC20 sufficient to back TrancheProtocol tests. Returns booleans
// from approve / transfer so the contract's low-level `.call("approve(...)")`
// path used for the Arc USDC precompile succeeds.
contract MockUSDC is IERC20 {
    string public constant name = "Mock USDC";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balance;
    mapping(address => mapping(address => uint256)) private _allowance;

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address a) external view returns (uint256) {
        return _balance[a];
    }

    function allowance(address o, address s) external view returns (uint256) {
        return _allowance[o][s];
    }

    function mint(address to, uint256 amount) external {
        _totalSupply += amount;
        _balance[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = _allowance[from][msg.sender];
        require(a >= amount, "ERC20: insufficient allowance");
        if (a != type(uint256).max) {
            _allowance[from][msg.sender] = a - amount;
        }
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(_balance[from] >= amount, "ERC20: insufficient balance");
        unchecked {
            _balance[from] -= amount;
        }
        _balance[to] += amount;
        emit Transfer(from, to, amount);
    }
}
