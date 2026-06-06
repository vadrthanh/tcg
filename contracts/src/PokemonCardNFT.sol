// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title PokemonCardNFT — ERC-721 + EIP-2981, multi-receiver royalties, on-chain card pool
contract PokemonCardNFT is ERC721, ERC2981, AccessControl {

    // ─── Constants ────────────────────────────────────────────────────────────

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant POOL_MANAGER_ROLE = keccak256("POOL_MANAGER_ROLE");
    uint96  public constant MAX_ROYALTY_BPS = 1000; // 10 %

    // ─── Types ────────────────────────────────────────────────────────────────

    enum Rarity { Common, Uncommon, Rare, UltraRare, Legendary }

    /// @notice On-chain metadata attached to each minted token.
    struct Card {
        string  name;
        Rarity  rarity;
        string  pokemonType;
        uint16  hp;
        string  imageURI;
    }

    /// @notice Card pool template — controls supply cap and floor pricing.
    struct CardTemplate {
        uint16  cardId;
        string  name;
        Rarity  rarity;
        string  pokemonType;
        uint16  hp;
        string  attack;        // "AttackName - Damage"
        uint16  maxSupply;
        uint16  currentSupply; // incremented on each mint
        uint96  floorPrice;    // suggested listing price in wei
        string  imageURI;      // PokeAPI official-artwork URL
    }

    struct RoyaltyReceiver {
        address receiver;
        uint96  feeBps;
    }

    // ─── Card pool storage ────────────────────────────────────────────────────

    mapping(uint16 => CardTemplate)      public cardPool;
    mapping(uint16 => RoyaltyReceiver[]) private _poolRoyaltyReceivers;

    uint16[] public cardIdsByRarity_Common;
    uint16[] public cardIdsByRarity_Uncommon;
    uint16[] public cardIdsByRarity_Rare;
    uint16[] public cardIdsByRarity_UltraRare;
    uint16[] public cardIdsByRarity_Legendary;

    // ─── Token storage ────────────────────────────────────────────────────────

    uint256 private _nextTokenId;

    mapping(uint256 => Card)              private _cards;
    mapping(uint256 => RoyaltyReceiver[]) private _royaltyReceivers;
    /// @notice Pool cardId for a given tokenId (0 = freeform mint, not from pool).
    mapping(uint256 => uint16) public tokenCardId;

    // ─── Errors ───────────────────────────────────────────────────────────────

    error RoyaltyCapExceeded(uint96 total, uint96 cap);
    error InvalidReceiver();
    error EmptyReceivers();
    error CardSoldOut(uint16 cardId);
    error CardNotInPool(uint16 cardId);
    /// @dev cardId == 0 is reserved as the "freeform mint" sentinel for tokenCardId.
    error InvalidCardId();
    /// @dev maxSupply must be > 0; a template with 0 supply is indistinguishable
    ///      from an absent slot and would silently allow re-adds.
    error InvalidMaxSupply();
    /// @dev Templates are write-once. Mutating an existing card via re-add would
    ///      reset currentSupply (→ supply inflation) and duplicate the entry in
    ///      cardIdsByRarity_* (→ probability skew).
    error CardAlreadyInPool(uint16 cardId);

    // ─── Events ───────────────────────────────────────────────────────────────

    event CardMinted(address indexed to, uint256 indexed tokenId, Rarity rarity);
    event RoyaltyReceiversSet(uint256 indexed tokenId, RoyaltyReceiver[] receivers);
    event CardAddedToPool(uint16 indexed cardId, Rarity rarity, uint16 maxSupply);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address admin)
        ERC721("PokemonCardNFT", "PKMN")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POOL_MANAGER_ROLE, admin);
    }

    // ─── Pool management ──────────────────────────────────────────────────────

    /// @notice Add a single card template to the pool with its royalty receivers.
    function addCardToPool(
        CardTemplate    calldata template,
        RoyaltyReceiver[] calldata receivers
    ) external onlyRole(POOL_MANAGER_ROLE) {
        _validateAndStoreCard(template, receivers);
    }

    /// @notice Batch-add cards where every card in the batch shares the same
    ///         two royalty receivers (platform + artist). Optimised for the
    ///         deploy script seeding all 40 cards in one call.
    function batchAddCards(
        CardTemplate[] calldata templates,
        address platformAddr, uint96 platformBps,
        address artistAddr,   uint96 artistBps
    ) external onlyRole(POOL_MANAGER_ROLE) {
        RoyaltyReceiver[] memory receivers = new RoyaltyReceiver[](2);
        receivers[0] = RoyaltyReceiver({ receiver: platformAddr, feeBps: platformBps });
        receivers[1] = RoyaltyReceiver({ receiver: artistAddr,   feeBps: artistBps  });

        for (uint256 i; i < templates.length; ++i) {
            _validateAndStoreCard(templates[i], receivers);
        }
    }

    function _validateAndStoreCard(
        CardTemplate    calldata template,
        RoyaltyReceiver[] memory receivers
    ) internal {
        // Reject the sentinel cardId — 0 marks a freeform mint in tokenCardId.
        if (template.cardId == 0) revert InvalidCardId();
        // Reject zero-supply templates so cardPool[id].maxSupply is a reliable
        // "is this slot occupied?" probe for the duplicate check below.
        if (template.maxSupply == 0) revert InvalidMaxSupply();
        // Write-once: prevent supply-counter reset and rarity-array duplication.
        if (cardPool[template.cardId].maxSupply != 0) {
            revert CardAlreadyInPool(template.cardId);
        }
        if (receivers.length == 0) revert EmptyReceivers();

        uint96 totalBps;
        for (uint256 i; i < receivers.length; ++i) {
            if (receivers[i].receiver == address(0)) revert InvalidReceiver();
            totalBps += receivers[i].feeBps;
        }
        if (totalBps > MAX_ROYALTY_BPS) revert RoyaltyCapExceeded(totalBps, MAX_ROYALTY_BPS);

        // Store template (currentSupply starts at 0 regardless of what caller passes)
        CardTemplate storage stored = cardPool[template.cardId];
        stored.cardId        = template.cardId;
        stored.name          = template.name;
        stored.rarity        = template.rarity;
        stored.pokemonType   = template.pokemonType;
        stored.hp            = template.hp;
        stored.attack        = template.attack;
        stored.maxSupply     = template.maxSupply;
        stored.currentSupply = 0;
        stored.floorPrice    = template.floorPrice;
        stored.imageURI      = template.imageURI;

        // Store royalty receivers
        delete _poolRoyaltyReceivers[template.cardId];
        for (uint256 i; i < receivers.length; ++i) {
            _poolRoyaltyReceivers[template.cardId].push(receivers[i]);
        }

        // Register in rarity index
        Rarity r = template.rarity;
        if      (r == Rarity.Common)    cardIdsByRarity_Common.push(template.cardId);
        else if (r == Rarity.Uncommon)  cardIdsByRarity_Uncommon.push(template.cardId);
        else if (r == Rarity.Rare)      cardIdsByRarity_Rare.push(template.cardId);
        else if (r == Rarity.UltraRare) cardIdsByRarity_UltraRare.push(template.cardId);
        else                            cardIdsByRarity_Legendary.push(template.cardId);

        emit CardAddedToPool(template.cardId, template.rarity, template.maxSupply);
    }

    // ─── Pool views ───────────────────────────────────────────────────────────

    /// @notice Returns cardIds in `rarity` that still have remaining supply.
    function getAvailableCardIds(Rarity rarity)
        external view
        returns (uint16[] memory available)
    {
        uint16[] storage all = _rarityArray(rarity);
        uint256 count;
        for (uint256 i; i < all.length; ++i) {
            if (cardPool[all[i]].currentSupply < cardPool[all[i]].maxSupply) count++;
        }
        available = new uint16[](count);
        uint256 idx;
        for (uint256 i; i < all.length; ++i) {
            if (cardPool[all[i]].currentSupply < cardPool[all[i]].maxSupply) {
                available[idx++] = all[i];
            }
        }
    }

    /// @notice Full pool status: every cardId and its remaining supply.
    function getPoolStatus()
        external view
        returns (uint16[] memory cardIds, uint16[] memory remaining)
    {
        uint256 total = (
            cardIdsByRarity_Common.length    +
            cardIdsByRarity_Uncommon.length  +
            cardIdsByRarity_Rare.length      +
            cardIdsByRarity_UltraRare.length +
            cardIdsByRarity_Legendary.length
        );
        cardIds   = new uint16[](total);
        remaining = new uint16[](total);

        uint256 idx;
        uint16[][] memory allArrays = new uint16[][](5);
        allArrays[0] = cardIdsByRarity_Common;
        allArrays[1] = cardIdsByRarity_Uncommon;
        allArrays[2] = cardIdsByRarity_Rare;
        allArrays[3] = cardIdsByRarity_UltraRare;
        allArrays[4] = cardIdsByRarity_Legendary;

        for (uint256 a; a < 5; ++a) {
            for (uint256 i; i < allArrays[a].length; ++i) {
                uint16 id = allArrays[a][i];
                cardIds[idx]   = id;
                remaining[idx] = cardPool[id].maxSupply - cardPool[id].currentSupply;
                idx++;
            }
        }
    }

    function getCardTemplate(uint16 cardId) external view returns (CardTemplate memory) {
        return cardPool[cardId];
    }

    // ─── Minting — template-based (used by GachaPack) ─────────────────────────

    /// @notice Mint one card by template cardId. Reads metadata + royalties from
    ///         the pool, increments currentSupply, reverts if sold out.
    function mintCard(address to, uint16 cardId)
        external onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        CardTemplate storage tpl = cardPool[cardId];
        if (tpl.maxSupply == 0) revert CardNotInPool(cardId);
        if (tpl.currentSupply >= tpl.maxSupply) revert CardSoldOut(cardId);

        tpl.currentSupply++;

        Card memory data = Card({
            name:        tpl.name,
            rarity:      tpl.rarity,
            pokemonType: tpl.pokemonType,
            hp:          tpl.hp,
            imageURI:    tpl.imageURI
        });

        tokenId = _mintCardInternal(to, data, _poolRoyaltyReceivers[cardId], cardId);
    }

    // ─── Minting — freeform (kept for direct/admin minting & tests) ───────────

    /// @notice Mint one card with arbitrary metadata and royalty receivers.
    ///         Does NOT touch the card pool supply counters.
    function mintCard(
        address               to,
        Card        calldata  data,
        RoyaltyReceiver[] calldata receivers
    ) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        if (receivers.length == 0) revert EmptyReceivers();
        uint96 totalBps;
        unchecked {
            for (uint256 i; i < receivers.length; ++i) {
                if (receivers[i].receiver == address(0)) revert InvalidReceiver();
                totalBps += receivers[i].feeBps;
            }
        }
        if (totalBps > MAX_ROYALTY_BPS) revert RoyaltyCapExceeded(totalBps, MAX_ROYALTY_BPS);

        // Convert calldata array to memory for the shared internal function
        RoyaltyReceiver[] memory rxMem = new RoyaltyReceiver[](receivers.length);
        for (uint256 i; i < receivers.length; ++i) rxMem[i] = receivers[i];

        tokenId = _mintCardInternal(to, data, rxMem, 0);
    }

    /// @dev CEI: all state writes happen BEFORE _safeMint so that any
    ///      onERC721Received callback sees a fully initialised token.
    function _mintCardInternal(
        address to,
        Card memory data,
        RoyaltyReceiver[] memory receivers,
        uint16 poolCardId // 0 for freeform mints
    ) internal returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        // ── Effects (before external call) ────────────────────────────────────
        _cards[tokenId] = data;
        if (poolCardId != 0) tokenCardId[tokenId] = poolCardId;
        for (uint256 i; i < receivers.length; ++i) {
            _royaltyReceivers[tokenId].push(receivers[i]);
        }
        // ── Interaction ───────────────────────────────────────────────────────
        _safeMint(to, tokenId);
        emit CardMinted(to, tokenId, data.rarity);
        emit RoyaltyReceiversSet(tokenId, receivers);
    }

    // ─── EIP-2981 ─────────────────────────────────────────────────────────────

    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        public view override
        returns (address receiver, uint256 royaltyAmount)
    {
        RoyaltyReceiver[] storage rxs = _royaltyReceivers[tokenId];
        if (rxs.length == 0) return (address(0), 0);

        receiver      = rxs[0].receiver;
        royaltyAmount = (salePrice * rxs[0].feeBps) / 10_000;
    }

    function getRoyaltyReceivers(uint256 tokenId)
        external view
        returns (RoyaltyReceiver[] memory)
    {
        return _royaltyReceivers[tokenId];
    }

    // ─── Token metadata ───────────────────────────────────────────────────────

    function getCard(uint256 tokenId) external view returns (Card memory) {
        _requireOwned(tokenId);
        return _cards[tokenId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _cards[tokenId].imageURI;
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _rarityArray(Rarity r) internal view returns (uint16[] storage) {
        if (r == Rarity.Common)    return cardIdsByRarity_Common;
        if (r == Rarity.Uncommon)  return cardIdsByRarity_Uncommon;
        if (r == Rarity.Rare)      return cardIdsByRarity_Rare;
        if (r == Rarity.UltraRare) return cardIdsByRarity_UltraRare;
        return cardIdsByRarity_Legendary;
    }

    // ─── Interface ────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public view
        override(ERC721, ERC2981, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
