// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title PaymentSplitter — pull-payment (claim-based) vault
/// @notice Approved depositors credit per-recipient balances; recipients withdraw
///         individually via claim(). No ETH is ever pushed — eliminates out-of-gas
///         and reentrancy risk from distribution loops.
contract PaymentSplitter is ReentrancyGuard, AccessControl {

    // ─── Roles ────────────────────────────────────────────────────────────────

    /// @dev Granted to GachaPack and Marketplace after deploy.
    bytes32 public constant DEPOSITOR_ROLE = keccak256("DEPOSITOR_ROLE");

    // ─── Storage ──────────────────────────────────────────────────────────────

    /// @notice Claimable ETH balance per address.
    mapping(address => uint256) public balances;

    // ─── Errors ───────────────────────────────────────────────────────────────

    error ArrayLengthMismatch();
    error ValueMismatch(uint256 sent, uint256 required);
    error NothingToClaim();
    error TransferFailed();
    error EmptyReceivers();

    // ─── Events ───────────────────────────────────────────────────────────────

    event Deposited(address indexed depositor, address[] receivers, uint256[] amounts);
    event Claimed(address indexed recipient, uint256 amount);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ─── Deposit ──────────────────────────────────────────────────────────────

    /// @notice Credit `amounts[i]` ETH to `receivers[i]`. msg.value must equal
    ///         the exact sum of amounts; excess or deficit reverts.
    /// @dev    Only approved DEPOSITOR_ROLE callers. O(n) writes to storage, no
    ///         external calls — safe from reentrancy without a guard here.
    function deposit(
        address[] calldata receivers,
        uint256[] calldata amounts
    ) external payable onlyRole(DEPOSITOR_ROLE) {
        if (receivers.length == 0) revert EmptyReceivers();
        if (receivers.length != amounts.length) revert ArrayLengthMismatch();

        uint256 total;
        for (uint256 i; i < amounts.length; ++i) {
            total += amounts[i];
        }
        if (total != msg.value) revert ValueMismatch(msg.value, total);

        for (uint256 i; i < receivers.length; ++i) {
            balances[receivers[i]] += amounts[i];
        }

        emit Deposited(msg.sender, receivers, amounts);
    }

    // ─── Claim ────────────────────────────────────────────────────────────────

    /// @notice Withdraw the caller's entire claimable balance.
    ///         CEI: balance is zeroed before the external call.
    ///         nonReentrant guard as defence-in-depth against reentrant receivers.
    function claim() external nonReentrant {
        uint256 amount = balances[msg.sender];
        if (amount == 0) revert NothingToClaim();

        // Effects — zero before external call (CEI)
        balances[msg.sender] = 0;

        // Interactions
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Claimed(msg.sender, amount);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Claimable balance for `recipient`.
    function claimable(address recipient) external view returns (uint256) {
        return balances[recipient];
    }

    // ─── Interface ────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
