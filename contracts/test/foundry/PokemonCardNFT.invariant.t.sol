// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../src/PokemonCardNFT.sol";

/**
 * @title PokemonCardNFT — Foundry Invariant + Fuzz Tests
 * @notice Adapted from the "Person 1" capstone deliverable, rewritten against
 *         the production PokemonCardNFT API: string `pokemonType`, 5-arg
 *         `batchAddCards`, template-based `mintCard(to, cardId)`, and the
 *         `RoyaltyCapExceeded` custom error.
 *
 * Invariants:
 *   I1.  ∀ cardId : currentSupply ≤ maxSupply
 *   I2.  Σ currentSupply  ==  number of successful template mints
 *
 * Run:
 *   forge test --match-contract PokemonCardNFTInvariantTest -vvv
 *   forge test --match-contract PokemonCardNFTFuzzTest -vvv
 */

// ─── Handler: drives random mints inside the invariant engine ────────────────

contract MintHandler is Test {
    PokemonCardNFT public nft;
    address        public minter;

    uint16[] public seededCardIds;
    uint256  public ghost_mintCount; // successful template mints

    constructor(PokemonCardNFT _nft, address _minter, uint16[] memory ids) {
        nft = _nft;
        minter = _minter;
        for (uint256 i; i < ids.length; ++i) seededCardIds.push(ids[i]);
    }

    /// @dev The only fuzzed action (see targetSelector in setUp). Picks a seeded
    ///      cardId and tries to mint; sold-out reverts are expected and swallowed.
    function tryMint(uint256 seed, address to) external {
        if (seededCardIds.length == 0) return;
        if (to == address(0)) to = address(0xBEEF);

        uint16 cardId = seededCardIds[seed % seededCardIds.length];

        vm.prank(minter);
        try nft.mintCard(to, cardId) returns (uint256) {
            ghost_mintCount++;
        } catch {}
    }
}

// ─── Invariant suite ─────────────────────────────────────────────────────────

