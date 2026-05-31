// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../src/PokemonCardNFT.sol";
import "../../src/PaymentSplitter.sol";
import "../../src/GachaPack.sol";
import "../../src/Marketplace.sol";

/// @notice Isolated gas benchmarks for each key user-facing function.
///         Run with: forge test --match-path 'test/foundry/GasReport.t.sol' -vv
contract GasReportTest is Test {
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

    function setUp() public {
        vm.startPrank(admin);
        nft      = new PokemonCardNFT(admin);
        splitter = new PaymentSplitter(admin);
        gacha    = new GachaPack(address(nft), address(splitter), platform, issuer, 8000);
        market   = new Marketplace(address(nft), address(splitter), platform, 250);

        nft.grantRole(MINTER_ROLE,    address(gacha));
        nft.grantRole(MINTER_ROLE,    admin);
        splitter.grantRole(DEPOSITOR_ROLE, address(gacha));
        splitter.grantRole(DEPOSITOR_ROLE, address(market));

        // Seed pool — enough supply for all benchmark packs
        PokemonCardNFT.CardTemplate[] memory templates = new PokemonCardNFT.CardTemplate[](5);
        for (uint16 i; i < 5; i++) {
            templates[i] = PokemonCardNFT.CardTemplate({
                cardId: i + 1, name: "Card", rarity: PokemonCardNFT.Rarity.Common,
                pokemonType: "Fire", hp: 50, attack: "Ember - 40",
                maxSupply: 200, currentSupply: 0, floorPrice: 0.01 ether,
                imageURI: "ipfs://card"
            });
        }
        nft.batchAddCards(templates, platform, 300, issuer, 200);
        vm.stopPrank();

        vm.deal(seller, 100 ether);
        vm.deal(buyer,  100 ether);
    }

    function test_gas_openPack() public {
        vm.prank(seller);
        gacha.openPack{value: 0.01 ether}();
    }

    function test_gas_listCard() public {
        vm.prank(seller);
        gacha.openPack{value: 0.01 ether}();
        vm.prank(seller);
        nft.approve(address(market), 0);
        vm.prank(seller);
        market.listCard(0, 1 ether);
    }

    function test_gas_buyCard() public {
        vm.prank(seller);
        gacha.openPack{value: 0.01 ether}();
        vm.prank(seller);
        nft.approve(address(market), 0);
        vm.prank(seller);
        market.listCard(0, 1 ether);
        vm.prank(buyer);
        market.buyCard{value: 1 ether}(0);
    }

    function test_gas_claim() public {
        vm.prank(seller);
        gacha.openPack{value: 0.01 ether}();
        vm.prank(platform);
        splitter.claim();
    }

    function test_gas_mintCard() public {
        PokemonCardNFT.Card memory card = PokemonCardNFT.Card({
            name: "Pikachu", rarity: PokemonCardNFT.Rarity.Rare,
            pokemonType: "Electric", hp: 60, imageURI: "ipfs://pikachu"
        });
        PokemonCardNFT.RoyaltyReceiver[] memory rxs = new PokemonCardNFT.RoyaltyReceiver[](2);
        rxs[0] = PokemonCardNFT.RoyaltyReceiver({ receiver: platform, feeBps: 500 });
        rxs[1] = PokemonCardNFT.RoyaltyReceiver({ receiver: issuer,   feeBps: 300 });
        vm.prank(admin);
        nft.mintCard(seller, card, rxs);
    }

    function test_gas_baseline() public view {
        // Baseline: setUp only — subtract from other tests to get function-only cost
    }
}
