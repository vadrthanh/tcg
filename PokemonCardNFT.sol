// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PokemonCardNFT
 * @notice ERC-721 NFT contract with on-chain card pool, EIP-2981 multi-receiver royalties,
 *         and inventory tracking across 5 rarity tiers.
 * @dev Person 1 deliverable — Phase A (Days 1–3) + Phase C–D gas optimisation.
 */
contract PokemonCardNFT is ERC721, ERC721Enumerable, AccessControl, ReentrancyGuard {
    // ─────────────────────────────────────────────────────────────────────────
    // Roles
    // ─────────────────────────────────────────────────────────────────────────

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant POOL_MANAGER_ROLE = keccak256("POOL_MANAGER_ROLE");

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    uint16 public constant MAX_ROYALTY_BPS = 1000; // 10 %

    // ─────────────────────────────────────────────────────────────────────────
    // Rarity enum
    // ─────────────────────────────────────────────────────────────────────────

    enum Rarity {
        Common,    // 0
        Uncommon,  // 1
        Rare,      // 2
        UltraRare, // 3
        Legendary  // 4
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CardTemplate — packed into as few 32-byte slots as possible
    // ─────────────────────────────────────────────────────────────────────────

    struct CardTemplate {
        uint16  cardId;           // slot 0 (2)
        Rarity  rarity;           // slot 0 (1)  — enum stored as uint8
        uint8   pokemonType;      // slot 0 (1)  — 0=Fire,1=Water,2=Grass,3=Lightning,4=Psychic,5=Fighting,6=Colorless
        uint16  hp;               // slot 0 (2)
        uint16  maxSupply;        // slot 0 (2)
        uint16  currentSupply;    // slot 0 (2)  — incremented on every mint
        uint96  floorPrice;       // slot 0 (12) — wei; fits with address in one slot
        // slot 1:
        string  name;
        // slot 2:
        string  attack;
        // slot 3:
        string  imageURI;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Royalty receiver record
    // ─────────────────────────────────────────────────────────────────────────

    struct RoyaltyReceiver {
        address receiver;
        uint16  feeBps; // basis points, e.g. 500 = 5 %
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Pool storage
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev cardId → template (packed struct)
    mapping(uint16 => CardTemplate) public cardPool;

    /// @dev rarity → array of cardIds in that tier
    mapping(Rarity => uint16[]) private _rarityIndex;

    /// @dev tokenId → cardId (set at mint time)
    mapping(uint256 => uint16) public tokenCardId;

    /// @dev tokenId → royalty receivers (set at mint time, immutable after)
    mapping(uint256 => RoyaltyReceiver[]) private _royaltyReceivers;

    /// @dev monotonically increasing token counter
    uint256 private _nextTokenId;

    // ─────────────────────────────────────────────────────────────────────────
    // Custom errors
    // ─────────────────────────────────────────────────────────────────────────

    error CardDoesNotExist(uint16 cardId);
    error CardSoldOut(uint16 cardId);
    error CardAlreadyInPool(uint16 cardId);
    error RoyaltyTooHigh(uint16 total);
    error EmptyCardInput();
    error ZeroAddress();

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event CardAddedToPool(uint16 indexed cardId, Rarity rarity, string name, uint16 maxSupply);
    event CardMinted(uint256 indexed tokenId, uint16 indexed cardId, address indexed to, Rarity rarity);

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(address admin) ERC721("PokemonCardNFT", "PKMN") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POOL_MANAGER_ROLE, admin);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Pool management — POOL_MANAGER_ROLE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Add multiple card templates to the pool in a single transaction.
     * @dev Reads array of CardTemplate, pushes each to the correct rarity index.
     *      Reverts if any cardId is already registered.
     * @param templates Array of CardTemplate structs (cardId must be unique).
     */
    function batchAddCards(CardTemplate[] calldata templates)
        external
        onlyRole(POOL_MANAGER_ROLE)
    {
        uint256 len = templates.length;
        if (len == 0) revert EmptyCardInput();

        for (uint256 i = 0; i < len; ) {
            CardTemplate calldata t = templates[i];

            if (cardPool[t.cardId].maxSupply != 0) revert CardAlreadyInPool(t.cardId);

            // Validate royalties would be checked at mint, not here (receivers stored per-token).

            cardPool[t.cardId] = CardTemplate({
                cardId:          t.cardId,
                rarity:          t.rarity,
                pokemonType:     t.pokemonType,
                hp:              t.hp,
                maxSupply:       t.maxSupply,
                currentSupply:   0,
                floorPrice:      t.floorPrice,
                name:            t.name,
                attack:          t.attack,
                imageURI:        t.imageURI
            });

            _rarityIndex[t.rarity].push(t.cardId);

            emit CardAddedToPool(t.cardId, t.rarity, t.name, t.maxSupply);

            unchecked { ++i; }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Minting — MINTER_ROLE only (GachaPack)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Mint a single card NFT to `to`.
     * @dev Reads template from cardPool, increments currentSupply, reverts if at max.
     *      Stores royalty receivers for this token.
     * @param to            Recipient address.
     * @param cardId        Must exist in cardPool.
     * @param receivers     Royalty receivers for this token (sum of feeBps ≤ MAX_ROYALTY_BPS).
     * @return tokenId      The minted token ID.
     */
    function mintCard(
        address to,
        uint16 cardId,
        RoyaltyReceiver[] calldata receivers
    )
        external
        onlyRole(MINTER_ROLE)
        nonReentrant
        returns (uint256 tokenId)
    {
        if (to == address(0)) revert ZeroAddress();

        CardTemplate storage tmpl = cardPool[cardId];
        if (tmpl.maxSupply == 0) revert CardDoesNotExist(cardId);
        if (tmpl.currentSupply >= tmpl.maxSupply) revert CardSoldOut(cardId);

        // Validate royalty sum
        uint16 totalBps = 0;
        for (uint256 i = 0; i < receivers.length; ) {
            totalBps += receivers[i].feeBps;
            unchecked { ++i; }
        }
        if (totalBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh(totalBps);

        // Increment supply before external call (CEI)
        unchecked { ++tmpl.currentSupply; }

        tokenId = _nextTokenId;
        unchecked { ++_nextTokenId; }

        tokenCardId[tokenId] = cardId;

        // Store royalty receivers
        for (uint256 i = 0; i < receivers.length; ) {
            _royaltyReceivers[tokenId].push(receivers[i]);
            unchecked { ++i; }
        }

        _safeMint(to, tokenId);

        emit CardMinted(tokenId, cardId, to, tmpl.rarity);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View functions
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Return all cardIds for a given rarity where currentSupply < maxSupply.
     * @dev O(n) over _rarityIndex[rarity]. Used by GachaPack before drawing.
     */
    function getAvailableCardIds(Rarity rarity)
        external
        view
        returns (uint16[] memory available)
    {
        uint16[] storage all = _rarityIndex[rarity];
        uint256 total = all.length;

        // Two-pass: count first, then fill
        uint256 count = 0;
        for (uint256 i = 0; i < total; ) {
            if (cardPool[all[i]].currentSupply < cardPool[all[i]].maxSupply) {
                unchecked { ++count; }
            }
            unchecked { ++i; }
        }

        available = new uint16[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < total; ) {
            uint16 cId = all[i];
            if (cardPool[cId].currentSupply < cardPool[cId].maxSupply) {
                available[idx] = cId;
                unchecked { ++idx; }
            }
            unchecked { ++i; }
        }
    }

    /**
     * @notice Return the full CardTemplate for a given cardId.
     */
    function getCardTemplate(uint16 cardId)
        external
        view
        returns (CardTemplate memory)
    {
        if (cardPool[cardId].maxSupply == 0) revert CardDoesNotExist(cardId);
        return cardPool[cardId];
    }

    /**
     * @notice Return all cardIds across every rarity tier plus their remaining supply.
     *         Designed to be consumed in a single RPC call by the frontend.
     * @return cardIds      Flat array of all registered cardIds.
     * @return remaining    Remaining supply per cardId (parallel array).
     */
    function getPoolStatus()
        external
        view
        returns (uint16[] memory cardIds, uint256[] memory remaining)
    {
        // Count total cards
        uint256 total = 0;
        for (uint8 r = 0; r <= uint8(Rarity.Legendary); ) {
            total += _rarityIndex[Rarity(r)].length;
            unchecked { ++r; }
        }

        cardIds   = new uint16[](total);
        remaining = new uint256[](total);

        uint256 idx = 0;
        for (uint8 r = 0; r <= uint8(Rarity.Legendary); ) {
            uint16[] storage tier = _rarityIndex[Rarity(r)];
            for (uint256 i = 0; i < tier.length; ) {
                uint16 cId = tier[i];
                cardIds[idx]   = cId;
                remaining[idx] = cardPool[cId].maxSupply - cardPool[cId].currentSupply;
                unchecked { ++idx; ++i; }
            }
            unchecked { ++r; }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EIP-2981 — royalty info
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Return all royalty receivers for a given tokenId.
     *         Called by Marketplace before distributing proceeds.
     */
    function getRoyaltyReceivers(uint256 tokenId)
        external
        view
        returns (RoyaltyReceiver[] memory)
    {
        return _royaltyReceivers[tokenId];
    }

    /**
     * @notice EIP-2981 single-receiver interface (returns first receiver only).
     *         Full multi-receiver logic lives in getRoyaltyReceivers().
     */
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        external
        view
        returns (address receiver, uint256 royaltyAmount)
    {
        RoyaltyReceiver[] storage recs = _royaltyReceivers[tokenId];
        if (recs.length == 0) return (address(0), 0);
        receiver = recs[0].receiver;
        royaltyAmount = (salePrice * recs[0].feeBps) / 10_000;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Token URI
    // ─────────────────────────────────────────────────────────────────────────

    function tokenURI(uint256 tokenId)
        public
        view
        override
        returns (string memory)
    {
        _requireOwned(tokenId);
        uint16 cId = tokenCardId[tokenId];
        return cardPool[cId].imageURI;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Suggested price helper (used by Marketplace)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Return the floor price for the card template linked to tokenId.
     *         The Marketplace reads this as a pricing hint for sellers.
     */
    function getSuggestedPrice(uint256 tokenId) external view returns (uint96) {
        uint16 cId = tokenCardId[tokenId];
        return cardPool[cId].floorPrice;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Required overrides
    // ─────────────────────────────────────────────────────────────────────────

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable, AccessControl)
        returns (bool)
    {
        // EIP-2981 interface ID
        return interfaceId == 0x2a55205a || super.supportsInterface(interfaceId);
    }
}
