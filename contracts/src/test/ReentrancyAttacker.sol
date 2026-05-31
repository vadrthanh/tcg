// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ISplitter {
    function claim() external;
}

/// @dev Test-only contract: attempts reentrancy on PaymentSplitter.claim().
contract ReentrancyAttacker {
    ISplitter public immutable splitter;
    uint256   public attackCount;

    constructor(address _splitter) {
        splitter = ISplitter(_splitter);
    }

    /// @notice Initiate the attack — calls claim() from this contract's address.
    function attack() external {
        splitter.claim();
    }

    /// @dev Reenter claim() on every ETH receive. The ReentrancyGuard in the
    ///      splitter should revert the nested call, leaving this contract with
    ///      only its original balance.
    receive() external payable {
        attackCount++;
        if (attackCount < 5) {
            // Swallow the revert so the outer call still completes successfully
            try splitter.claim() {} catch {}
        }
    }
}