contract PokemonCardNFTInvariantTest is Test {
    PokemonCardNFT public nft;
    MintHandler    public handler;

    address admin    = address(0xA0);
    address minter   = address(0xA1);
    address platform = address(0xF1);
    address artist   = address(0xF2);

    uint16 constant CARD_COUNT = 5;

    function setUp() public {
        vm.startPrank(admin);
        nft = new PokemonCardNFT(admin);
        nft.grantRole(nft.MINTER_ROLE(), minter);

        PokemonCardNFT.CardTemplate[] memory templates =
            new PokemonCardNFT.CardTemplate[](CARD_COUNT);
        templates[0] = _card(1, PokemonCardNFT.Rarity.Common,    10);
        templates[1] = _card(2, PokemonCardNFT.Rarity.Uncommon,   5);
        templates[2] = _card(3, PokemonCardNFT.Rarity.Rare,       4);
        templates[3] = _card(4, PokemonCardNFT.Rarity.UltraRare,  3);
        templates[4] = _card(5, PokemonCardNFT.Rarity.Legendary,  2);

        // platform 300 bps + artist 200 bps = 500 ≤ MAX_ROYALTY_BPS (1000)
        nft.batchAddCards(templates, platform, 300, artist, 200);
        vm.stopPrank();

        uint16[] memory ids = new uint16[](CARD_COUNT);
        for (uint16 i; i < CARD_COUNT; ++i) ids[i] = i + 1;
        handler = new MintHandler(nft, minter, ids);

        // Restrict the fuzzer to the handler's tryMint action only.
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = MintHandler.tryMint.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    /// @notice I1 — the supply cap is never breached by any mint sequence.
    function invariant_supplyNeverExceedsMax() public view {
        for (uint16 id = 1; id <= CARD_COUNT; ++id) {
            PokemonCardNFT.CardTemplate memory t = nft.getCardTemplate(id);
            assertLe(
                uint256(t.currentSupply),
                uint256(t.maxSupply),
                "I1 VIOLATED: currentSupply > maxSupply"
            );
        }
    }

    /// @notice I2 — every successful mint bumps exactly one supply counter.
    function invariant_supplySumEqualsMintCount() public view {
        uint256 sum;
        for (uint16 id = 1; id <= CARD_COUNT; ++id) {
            sum += nft.getCardTemplate(id).currentSupply;
        }
        assertEq(
            sum,
            handler.ghost_mintCount(),
            "I2 VIOLATED: sum(currentSupply) != successful mints"
        );
    }

    function _card(uint16 id, PokemonCardNFT.Rarity rarity, uint16 maxSupply)
        internal pure
        returns (PokemonCardNFT.CardTemplate memory)
    {
        return PokemonCardNFT.CardTemplate({
            cardId:        id,
            name:          "TestCard",
            rarity:        rarity,
            pokemonType:   "Fire",
            hp:            60,
            attack:        "Tackle - 10",
            maxSupply:     maxSupply,
            currentSupply: 0,
            floorPrice:    0.001 ether,
            imageURI:      "ipfs://card"
        });
    }
}

// ─── Fuzz suite ──────────────────────────────────────────────────────────────

contract PokemonCardNFTFuzzTest is Test {
    PokemonCardNFT nft;

    address admin    = address(0xB0);
    address minter   = address(0xB1);
    address user     = address(0xB2);
    address platform = address(0xB3);
    address artist   = address(0xB4);

    uint16 constant CAP = 50;

    function setUp() public {
        vm.startPrank(admin);
        nft = new PokemonCardNFT(admin);
        nft.grantRole(nft.MINTER_ROLE(), minter);

        PokemonCardNFT.CardTemplate[] memory t = new PokemonCardNFT.CardTemplate[](1);
        t[0] = _card(1, PokemonCardNFT.Rarity.Common, CAP);
        nft.batchAddCards(t, platform, 300, artist, 200);
        vm.stopPrank();
    }

    /// @notice Minting min(n, CAP) tokens tracks currentSupply exactly and never
    ///         exceeds maxSupply.
    function testFuzz_mintTracksSupply(uint16 n) public {
        uint16 toMint = n > CAP ? CAP : n;
        for (uint16 i; i < toMint; ++i) {
            vm.prank(minter);
            nft.mintCard(user, 1);
        }
        PokemonCardNFT.CardTemplate memory t = nft.getCardTemplate(1);
        assertEq(t.currentSupply, toMint, "currentSupply mismatch");
        assertLe(t.currentSupply, t.maxSupply, "supply exceeded max");
    }

    /// @notice The (CAP+1)-th mint of a sold-out card reverts CardSoldOut.
    function testFuzz_mintBeyondMaxReverts(uint16 extra) public {
        vm.assume(extra > 0);
        for (uint16 i; i < CAP; ++i) {
            vm.prank(minter);
            nft.mintCard(user, 1);
        }
        vm.expectRevert(
            abi.encodeWithSelector(PokemonCardNFT.CardSoldOut.selector, uint16(1))
        );
        vm.prank(minter);
        nft.mintCard(user, 1);
    }

    /// @notice Royalty bps summing above MAX_ROYALTY_BPS revert on the pool path.
    function testFuzz_royaltyCapEnforced(uint96 bps) public {
        uint96 cap = nft.MAX_ROYALTY_BPS();
        vm.assume(bps > cap);

        PokemonCardNFT.CardTemplate memory tpl = _card(7, PokemonCardNFT.Rarity.Rare, 5);
        PokemonCardNFT.RoyaltyReceiver[] memory recs =
            new PokemonCardNFT.RoyaltyReceiver[](1);
        recs[0] = PokemonCardNFT.RoyaltyReceiver({ receiver: user, feeBps: bps });

        // cap is cached above: no external (view) call may sit between the prank
        // and the pranked call, or it would consume the prank.
        vm.expectRevert(
            abi.encodeWithSelector(PokemonCardNFT.RoyaltyCapExceeded.selector, bps, cap)
        );
        vm.prank(admin);
        nft.addCardToPool(tpl, recs);
    }

    /// @notice batchAddCards stores arbitrary valid template fields verbatim and
    ///         forces currentSupply to 0.
    function testFuzz_batchAddStoresTemplate(uint16 maxSupply, uint96 floorPrice) public {
        vm.assume(maxSupply > 0);

        PokemonCardNFT.CardTemplate[] memory t = new PokemonCardNFT.CardTemplate[](1);
        t[0] = _card(999, PokemonCardNFT.Rarity.Rare, maxSupply);
        t[0].floorPrice = floorPrice;

        vm.prank(admin);
        nft.batchAddCards(t, platform, 300, artist, 200);

        PokemonCardNFT.CardTemplate memory stored = nft.getCardTemplate(999);
        assertEq(stored.maxSupply, maxSupply, "maxSupply mismatch");
        assertEq(stored.floorPrice, floorPrice, "floorPrice mismatch");
        assertEq(stored.currentSupply, 0, "currentSupply not zeroed");
    }

    function _card(uint16 id, PokemonCardNFT.Rarity rarity, uint16 maxSupply)
        internal pure
        returns (PokemonCardNFT.CardTemplate memory)
    {
        return PokemonCardNFT.CardTemplate({
            cardId:        id,
            name:          "FuzzCard",
            rarity:        rarity,
            pokemonType:   "Fire",
            hp:            60,
            attack:        "Tackle - 10",
            maxSupply:     maxSupply,
            currentSupply: 0,
            floorPrice:    0.001 ether,
            imageURI:      "ipfs://fuzz"
        });
    }
}
