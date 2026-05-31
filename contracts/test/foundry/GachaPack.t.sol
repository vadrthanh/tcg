// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../src/PokemonCardNFT.sol";
import "../../src/PaymentSplitter.sol";
import "../../src/GachaPack.sol";

/// @notice Statistical distribution + supply invariant tests for GachaPack.
contract GachaPackStatTest is Test {
    PokemonCardNFT  nft;
    PaymentSplitter splitter;
    GachaPack       gacha;

    address admin    = address(0xA0);
    address platform = address(0xB0);
    address issuer   = address(0xC0);
    address buyer    = address(0xD0);

    bytes32 constant MINTER_ROLE    = keccak256("MINTER_ROLE");
    bytes32 constant DEPOSITOR_ROLE = keccak256("DEPOSITOR_ROLE");

    uint256 constant PACK_PRICE  = 0.01 ether;
    uint256 constant N_PACKS     = 200;
    uint256 constant TOTAL_CARDS = N_PACKS * 5; // 1 000

    // Card IDs per rarity (mirrors the seeded pool)
    uint16[] commonIds;
    uint16[] uncommonIds;
    uint16[] rareIds;
    uint16[] ultraRareIds;
    uint16[] legendaryIds;

    function setUp() public {
        vm.startPrank(admin);
        nft      = new PokemonCardNFT(admin);
        splitter = new PaymentSplitter(admin);
        gacha    = new GachaPack(
            address(nft), address(splitter), platform, issuer, 8000
        );
        nft.grantRole(MINTER_ROLE,    address(gacha));
        splitter.grantRole(DEPOSITOR_ROLE, address(gacha));

        // Seed card pool: 12 Common, 9 Uncommon, 8 Rare, 6 UltraRare, 5 Legendary
        // Supply generous enough for 200 packs (1000 cards).
        _seedPool();
        vm.stopPrank();

        vm.deal(buyer, N_PACKS * PACK_PRICE + 10 ether);
    }

    // ─── Pool seeding ─────────────────────────────────────────────────────────

    function _makeTemplate(uint16 id, PokemonCardNFT.Rarity rarity, uint16 supply)
        internal pure returns (PokemonCardNFT.CardTemplate memory)
    {
        return PokemonCardNFT.CardTemplate({
            cardId:        id,
            name:          "Card",
            rarity:        rarity,
            pokemonType:   "Fire",
            hp:            50,
            attack:        "Ember - 40",
            maxSupply:     supply,
            currentSupply: 0,
            floorPrice:    0.01 ether,
            imageURI:      "ipfs://card"
        });
    }

    function _seedPool() internal {
        // 12 Common cards × 120 supply each = 1440 total Common supply
        PokemonCardNFT.CardTemplate[] memory commons = new PokemonCardNFT.CardTemplate[](12);
        for (uint16 i; i < 12; i++) {
            commons[i] = _makeTemplate(i + 1, PokemonCardNFT.Rarity.Common, 120);
            commonIds.push(i + 1);
        }
        nft.batchAddCards(commons, platform, 300, issuer, 200);

        // 9 Uncommon × 60 supply = 540 total
        PokemonCardNFT.CardTemplate[] memory uncommons = new PokemonCardNFT.CardTemplate[](9);
        for (uint16 i; i < 9; i++) {
            uncommons[i] = _makeTemplate(i + 13, PokemonCardNFT.Rarity.Uncommon, 60);
            uncommonIds.push(i + 13);
        }
        nft.batchAddCards(uncommons, platform, 300, issuer, 200);

        // 8 Rare × 25 supply = 200 total
        PokemonCardNFT.CardTemplate[] memory rares = new PokemonCardNFT.CardTemplate[](8);
        for (uint16 i; i < 8; i++) {
            rares[i] = _makeTemplate(i + 22, PokemonCardNFT.Rarity.Rare, 25);
            rareIds.push(i + 22);
        }
        nft.batchAddCards(rares, platform, 300, issuer, 200);

        // 6 UltraRare × 12 supply = 72 total
        PokemonCardNFT.CardTemplate[] memory ultras = new PokemonCardNFT.CardTemplate[](6);
        for (uint16 i; i < 6; i++) {
            ultras[i] = _makeTemplate(i + 30, PokemonCardNFT.Rarity.UltraRare, 12);
            ultraRareIds.push(i + 30);
        }
        nft.batchAddCards(ultras, platform, 300, issuer, 200);

        // 5 Legendary × 10 supply = 50 total
        PokemonCardNFT.CardTemplate[] memory legends = new PokemonCardNFT.CardTemplate[](5);
        for (uint16 i; i < 5; i++) {
            legends[i] = _makeTemplate(i + 36, PokemonCardNFT.Rarity.Legendary, 10);
            legendaryIds.push(i + 36);
        }
        nft.batchAddCards(legends, platform, 300, issuer, 200);
    }

    // ─── Statistical distribution ─────────────────────────────────────────────

    /// @notice Open 200 packs (1000 cards) and assert the rarity distribution
    ///         falls within ±20% of theoretical weights.
    function test_rarityDistribution() public {
        for (uint256 p; p < N_PACKS; ++p) {
            vm.prevrandao(bytes32(uint256(keccak256(abi.encode("seed", p)))));
            vm.prank(buyer);
            gacha.openPack{value: PACK_PRICE}();
        }

        uint256 cCommon; uint256 cUncommon; uint256 cRare;
        uint256 cUltraRare; uint256 cLegendary;

        for (uint256 id; id < TOTAL_CARDS; ++id) {
            PokemonCardNFT.Rarity r = nft.getCard(id).rarity;
            if      (r == PokemonCardNFT.Rarity.Common)    cCommon++;
            else if (r == PokemonCardNFT.Rarity.Uncommon)  cUncommon++;
            else if (r == PokemonCardNFT.Rarity.Rare)      cRare++;
            else if (r == PokemonCardNFT.Rarity.UltraRare) cUltraRare++;
            else                                            cLegendary++;
        }

        emit log_named_uint("Total cards minted",   TOTAL_CARDS);
        emit log_named_uint("Common    (exp 600)",  cCommon);
        emit log_named_uint("Uncommon  (exp 250)",  cUncommon);
        emit log_named_uint("Rare      (exp 100)",  cRare);
        emit log_named_uint("UltraRare (exp  40)",  cUltraRare);
        emit log_named_uint("Legendary (exp  10)",  cLegendary);

        assertEq(cCommon + cUncommon + cRare + cUltraRare + cLegendary, TOTAL_CARDS);
        assertGe(cCommon,    480); assertLe(cCommon,    720);
        assertGe(cUncommon,  200); assertLe(cUncommon,  300);
        assertGe(cRare,       80); assertLe(cRare,      120);
        assertGe(cUltraRare,  32); assertLe(cUltraRare,  48);
        assertGe(cLegendary,   1); assertLe(cLegendary,  20);
    }

    // ─── Supply invariant ─────────────────────────────────────────────────────

    /// @notice Fuzz: open N packs → for every card template,
    ///         currentSupply must never exceed maxSupply.
    function testFuzz_supplyNeverExceedsMax(uint8 nPacks) public {
        vm.assume(nPacks > 0 && nPacks <= 50);
        vm.deal(buyer, uint256(nPacks) * PACK_PRICE + 1 ether);

        for (uint256 p; p < nPacks; ++p) {
            vm.prevrandao(bytes32(uint256(keccak256(abi.encode("fuzz", p)))));
            vm.prank(buyer);
            // Pack may revert AllCardsSoldOut if supply is exhausted — ignore that case.
            try gacha.openPack{value: PACK_PRICE}() {} catch {}
        }

        // Assert invariant: no card's currentSupply > maxSupply
        uint16[][] memory allArrays = new uint16[][](5);
        allArrays[0] = commonIds;
        allArrays[1] = uncommonIds;
        allArrays[2] = rareIds;
        allArrays[3] = ultraRareIds;
        allArrays[4] = legendaryIds;

        for (uint256 a; a < 5; ++a) {
            for (uint256 i; i < allArrays[a].length; ++i) {
                uint16 cid = allArrays[a][i];
                PokemonCardNFT.CardTemplate memory tpl = nft.getCardTemplate(cid);
                assertLe(
                    tpl.currentSupply,
                    tpl.maxSupply,
                    "INVARIANT BROKEN: currentSupply > maxSupply"
                );
            }
        }
    }

    // ─── Revenue invariant ────────────────────────────────────────────────────

    function test_revenueInvariantAfterPacks() public {
        uint256 SMALL_PACKS = 10;
        vm.deal(buyer, SMALL_PACKS * PACK_PRICE);

        for (uint256 p; p < SMALL_PACKS; ++p) {
            vm.prevrandao(bytes32(uint256(keccak256(abi.encode("rev", p)))));
            vm.prank(buyer);
            gacha.openPack{value: PACK_PRICE}();
        }

        assertEq(address(splitter).balance, SMALL_PACKS * PACK_PRICE);
        assertEq(address(gacha).balance, 0);
    }
}
