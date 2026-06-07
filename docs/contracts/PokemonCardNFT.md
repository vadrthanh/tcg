# `PokemonCardNFT.sol`

ERC-721 collectible token with EIP-2981 royalty info and an on-chain "card
pool" that gates supply and per-card metadata. The only contract in the system
that ever calls `_safeMint` or stores card data.

- **Inherits:** `ERC721`, `ERC2981`, `AccessControl`, `Ownable` (OpenZeppelin v5)
- **Solidity:** `0.8.24`, optimizer 200 runs, EVM `cancun`
- **Lines:** 343 (post-H-01 patch)

---

## 1. Purpose & scope

- Defines a fixed catalogue of *card templates* (`CardTemplate`) seeded once
  by the admin. Each template encodes name, rarity, type, HP, attack string,
  max supply, floor price, image URI, and a per-card royalty receiver list.
- Mints ERC-721 tokens from those templates on demand, copying the template's
  metadata onto the token (`Card`) and persisting the royalty list per token.
- Reports royalties via the standard EIP-2981 entry point (caveat in
  [audit M-01](../audit.md)) and exposes a multi-receiver getter that the
  in-app Marketplace uses for full per-token split data.

**Not responsible for:** ETH movement, listing state, or trading. Pure
collectible + metadata + royalty registry.

---

## 2. State

### 2.1 Roles & ownership

| Slot                    | Type     | Notes |
|-------------------------|----------|-------|
| `MINTER_ROLE`           | `bytes32 constant` | `keccak256("MINTER_ROLE")` — granted to `GachaPack` after deploy |
| `MAX_ROYALTY_BPS`       | `uint96  constant` | 1 000 (10 %) — sum-of-receivers cap |
| `Ownable._owner`        | `address` | Pool admin; can add templates |
| `AccessControl._roles`  | `mapping`  | Holds `DEFAULT_ADMIN_ROLE` + `MINTER_ROLE` |

### 2.2 Card pool

| Slot                                | Type                                          | Notes |
|-------------------------------------|-----------------------------------------------|-------|
| `cardPool`                          | `mapping(uint16 => CardTemplate)`             | cardId → template; **write-once** after H-01 |
| `_poolRoyaltyReceivers`             | `mapping(uint16 => RoyaltyReceiver[])` priv. | Royalty receivers per template |
| `cardIdsByRarity_Common`            | `uint16[]`                                    | Rarity index — pushed once per `addCardToPool` |
| `cardIdsByRarity_Uncommon`          | `uint16[]`                                    | "" |
| `cardIdsByRarity_Rare`              | `uint16[]`                                    | "" |
| `cardIdsByRarity_UltraRare`         | `uint16[]`                                    | "" |
| `cardIdsByRarity_Legendary`         | `uint16[]`                                    | "" |

### 2.3 Token storage

| Slot                  | Type                                  | Notes |
|-----------------------|---------------------------------------|-------|
| `_nextTokenId`        | `uint256`                             | Post-increment counter starting at 0 |
| `_cards`              | `mapping(uint256 => Card)`            | Per-token metadata snapshot |
| `_royaltyReceivers`   | `mapping(uint256 => RoyaltyReceiver[])` | Per-token royalty list — set at mint, **never mutated** |
| `tokenCardId`         | `mapping(uint256 => uint16)` public   | Pool cardId, or 0 for freeform mints |

### 2.4 Types

```solidity
enum Rarity { Common, Uncommon, Rare, UltraRare, Legendary }

struct Card {
    string  name;
    Rarity  rarity;
    string  pokemonType;
    uint16  hp;
    string  imageURI;
}

struct CardTemplate {
    uint16  cardId;
    string  name;
    Rarity  rarity;
    string  pokemonType;
    uint16  hp;
    string  attack;
    uint16  maxSupply;
    uint16  currentSupply;   // managed by the contract, not the caller
    uint96  floorPrice;
    string  imageURI;
}

struct RoyaltyReceiver { address receiver; uint96 feeBps; }
```

Storage packing: `RoyaltyReceiver` fits exactly one slot (`address` + `uint96`).

---

## 3. External / public API

### 3.1 Admin entry points (`onlyOwner`)

#### `addCardToPool(CardTemplate template, RoyaltyReceiver[] receivers)`

