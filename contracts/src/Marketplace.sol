// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./PokemonCardNFT.sol";
import "./PaymentSplitter.sol";

/// @title Marketplace — atomic NFT-for-ETH swap with EIP-2981 royalty distribution
///
/// Security properties enforced on buyCard:
///   • CEI: listing deleted before any external call
///   • nonReentrant guard (defence-in-depth)
///   • All ETH credited to PaymentSplitter (pull-payment) — no push loops
///   • safeTransferFrom after deposit: if NFT transfer reverts, EVM unwinds the
///     deposit, preserving atomicity
contract Marketplace is Ownable, Pausable, ReentrancyGuard {

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @dev Maximum platform fee: 10 %. With max NFT royalty 10 %, sellers ≥ 80 %.
    uint256 public constant MAX_PLATFORM_FEE_BPS = 1000;

    // ─── Types ────────────────────────────────────────────────────────────────

    struct Listing {
        address seller;
        uint256 price;
    }

    // ─── Immutables ───────────────────────────────────────────────────────────

    PokemonCardNFT  public immutable nft;
    PaymentSplitter public immutable splitter;

    // ─── State ────────────────────────────────────────────────────────────────

    mapping(uint256 => Listing) public listings;

    uint256 public platformFeeBps;
    address public platformTreasury;

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotListed(uint256 tokenId);
    error AlreadyListed(uint256 tokenId);
    error NotOwner(uint256 tokenId);
    error NotApproved(uint256 tokenId);
    error PriceZero();
    error WrongPayment(uint256 sent, uint256 required);
    error NotSeller(uint256 tokenId);
    error InvalidFeeBps(uint256 bps);

    // ─── Events ───────────────────────────────────────────────────────────────

    /// @dev rarity and cardId added for frontend event indexing.
    event Listed(
        uint256 indexed tokenId,
        address indexed seller,
        uint256 price,
        PokemonCardNFT.Rarity rarity,
        uint16 cardId
    );
    event ListingCancelled(uint256 indexed tokenId, address indexed seller);
    event Purchased(
        uint256 indexed tokenId,
        address indexed buyer,
        address indexed seller,
        uint256 salePrice,
        uint256 platformFee,
        uint256 totalRoyalty,
        uint256 sellerProceeds
    );
    event PlatformConfigSet(address treasury, uint256 feeBps);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
        address _nft,
        address _splitter,
        address _platformTreasury,
        uint256 _platformFeeBps
    ) Ownable(msg.sender) {
        if (_platformFeeBps > MAX_PLATFORM_FEE_BPS) revert InvalidFeeBps(_platformFeeBps);
        nft              = PokemonCardNFT(_nft);
        splitter         = PaymentSplitter(_splitter);
        platformTreasury = _platformTreasury;
        platformFeeBps   = _platformFeeBps;
    }

    // ─── Listing management ───────────────────────────────────────────────────

    /// @notice Create a listing. Caller must own the card and have approved this
    ///         contract (via approve or setApprovalForAll) before calling.
    function listCard(uint256 tokenId, uint256 price) external whenNotPaused {
        if (price == 0) revert PriceZero();
        if (nft.ownerOf(tokenId) != msg.sender) revert NotOwner(tokenId);
        if (
            nft.getApproved(tokenId)           != address(this) &&
            !nft.isApprovedForAll(msg.sender, address(this))
        ) revert NotApproved(tokenId);
        if (listings[tokenId].price != 0) revert AlreadyListed(tokenId);

        listings[tokenId] = Listing({ seller: msg.sender, price: price });

        PokemonCardNFT.Card memory card = nft.getCard(tokenId);
        uint16 cardId = nft.tokenCardId(tokenId);
        emit Listed(tokenId, msg.sender, price, card.rarity, cardId);
    }

    /// @notice Cancel a listing. Only the original seller may cancel.
    function cancelListing(uint256 tokenId) external {
        Listing memory listing = listings[tokenId];
        if (listing.price == 0)           revert NotListed(tokenId);
        if (listing.seller != msg.sender) revert NotSeller(tokenId);
        delete listings[tokenId];
        emit ListingCancelled(tokenId, msg.sender);
    }

    // ─── Atomic swap ─────────────────────────────────────────────────────────

    /// @notice Buy a listed card. msg.value must equal the listing price exactly.
    function buyCard(uint256 tokenId) external payable whenNotPaused nonReentrant {
        // ── 1. Checks ──────────────────────────────────────────────────────────
        Listing memory listing = listings[tokenId];
        if (listing.price == 0)         revert NotListed(tokenId);
        if (msg.value != listing.price) revert WrongPayment(msg.value, listing.price);

        // ── 2. Effects (CEI) ────────────────────────────────────────────────────
        delete listings[tokenId];

        // ── 3. Compute splits ───────────────────────────────────────────────────
        uint256 salePrice   = listing.price;
        uint256 platformFee = (salePrice * platformFeeBps) / 10_000;

        PokemonCardNFT.RoyaltyReceiver[] memory rxs = nft.getRoyaltyReceivers(tokenId);
        uint256 nRxs = rxs.length;
        uint256[] memory royaltyAmts = new uint256[](nRxs);
        uint256 totalRoyalty;
        for (uint256 i; i < nRxs; ++i) {
            uint256 amt  = (salePrice * rxs[i].feeBps) / 10_000;
            royaltyAmts[i] = amt;
            totalRoyalty  += amt;
        }
        uint256 sellerProceeds = salePrice - platformFee - totalRoyalty;

        // ── 4. Deposit (pull-payment) ────────────────────────────────────────────
        uint256 nR = 1 + nRxs + 1;
        address[] memory depositRxs  = new address[](nR);
        uint256[] memory depositAmts = new uint256[](nR);
        depositRxs[0]  = platformTreasury;
        depositAmts[0] = platformFee;
        for (uint256 i; i < nRxs; ++i) {
            depositRxs[1 + i]  = rxs[i].receiver;
            depositAmts[1 + i] = royaltyAmts[i];
        }
        depositRxs[nR - 1]  = listing.seller;
        depositAmts[nR - 1] = sellerProceeds;
        splitter.deposit{value: salePrice}(depositRxs, depositAmts);

        // ── 5. Transfer (last external call — atomicity via EVM) ────────────────
        nft.safeTransferFrom(listing.seller, msg.sender, tokenId);

        emit Purchased(tokenId, msg.sender, listing.seller,
            salePrice, platformFee, totalRoyalty, sellerProceeds);
    }

    // ─── Pricing views ────────────────────────────────────────────────────────

    /// @notice Floor price from the NFT's card pool template.
    ///         Returns 0 for freeform-minted tokens (no pool template).
    function getSuggestedPrice(uint256 tokenId) external view returns (uint256) {
        uint16 cardId = nft.tokenCardId(tokenId);
        if (cardId == 0) return 0;
        return nft.getCardTemplate(cardId).floorPrice;
    }

    /// @notice Returns listing + card metadata in one RPC call — no round-trips.
    function getListingWithDetails(uint256 tokenId)
        external view
        returns (
            address seller,
            uint256 price,
            string memory name,
            uint8  rarity,
            uint16 hp,
            string memory imageURI,
            uint16 cardId,
            uint96 suggestedPrice
        )
    {
        Listing memory listing = listings[tokenId];
        PokemonCardNFT.Card memory card = nft.getCard(tokenId);
        uint16 cid = nft.tokenCardId(tokenId);
        uint96 floor = cid != 0 ? nft.getCardTemplate(cid).floorPrice : 0;

        seller        = listing.seller;
        price         = listing.price;
        name          = card.name;
        rarity        = uint8(card.rarity);
        hp            = card.hp;
        imageURI      = card.imageURI;
        cardId        = cid;
        suggestedPrice = floor;
    }

    // ─── Owner config ─────────────────────────────────────────────────────────

    function setPlatformConfig(address _treasury, uint256 _feeBps) external onlyOwner {
        if (_feeBps > MAX_PLATFORM_FEE_BPS) revert InvalidFeeBps(_feeBps);
        platformTreasury = _treasury;
        platformFeeBps   = _feeBps;
        emit PlatformConfigSet(_treasury, _feeBps);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
