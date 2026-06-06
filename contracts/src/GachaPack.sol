// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./PokemonCardNFT.sol";
import "./PaymentSplitter.sol";

/// @title GachaPack — pay ETH, receive 5 weighted-random Pokémon cards from
///        the live on-chain inventory.
///
/// @notice TWO-STEP COMMIT–REVEAL randomness.
///   A pack is opened in two transactions:
///     1. commitPack() — pay exactly packPrice. The pack price is routed to the
///        splitter immediately and the caller's current block number is recorded.
///     2. revealPack() — in a *later* block, the 5-card outcome is derived from
///        blockhash(commitBlock), which did not exist when the buyer paid.
///
///   Why two steps? If the draw and the payment happened in the same
///   transaction (as a single openPack() once did), a contract caller could
///   simulate the outcome and revert the whole transaction unless a high-rarity
///   card was drawn — paying only on favourable rolls and draining the scarce
///   tiers for free. Splitting pay from reveal makes the outcome unknowable at
///   payment time, so the buyer is committed to whatever blockhash(commitBlock)
///   later produces. See docs/audit.md.
///
///   RESIDUAL RISK: the proposer of the reveal block can still bias/withhold
///   blockhash(commitBlock). That is a far weaker, validator-only vector than
///   the free re-roll above. For production value, replace the seed source in
///   revealPack() with Chainlink VRF — _rollRarity()/_drawFromInventory() are
///   pure/view and accept any uint256 seed, so no other code changes are needed.
///
///   REVEAL WINDOW: blockhash() only exposes the last 256 blocks, so a commit
///   must be revealed within REVEAL_WINDOW blocks. A commit that is never
///   revealed forfeits its cards (the pack price was already collected at
///   commit); after the window passes the buyer may commit again.
///
/// Rarity weights  Common 60 | Uncommon 25 | Rare 10 | Ultra Rare 4 | Legendary 1
///
/// Falldown rule: if a rolled rarity tier has no remaining supply, the gacha
/// automatically falls to the next lower tier. This means rare cards become
/// *harder* to obtain as the supply depletes — the first Legendary ever minted
/// consumes one of the strictly limited supply slots. If ALL tiers are sold out,
/// revealPack() reverts with AllCardsSoldOut().
contract GachaPack is Ownable, ReentrancyGuard {

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant CARDS_PER_PACK = 5;

    /// @dev Max age (in blocks) at which blockhash(commitBlock) is still
    ///      available. Matches the EVM's 256-block blockhash horizon.
    uint256 public constant REVEAL_WINDOW = 256;

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

    /// @notice Block number of each buyer's unrevealed commit (0 = none).
    mapping(address => uint256) public commitBlockOf;

    // ─── Errors ───────────────────────────────────────────────────────────────

    error WrongPayment(uint256 sent, uint256 required);
    error InvalidFeeBps(uint256 bps);
    error AllCardsSoldOut();
    error PendingCommitExists();
    error NoPendingCommit();
    error RevealTooEarly();
    error CommitExpired();

    // ─── Events ───────────────────────────────────────────────────────────────

    /// @notice Emitted when a buyer pays for a pack. The pack may be revealed
    ///         once a block after `commitBlock` and before `commitBlock + REVEAL_WINDOW`.
    event PackCommitted(address indexed buyer, uint256 commitBlock);

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

    // ─── Core: commit then reveal ───────────────────────────────────────────────

    /// @notice Step 1 — pay exactly packPrice ETH to commit to a pack. Revenue is
    ///         routed to the splitter immediately; the cards are drawn later in
    ///         revealPack(). The outcome is not knowable at this point.
    /// @dev A buyer may hold only one unrevealed, unexpired commit at a time.
    function commitPack() external payable nonReentrant {
        if (msg.value != packPrice) revert WrongPayment(msg.value, packPrice);

        uint256 existing = commitBlockOf[msg.sender];
        if (existing != 0 && block.number <= existing + REVEAL_WINDOW) {
            revert PendingCommitExists();
        }

        commitBlockOf[msg.sender] = block.number;

        // Collect revenue up front so a buyer cannot avoid paying for an
        // unfavourable outcome by simply never revealing.
        _routeRevenue();

        emit PackCommitted(msg.sender, block.number);
    }

    /// @notice Step 2 — draw and mint CARDS_PER_PACK NFTs for a prior commit,
    ///         using blockhash(commitBlock) as the randomness seed. Must be
    ///         called in a later block than the commit and within REVEAL_WINDOW
    ///         blocks of it. Reverts AllCardsSoldOut if the pool is fully depleted.
    function revealPack() external nonReentrant {
        uint256 commitBlock = commitBlockOf[msg.sender];
        if (commitBlock == 0)                              revert NoPendingCommit();
        if (block.number <= commitBlock)                   revert RevealTooEarly();
        if (block.number > commitBlock + REVEAL_WINDOW)    revert CommitExpired();

        // Within the window above, blockhash(commitBlock) is guaranteed non-zero.
        uint256 seed = uint256(keccak256(abi.encode(blockhash(commitBlock), msg.sender)));

        // CEI: clear the commit before any external mint call.
        delete commitBlockOf[msg.sender];

        uint256[5] memory tokenIds;
        uint16[5]  memory cardIds;
        uint8[5]   memory rarities;

        for (uint256 i; i < CARDS_PER_PACK; ++i) {
            uint256 rand = uint256(keccak256(abi.encode(seed, i)));
            PokemonCardNFT.Rarity rolled = _rollRarity(rand);

            // Draw from inventory — falls down if the rolled tier is sold out.
            (uint16 cardId, PokemonCardNFT.Rarity actual) =
                _drawFromInventory(rolled, rand >> 8);

            uint256 tokenId = nft.mintCard(msg.sender, cardId);
            tokenIds[i] = tokenId;
            cardIds[i]  = cardId;
            rarities[i] = uint8(actual);
        }

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
