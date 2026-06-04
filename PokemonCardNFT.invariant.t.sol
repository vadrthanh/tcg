// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/PokemonCardNFT.sol";

/**
 * @title PokemonCardNFT — Foundry Invariant + Fuzz Tests
 * @notice Person 1 deliverable — Phase D (Days 8–9)
 *
 * Invariant tested:
 *   ∀ cardId : currentSupply <= maxSupply
 *
 * Run with:
 *   forge test --match-contract PokemonCardNFTInvariantTest -vvv
 *   forge test --fuzz-seed 12345 --match-contract PokemonCardNFTFuzzTest -vvv
 */

// ─── Handler: drives random mints inside the invariant engine ────────────────

contract MintHandler is Test {
    PokemonCardNFT public nft;
    address public minter;

    // Track all seeded cardIds so we can randomly pick them
    uint16[] public seededCardIds;

    constructor(PokemonCardNFT _nft, address _minter) {
        nft = _nft;
        minter = _minter;
    }

    /// @dev Called by the invariant engine. Picks a random cardId from the
    ///      seeded pool and attempts a mint. Reverts are OK (sold out / unknown).
    function tryMint(uint256 seed, address to) public {
        if (seededCardIds.length == 0) return;
        if (to == address(0)) to = address(0xBEEF);

        uint16 cardId = seededCardIds[seed % seededCardIds.length];

        // Attempt mint — ignore revert (CardSoldOut is expected behaviour)
        vm.prank(minter);
        try nft.mintCard(to, cardId, new PokemonCardNFT.RoyaltyReceiver[](0)) {}
        catch {}
    }

    function addSeededCard(uint16 cardId) external {
        seededCardIds.push(cardId);
    }
}

// ─── Invariant test suite ────────────────────────────────────────────────────

contract PokemonCardNFTInvariantTest is Test {
    PokemonCardNFT public nft;
    MintHandler    public handler;

    address admin  = address(0xA0);
    address minter = address(0xA1);

    function setUp() public {
        vm.startPrank(admin);
        nft = new PokemonCardNFT(admin);
        nft.grantRole(nft.MINTER_ROLE(), minter);

        // Seed small supplies so we can exhaust them in 500 iterations
        PokemonCardNFT.CardTemplate[] memory templates =
            new PokemonCardNFT.CardTemplate[](5);

        templates[0] = _card(1,  PokemonCardNFT.Rarity.Common,    10);
        templates[1] = _card(2,  PokemonCardNFT.Rarity.Uncommon,  5);
        templates[2] = _card(3,  PokemonCardNFT.Rarity.Rare,      4);
        templates[3] = _card(4,  PokemonCardNFT.Rarity.UltraRare, 3);
        templates[4] = _card(5,  PokemonCardNFT.Rarity.Legendary, 2);

        nft.batchAddCards(templates);
        vm.stopPrank();

        handler = new MintHandler(nft, minter);
        for (uint16 i = 1; i <= 5; i++) {
            handler.addSeededCard(i);
        }

        // Point the invariant engine at the handler only
        targetContract(address(handler));
    }

    /// @notice Core invariant: for every card in the pool,
    ///         currentSupply must never exceed maxSupply.
    function invariant_supplyNeverExceedsMax() public view {
        uint16[] memory ids = new uint16[](5);
        for (uint16 i = 0; i < 5; i++) ids[i] = i + 1;

        for (uint256 i = 0; i < ids.length; i++) {
            PokemonCardNFT.CardTemplate memory tmpl = nft.getCardTemplate(ids[i]);
            assertLe(
                uint256(tmpl.currentSupply),
                uint256(tmpl.maxSupply),
                "INVARIANT VIOLATED: currentSupply > maxSupply"
            );
        }
    }

    /// @notice Secondary invariant: total minted tokens equals sum of currentSupply.
    function invariant_totalSupplyMatchesSumOfCurrentSupply() public view {
        uint256 sumCurrentSupply = 0;
        for (uint16 i = 1; i <= 5; i++) {
            PokemonCardNFT.CardTemplate memory tmpl = nft.getCardTemplate(i);
            sumCurrentSupply += tmpl.currentSupply;
        }
        assertEq(
            nft.totalSupply(),
            sumCurrentSupply,
            "INVARIANT VIOLATED: totalSupply != sum(currentSupply)"
        );
    }

    // ── helper ───────────────────────────────────────────────────────────────

    function _card(
        uint16 id,
        PokemonCardNFT.Rarity rarity,
        uint16 maxSupply
    ) internal pure returns (PokemonCardNFT.CardTemplate memory) {
        return PokemonCardNFT.CardTemplate({
            cardId:        id,
            rarity:        rarity,
            pokemonType:   0,
            hp:            60,
            maxSupply:     maxSupply,
            currentSupply: 0,
            floorPrice:    0.001 ether,
            name:          "TestCard",
            attack:        "Tackle",
            imageURI:      "https://example.com/card.png"
        });
    }
}

