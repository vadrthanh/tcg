// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./PokemonCardNFT.sol";
import "./PaymentSplitter.sol";

/// @title GachaPack — pay ETH, receive 5 weighted-random Pokémon cards from
///        the live on-chain inventory.
///
/// @notice Randomness source: keccak256(block.prevrandao, msg.sender, nonce, salt).
///   This is *pseudo-random*: a validator controlling block.prevrandao can bias
///   outcomes. VRF UPGRADE PATH: replace _random() body with a Chainlink VRF
///   request/callback — _rollRarity() and _drawFromInventory() are pure/view
///   and accept any uint256 seed, so no other code changes are needed.
///
/// Rarity weights  Common 60 | Uncommon 25 | Rare 10 | Ultra Rare 4 | Legendary 1
///
/// Falldown rule: if a rolled rarity tier has no remaining supply, the gacha
/// automatically falls to the next lower tier. This means rare cards become
/// *harder* to obtain as the supply depletes — the first Legendary ever minted
/// consumes one of the strictly limited supply slots. If ALL tiers are sold out,
/// openPack() reverts with AllCardsSoldOut().
contract GachaPack is Ownable, ReentrancyGuard {

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant CARDS_PER_PACK = 5;

    // Cumulative weight breakpoints out of 100
    uint256 private constant W_COMMON     = 60;
    uint256 private constant W_UNCOMMON   = 85;
    uint256 private constant W_RARE       = 95;
    uint256 private constant W_ULTRA_RARE = 99;
    // W_LEGENDARY = 100

    // ─── Immutables ───────────────────────────────────────────────────────────

    PokemonCardNFT  public immutable nft;
    PaymentSplitter public immutable splitter;

    // ─── State ────────────────────────────────────────────────────────────────

    uint256 public packPrice;
    address public platformTreasury;
    address public issuer;
    uint256 public platformFeeBps;

    uint256 private _nonce;

    // ─── Errors ───────────────────────────────────────────────────────────────

    error WrongPayment(uint256 sent, uint256 required);
    error InvalidFeeBps(uint256 bps);
    error AllCardsSoldOut();

    // ─── Events ───────────────────────────────────────────────────────────────

    /// @dev cardIds added for frontend "which specific card did I get?" display.
    event PackOpened(
        address indexed buyer,
        uint256[5]      tokenIds,
        uint16[5]       cardIds,
        uint8[5]        rarities
    );
    event PackPriceSet(uint256 newPrice);
    event RevenueConfigSet(address platformTreasury, address issuer, uint256 platformFeeBps);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
        address _nft,
        address _splitter,
        address _platformTreasury,
        address _issuer,
        uint256 _platformFeeBps
    ) Ownable(msg.sender) {
        if (_platformFeeBps > 10_000) revert InvalidFeeBps(_platformFeeBps);
        nft              = PokemonCardNFT(_nft);
        splitter         = PaymentSplitter(_splitter);
        packPrice        = 0.01 ether;
        platformTreasury = _platformTreasury;
        issuer           = _issuer;
        platformFeeBps   = _platformFeeBps;
    }

    // ─── Core: open a pack ────────────────────────────────────────────────────

    /// @notice Pay exactly packPrice ETH to receive CARDS_PER_PACK NFTs drawn
    ///         from the live card pool. Reverts if the pool is fully depleted.
    function openPack() external payable nonReentrant {
        if (msg.value != packPrice) revert WrongPayment(msg.value, packPrice);

        uint256[5] memory tokenIds;
        uint16[5]  memory cardIds;
        uint8[5]   memory rarities;

        for (uint256 i; i < CARDS_PER_PACK; ++i) {
            uint256 rand = _random(i);
            PokemonCardNFT.Rarity rolled = _rollRarity(rand);

            // Draw from inventory — falls down if the rolled tier is sold out.
            (uint16 cardId, PokemonCardNFT.Rarity actual) =
                _drawFromInventory(rolled, rand >> 8);

            uint256 tokenId = nft.mintCard(msg.sender, cardId);
            tokenIds[i] = tokenId;
            cardIds[i]  = cardId;
            rarities[i] = uint8(actual);
        }

        _routeRevenue();
        emit PackOpened(msg.sender, tokenIds, cardIds, rarities);
    }

    // ─── Owner configuration ──────────────────────────────────────────────────

    function setPackPrice(uint256 newPrice) external onlyOwner {
        packPrice = newPrice;
        emit PackPriceSet(newPrice);
    }

    function setRevenueConfig(
        address _platformTreasury,
        address _issuer,
        uint256 _platformFeeBps
    ) external onlyOwner {
        if (_platformFeeBps > 10_000) revert InvalidFeeBps(_platformFeeBps);
        platformTreasury = _platformTreasury;
        issuer           = _issuer;
        platformFeeBps   = _platformFeeBps;
        emit RevenueConfigSet(_platformTreasury, _issuer, _platformFeeBps);
    }

    // ─── Internal: randomness ─────────────────────────────────────────────────

    /// @dev VRF UPGRADE POINT — replace this body with a Chainlink VRF callback.
    function _random(uint256 salt) internal returns (uint256) {
        return uint256(
            keccak256(abi.encode(block.prevrandao, msg.sender, _nonce++, salt))
        );
    }

    // ─── Internal: rarity selection ───────────────────────────────────────────

    /// @dev Cumulative-weight lookup, O(1).
    ///      Roll ∈ [0,100): <60→Common, <85→Uncommon, <95→Rare, <99→UltraRare, else Legendary
    function _rollRarity(uint256 rand) internal pure returns (PokemonCardNFT.Rarity) {
        uint256 roll = rand % 100;
        if (roll < W_COMMON)     return PokemonCardNFT.Rarity.Common;
        if (roll < W_UNCOMMON)   return PokemonCardNFT.Rarity.Uncommon;
        if (roll < W_RARE)       return PokemonCardNFT.Rarity.Rare;
        if (roll < W_ULTRA_RARE) return PokemonCardNFT.Rarity.UltraRare;
        return PokemonCardNFT.Rarity.Legendary;
    }

    // ─── Internal: inventory draw with falldown ───────────────────────────────

    /// @notice Try `rarity`; if empty, fall down one tier at a time until stock
    ///         is found or all tiers are exhausted (→ AllCardsSoldOut).
    ///
    ///         The falldown makes rare tiers progressively harder to obtain as
    ///         supply depletes, without ever giving a *higher* rarity as a
    ///         consolation (only equal-or-lower).
    function _drawFromInventory(
        PokemonCardNFT.Rarity rarity,
        uint256               pickSeed
    ) internal view returns (uint16 cardId, PokemonCardNFT.Rarity actual) {
        // Cast to signed so the loop can decrement past 0 and stop cleanly.
        for (int256 r = int256(uint256(rarity)); r >= 0; r--) {
            PokemonCardNFT.Rarity tier =
                PokemonCardNFT.Rarity(uint256(r));
            uint16[] memory avail = nft.getAvailableCardIds(tier);
            if (avail.length > 0) {
                return (avail[pickSeed % avail.length], tier);
            }
        }
        revert AllCardsSoldOut();
    }

    // ─── Internal: revenue routing ────────────────────────────────────────────

    function _routeRevenue() internal {
        uint256 platformAmt = (msg.value * platformFeeBps) / 10_000;
        uint256 issuerAmt   = msg.value - platformAmt;

        address[] memory receivers = new address[](2);
        receivers[0] = platformTreasury;
        receivers[1] = issuer;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = platformAmt;
        amounts[1] = issuerAmt;

        splitter.deposit{value: msg.value}(receivers, amounts);
    }
}