Add a single template. Write-once after H-01: reverts if `template.cardId == 0`
(`InvalidCardId`), `template.maxSupply == 0` (`InvalidMaxSupply`), or the
cardId is already present (`CardAlreadyInPool`).

Other checks:

- `receivers.length > 0`
- every receiver address is non-zero
- `Σ feeBps ≤ MAX_ROYALTY_BPS`

Side effects: writes template (forces `currentSupply = 0`), pushes receivers,
appends `cardId` to the matching rarity array. Emits `CardAddedToPool`.

#### `batchAddCards(CardTemplate[] templates, address platform, uint96 pBps, address artist, uint96 aBps)`

Bulk-add helper used by the deploy script. Every template in the batch shares
the same two-receiver royalty split. Each template still goes through
`_validateAndStoreCard`, so the H-01 guards (cardId != 0, maxSupply > 0,
not-already-in-pool) apply per element. **One revert reverts the entire batch.**

### 3.2 Minting (`onlyRole(MINTER_ROLE)`)

#### `mintCard(address to, uint16 cardId) → uint256 tokenId`

Pool-based mint. Reads template, increments `currentSupply`, reverts
`CardNotInPool` if the slot is empty or `CardSoldOut` if at cap. Copies
metadata to a per-token `Card`, copies pool royalty list to per-token
`_royaltyReceivers`, then `_safeMint`.

#### `mintCard(address to, Card data, RoyaltyReceiver[] receivers) → uint256 tokenId`

Freeform mint. Does **not** touch pool supply counters; the caller supplies
arbitrary metadata and royalty receivers. Used by tests; not called by
`GachaPack`. Subject to the same royalty cap and receiver checks. Sets
`tokenCardId[tokenId] = 0`, which downstream code interprets as "no template".

### 3.3 Views

| Function | Returns | Notes |
|---|---|---|
| `getCardTemplate(uint16 cardId)` | `CardTemplate` | Raw template (zero-filled if absent) |
| `getAvailableCardIds(Rarity r)` | `uint16[]` | Subset of rarity array where `currentSupply < maxSupply`. O(n) per call. |
| `getPoolStatus()` | `(uint16[] ids, uint16[] remaining)` | Full pool snapshot in one call |
| `getCard(uint256 tokenId)` | `Card` | Reverts if token does not exist |
| `getRoyaltyReceivers(uint256 tokenId)` | `RoyaltyReceiver[]` | Used by Marketplace for multi-receiver split |
| `royaltyInfo(uint256 tokenId, uint256 salePrice)` | `(address, uint256)` | EIP-2981 — **see audit M-01** |
| `tokenURI(uint256 tokenId)` | `string` | Returns raw `imageURI` — **see audit L-03** |
| `supportsInterface(bytes4)` | `bool` | ERC-721, ERC-2981, AccessControl |

---

## 4. Internal helpers worth understanding

### `_validateAndStoreCard(template, receivers)`

The single mutation path for the pool. After the H-01 patch:

```
1. Reject cardId == 0
2. Reject maxSupply == 0
3. Reject duplicate cardId (cardPool[id].maxSupply != 0 ⇒ slot occupied)
4. Reject empty receivers / zero-address receivers
5. Reject total feeBps > MAX_ROYALTY_BPS
6. Copy template fields into storage (force currentSupply = 0)
7. delete _poolRoyaltyReceivers[id]; push new receivers (safety belt; slot is
   provably empty after the duplicate check, so this is a no-op today)
8. Push cardId into the matching rarity array
9. Emit CardAddedToPool(cardId, rarity, maxSupply)
```

### `_mintCardInternal(to, data, receivers, poolCardId)`

CEI-ordered mint helper. Writes `_cards`, `tokenCardId` (only if non-zero),
and `_royaltyReceivers` **before** calling `_safeMint`. This ordering ensures
any `onERC721Received` callback observes a fully initialised token. Fixed in
a prior audit pass.

### `_rarityArray(Rarity r) → uint16[] storage`

Returns the matching `cardIdsByRarity_*` storage pointer. Used by the
available-ids and pool-status views.

---

## 5. Events