// ─── Fuzz test suite ─────────────────────────────────────────────────────────

contract PokemonCardNFTFuzzTest is Test {
    PokemonCardNFT nft;

    address admin  = address(0xB0);
    address minter = address(0xB1);
    address user   = address(0xB2);

    function setUp() public {
        vm.startPrank(admin);
        nft = new PokemonCardNFT(admin);
        nft.grantRole(nft.MINTER_ROLE(), minter);

        PokemonCardNFT.CardTemplate[] memory t = new PokemonCardNFT.CardTemplate[](1);
        t[0] = PokemonCardNFT.CardTemplate({
            cardId:        1,
            rarity:        PokemonCardNFT.Rarity.Common,
            pokemonType:   0,
            hp:            60,
            maxSupply:     50,
            currentSupply: 0,
            floorPrice:    0.001 ether,
            name:          "FuzzCard",
            attack:        "Tackle",
            imageURI:      "https://example.com/fuzz.png"
        });
        nft.batchAddCards(t);
        vm.stopPrank();
    }

    /**
     * @notice Fuzz: mint `n` tokens for cardId=1 (maxSupply=50).
     *         After minting min(n, 50) tokens the supply must never go over 50.
     */
    function testFuzz_mintUpToMax(uint16 n) public {
        uint16 cap = 50;
        uint16 toMint = n > cap ? cap : n;

        for (uint16 i = 0; i < toMint; i++) {
            vm.prank(minter);
            nft.mintCard(user, 1, new PokemonCardNFT.RoyaltyReceiver[](0));
        }

        PokemonCardNFT.CardTemplate memory tmpl = nft.getCardTemplate(1);
        assertEq(tmpl.currentSupply, toMint, "currentSupply mismatch");
        assertLe(tmpl.currentSupply, tmpl.maxSupply, "supply exceeded max");
    }

    /**
     * @notice Fuzz: royalty bps validation — any sum > 1000 must revert.
     */
    function testFuzz_royaltyCapEnforced(uint16 bps) public {
        vm.assume(bps > 1000);

        PokemonCardNFT.RoyaltyReceiver[] memory recs =
            new PokemonCardNFT.RoyaltyReceiver[](1);
        recs[0] = PokemonCardNFT.RoyaltyReceiver({
            receiver: user,
            feeBps:   bps
        });

        vm.prank(minter);
        vm.expectRevert(
            abi.encodeWithSelector(PokemonCardNFT.RoyaltyTooHigh.selector, bps)
        );
        nft.mintCard(user, 1, recs);
    }

    /**
     * @notice Fuzz: batchAddCards accepts any non-zero maxSupply for valid cardId ranges.
     */
    function testFuzz_batchAddCards(uint16 maxSupply, uint96 floorPrice) public {
        vm.assume(maxSupply > 0 && maxSupply <= 10_000);
        vm.assume(floorPrice > 0);

        PokemonCardNFT.CardTemplate[] memory t = new PokemonCardNFT.CardTemplate[](1);
        t[0] = PokemonCardNFT.CardTemplate({
            cardId:        999,
            rarity:        PokemonCardNFT.Rarity.Rare,
            pokemonType:   0,
            hp:            80,
            maxSupply:     maxSupply,
            currentSupply: 0,
            floorPrice:    floorPrice,
            name:          "FuzzRare",
            attack:        "Slash",
            imageURI:      "https://example.com/fuzz-rare.png"
        });

        vm.prank(admin);
        nft.batchAddCards(t);

        PokemonCardNFT.CardTemplate memory stored = nft.getCardTemplate(999);
        assertEq(stored.maxSupply, maxSupply);
        assertEq(stored.floorPrice, floorPrice);
        assertEq(stored.currentSupply, 0);
    }
}
