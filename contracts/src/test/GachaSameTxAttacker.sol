// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IGachaPack {
    function commitPack() external payable;
    function revealPack() external;
    function packPrice() external view returns (uint256);
}

/// @dev Test-only. Demonstrates that the commit–reveal split defeats the
///      same-transaction "simulate the draw, revert unless favourable" attack.
///      revealPack() cannot run in the same block/transaction as commitPack()
///      (RevealTooEarly), so a wrapper contract can never observe the pack
///      outcome while it is still able to abort the payment.
contract GachaSameTxAttacker {
    IGachaPack public immutable gacha;

    constructor(address _gacha) {
        gacha = IGachaPack(_gacha);
    }

    /// @notice Pay for a pack and immediately try to reveal in the same tx.
    ///         Must revert (RevealTooEarly).
    function commitAndRevealSameTx() external payable {
        gacha.commitPack{value: msg.value}();
        gacha.revealPack();
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external pure returns (bytes4)
    {
        return this.onERC721Received.selector;
    }

    receive() external payable {}
}
