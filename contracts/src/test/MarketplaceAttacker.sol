// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IMarketplace {
    function buyCard(uint256 tokenId) external payable;
}

/// @dev Test-only. Attempts reentrancy on Marketplace.buyCard() via onERC721Received.
contract MarketplaceAttacker {
    IMarketplace public immutable marketplace;
    uint256      public targetTokenId;
    bool         public reentered;

    constructor(address _marketplace) {
        marketplace = IMarketplace(_marketplace);
    }

    function setTarget(uint256 tokenId) external {
        targetTokenId = tokenId;
    }

    /// @notice Entry point — buy a card as this attacker contract.
    function attack(uint256 tokenId, uint256 price) external payable {
        targetTokenId = tokenId;
        marketplace.buyCard{value: price}(tokenId);
    }

    /// @dev Called by ERC721.safeTransferFrom when this contract receives the NFT.
    ///      Tries to reenter buyCard — must fail.
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external returns (bytes4) {
        reentered = true;
        // Attempt reentry — should be blocked by nonReentrant or NotListed
        try marketplace.buyCard{value: 0}(targetTokenId) {} catch {}
        return this.onERC721Received.selector;
    }

    receive() external payable {}
}
