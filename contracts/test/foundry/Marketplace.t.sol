// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../src/PokemonCardNFT.sol";
import "../../src/PaymentSplitter.sol";
import "../../src/GachaPack.sol";
import "../../src/Marketplace.sol";
import "../../src/test/MarketplaceAttacker.sol";

/// @notice Fuzz tests for Marketplace value-conservation and reentrancy safety.
contract MarketplaceFuzzTest is Test {
    PokemonCardNFT  nft;
    PaymentSplitter splitter;
    GachaPack       gacha;
    Marketplace     market;

    address admin    = address(0xA0);
    address platform = address(0xB0);
    address issuer   = address(0xC0);
    address seller   = address(0xD0);
    address buyer    = address(0xE0);

    bytes32 constant MINTER_ROLE    = keccak256("MINTER_ROLE");
    bytes32 constant DEPOSITOR_ROLE = keccak256("DEPOSITOR_ROLE");

    uint256 constant PACK_PRICE = 0.01 ether;

    function setUp() public {
        vm.startPrank(admin);
        nft      = new PokemonCardNFT(admin);
        splitter = new PaymentSplitter(admin);
        gacha    = new GachaPack(address(nft), address(splitter), platform, issuer, 8000);
        market   = new Marketplace(address(nft), address(splitter), platform, 250);

        nft.grantRole(MINTER_ROLE,    address(gacha));
        nft.grantRole(MINTER_ROLE,    admin);         // for direct minting in tests
        splitter.grantRole(DEPOSITOR_ROLE, address(gacha));
        splitter.grantRole(DEPOSITOR_ROLE, address(market));

        // Seed pool so openPack works in the reentrancy test
        PokemonCardNFT.CardTemplate[] memory t = new PokemonCardNFT.CardTemplate[](4);
        for (uint16 i; i < 4; i++) {
            t[i] = PokemonCardNFT.CardTemplate({
                cardId: i + 1, name: "Card", rarity: PokemonCardNFT.Rarity.Common,
                pokemonType: "Fire", hp: 50, attack: "Ember", maxSupply: 100,
                currentSupply: 0, floorPrice: 0.01 ether, imageURI: "ipfs://c"
            });
        }
        nft.batchAddCards(t, platform, 300, issuer, 200);
        vm.stopPrank();

        vm.deal(seller, 1000 ether);
        vm.deal(buyer,  1000 ether);
    }

    // ─── Helper: mint a card with specified royalty receivers ──────────────

    function _mintWithRoyalties(
        address to,
        address rx1, uint96 bps1,
        address rx2, uint96 bps2
    ) internal returns (uint256 tokenId) {
        PokemonCardNFT.Card memory card = PokemonCardNFT.Card({
            name:        "FuzzCard",
            rarity:      PokemonCardNFT.Rarity.Rare,
            pokemonType: "Water",
            hp:          80,
            imageURI:    "ipfs://fuzz"
        });
        PokemonCardNFT.RoyaltyReceiver[] memory rxs = new PokemonCardNFT.RoyaltyReceiver[](2);
        rxs[0] = PokemonCardNFT.RoyaltyReceiver({ receiver: rx1, feeBps: bps1 });
        rxs[1] = PokemonCardNFT.RoyaltyReceiver({ receiver: rx2, feeBps: bps2 });

        vm.prank(admin);
        tokenId = nft.mintCard(to, card, rxs);
    }

    // ─── Pure math invariant — no wei created or destroyed ────────────────

    /// @notice The value-conservation identity must hold for any inputs.
    ///         sellerProceeds + sum(royaltyAmts) + platformFee ≡ salePrice
    function testFuzz_valueConservation(
        uint96  salePrice,
        uint16  platformBps,
        uint16  r1Bps,
        uint16  r2Bps
    ) public pure {
        vm.assume(salePrice > 0);
        vm.assume(platformBps <= 1000);                  // marketplace cap
        vm.assume(uint256(r1Bps) + r2Bps <= 1000);      // NFT royalty cap

        uint256 platformFee = (uint256(salePrice) * platformBps) / 10_000;
        uint256 r1Amt       = (uint256(salePrice) * r1Bps)       / 10_000;
        uint256 r2Amt       = (uint256(salePrice) * r2Bps)       / 10_000;
        // Seller absorbs rounding dust
        uint256 sellerAmt   = salePrice - platformFee - r1Amt - r2Amt;

        assertEq(
            platformFee + r1Amt + r2Amt + sellerAmt,
            salePrice,
            "value not conserved"
        );
    }

    // ─── End-to-end: value conservation through contracts ─────────────────

    /// @notice Full on-chain fuzz: list → buy → assert every wei accounted for.
    function testFuzz_e2eValueConservation(
        uint96 salePrice,
        uint16 r1Bps,
        uint16 r2Bps
    ) public {
        vm.assume(salePrice >= 10_000); // avoid all-zero royalties from rounding
        vm.assume(uint256(r1Bps) + r2Bps <= 1000);

        // Fund buyer with at least salePrice (fuzz inputs can exceed preset balance)
        vm.deal(buyer, uint256(salePrice) + 1 ether);

        address rx1 = address(0x1111);
        address rx2 = address(0x2222);

        uint256 tokenId = _mintWithRoyalties(seller, rx1, r1Bps, rx2, r2Bps);

        vm.prank(seller);
        nft.approve(address(market), tokenId);
        vm.prank(seller);
        market.listCard(tokenId, salePrice);

        uint256 splitterBefore = address(splitter).balance;

        vm.prank(buyer);
        market.buyCard{value: salePrice}(tokenId);

        // Splitter received exactly salePrice
        assertEq(
            address(splitter).balance - splitterBefore,
            salePrice,
            "splitter didn't receive full salePrice"
        );

        // All four claimable amounts sum to salePrice
        uint256 pClaimable  = splitter.claimable(platform);
        uint256 r1Claimable = splitter.claimable(rx1);
        uint256 r2Claimable = splitter.claimable(rx2);
        uint256 sClaimable  = splitter.claimable(seller);

        assertEq(
            pClaimable + r1Claimable + r2Claimable + sClaimable,
            salePrice,
            "claimable sum != salePrice"
        );

        // NFT is now owned by buyer
        assertEq(nft.ownerOf(tokenId), buyer, "buyer didn't receive NFT");

        // Market holds no ETH
        assertEq(address(market).balance, 0, "market holds residual ETH");
    }

    // ─── Reentrancy: malicious buyer via onERC721Received ─────────────────

    function test_reentrancyOnBuyCard() public {
        vm.prank(seller);
        gacha.openPack{value: PACK_PRICE}();   // mints tokens 0-4 to seller

        uint256 tokenId = 0;
        uint256 price   = 1 ether;

        vm.prank(seller);
        nft.approve(address(market), tokenId);
        vm.prank(seller);
        market.listCard(tokenId, price);

        // Deploy attacker — it will try to reenter in onERC721Received
        MarketplaceAttacker attacker = new MarketplaceAttacker(address(market));
        vm.deal(address(attacker), price);

        uint256 sellerSplitterBefore = splitter.claimable(seller);

        attacker.attack(tokenId, price);

        // Attacker got the NFT (first call succeeded)
        assertEq(nft.ownerOf(tokenId), address(attacker), "attacker should own NFT");
        // Seller's balance increased by their share only
        assertGt(splitter.claimable(seller), sellerSplitterBefore, "seller got nothing");
        // Attacker's reentrancy flag shows it tried to reenter
        assertEq(attacker.reentered(), true, "reentrancy never attempted");
        // Listing is gone — not exploitable
        (, uint256 listedPrice) = market.listings(tokenId);
        assertEq(listedPrice, 0, "listing still exists after purchase");
    }
}