| Event | Trigger | Indexed |
|---|---|---|
| `CardMinted(address to, uint256 tokenId, Rarity rarity)` | every mint | `to`, `tokenId` |
| `RoyaltyReceiversSet(uint256 tokenId, RoyaltyReceiver[] receivers)` | **freeform `mintCard` only** | `tokenId` |
| `CardAddedToPool(uint16 cardId, Rarity rarity, uint16 maxSupply)` | `addCardToPool` / `batchAddCards` | `cardId` |

> **Pool/gacha mints do not emit `RoyaltyReceiversSet`.** To save gas, a
> template-based `mintCard(to, cardId)` stores only the `tokenId → cardId` link
> and derives royalties from the pool template on read. The receivers were
> already announced once via `CardAddedToPool` and are queryable per token via
> `getRoyaltyReceivers(tokenId)` / EIP-2981 `royaltyInfo(tokenId, salePrice)` —
> the standard, view-based discovery path. The event still fires for **freeform**
> mints, which carry per-token royalty data with no template behind it.

The standard `Transfer`, `Approval`, `ApprovalForAll`, `RoleGranted`,
`RoleRevoked`, `OwnershipTransferred` events also fire (inherited).

---

## 6. Errors

| Error | Trigger |
|---|---|
| `RoyaltyCapExceeded(uint96 total, uint96 cap)` | `Σ feeBps > MAX_ROYALTY_BPS` |
| `InvalidReceiver()` | `receiver == address(0)` |
| `EmptyReceivers()` | `receivers.length == 0` |
| `CardSoldOut(uint16 cardId)` | `currentSupply >= maxSupply` at mint time |
| `CardNotInPool(uint16 cardId)` | `maxSupply == 0` at mint time |
| `InvalidCardId()` *(H-01 patch)* | `template.cardId == 0` |
| `InvalidMaxSupply()` *(H-01 patch)* | `template.maxSupply == 0` |
| `CardAlreadyInPool(uint16 cardId)` *(H-01 patch)* | duplicate `addCardToPool` / `batchAddCards` |

Inherited revert paths: `ERC721NonexistentToken`, `ERC721InvalidOwner`,
`AccessControlUnauthorizedAccount`, `OwnableUnauthorizedAccount`.

---

## 7. Invariants & threat model

| Invariant | Enforced by |
|---|---|
| `currentSupply[cardId] ≤ maxSupply[cardId]` for every cardId | `mintCard` `CardSoldOut` check + H-01 write-once guard |
| Σ `feeBps` in `_royaltyReceivers[tokenId]` ≤ `MAX_ROYALTY_BPS` | All mint paths validate before storing |
| Token `_royaltyReceivers[tokenId]` is set exactly once (at mint) and never mutated | No external function writes to it post-mint |
| `tokenCardId[tokenId] == 0` ⇔ token came from the freeform mint path | H-01 forbids cardId = 0 in templates |
| `cardIdsByRarity_X` contains no duplicate cardIds | H-01 duplicate guard |

**Trusts:**
- `owner` (pool admin) to publish honest templates and royalty splits.
- `MINTER_ROLE` (GachaPack) to call only `mintCard(to, cardId)` with
  user-derived inputs.

**Does not trust:** any `to` address (uses `_safeMint`, but writes effects
before the callback per CEI).

---

## 8. Gas profile (Foundry, optimizer 200 runs)

| Operation                    | Gas    |
|------------------------------|--------|
| `mintCard(to, cardId)` cold  | ~282 k |
| `addCardToPool` (1 receiver) | ~140 k |
| `batchAddCards` (10 templates) | ~1.1 M |
| `getAvailableCardIds` (5 cards in rarity) | ~5 k (view) |
| `royaltyInfo` (3 receivers) | ~3 k (view) |

(Full report in `contracts/.gas-snapshot` and `docs/architecture.md` §4.)

---

## 9. Known limitations

- **M-01**: `royaltyInfo` returns Σ bps to a single receiver; external
  marketplaces will pay 100 % to `_royaltyReceivers[tokenId][0]`. Internal
  Marketplace bypasses this via `getRoyaltyReceivers`.
- **L-02**: Constructor does not zero-check `admin`.
- **L-03**: `tokenURI` returns the raw image URL, not a JSON metadata URI.
- **I-01**: Dual auth surface (Ownable + AccessControl).

See [`docs/audit.md`](../audit.md) for full discussion and remediations.
