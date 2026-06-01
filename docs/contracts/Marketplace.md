# `Marketplace.sol`

Atomic NFT-for-ETH swap with multi-receiver royalty distribution. The only
place secondary-market trades happen.

- **Inherits:** `Ownable`, `ReentrancyGuard` (OpenZeppelin v5)
- **Solidity:** `0.8.24`
- **Lines:** 215

---

## 1. Purpose & scope

- **Listing:** seller publishes `tokenId → price`. The seller must already
  own the NFT and have approved the marketplace (per-token `approve` or
  `setApprovalForAll`).
- **Buying:** buyer pays `price` ETH; in one transaction the contract deletes
  the listing, deposits all wei to the splitter (split between platform,
  royalty receivers, and seller), then transfers the NFT.
- **Cancellation:** original seller can revoke their listing at any time.

**Not responsible for:** auctions, bids, offers, expirations, off-chain
order books, or any push-style ETH transfer.

---

## 2. State

### 2.1 Constants

| Slot | Value | Notes |
|------|-------|-------|
| `MAX_PLATFORM_FEE_BPS` | `1000` (10 %) | Enforced in constructor and `setPlatformConfig` |

### 2.2 Immutables

| Slot       | Type                | Notes |
|------------|---------------------|-------|
| `nft`      | `PokemonCardNFT`    | Set in constructor |
| `splitter` | `PaymentSplitter`   | Set in constructor |

### 2.3 Mutable state

| Slot               | Type                            | Notes |
|--------------------|---------------------------------|-------|
| `listings`         | `mapping(uint256 => Listing)`   | `tokenId → {seller, price}`. `price == 0` ⇔ unlisted |
| `platformFeeBps`   | `uint256`                       | ≤ 1 000 |
| `platformTreasury` | `address`                       | Owner-configurable |

### 2.4 Types

```solidity
struct Listing { address seller; uint256 price; }
```

Two storage slots per listing (no packing — `price` is `uint256`).

---

## 3. External / public API

### `listCard(uint256 tokenId, uint256 price)`

Create a listing.

**Checks:**
- `price > 0`                        → `PriceZero`
- `nft.ownerOf(tokenId) == msg.sender` → `NotOwner`
- marketplace approved (per-token or for-all) → `NotApproved`
- `listings[tokenId].price == 0`     → `AlreadyListed`

**Effect:** `listings[tokenId] = {msg.sender, price}`.

**Emits:** `Listed(tokenId, seller, price, rarity, cardId)` — rarity and
cardId are fetched from the NFT for frontend indexing.

**No re-check** of ownership/approval at buy time — see [audit M-03](../audit.md)
for the stale-listing griefing path.

### `cancelListing(uint256 tokenId)`

Only the original `listing.seller` may cancel.

**Checks:**
- `listing.price != 0`               → `NotListed`
- `listing.seller == msg.sender`     → `NotSeller`

**Effect:** `delete listings[tokenId]`. Emits `ListingCancelled`.

**Limitation:** if the seller transfers the NFT out, the current owner
cannot cancel — see [audit L-05](../audit.md).

### `buyCard(uint256 tokenId) payable nonReentrant`

The atomic swap. CEI-ordered:

```
1. CHECK  listing active (price != 0)        → NotListed
          msg.value == listing.price          → WrongPayment
2. EFFECT delete listings[tokenId]
3. COMPUTE platformFee, royaltyAmts[N], sellerProceeds
4. INTER  splitter.deposit{value: salePrice}([platform, rxs..., seller],
                                              [fee,      amts..., proceeds])
5. INTER  nft.safeTransferFrom(seller, buyer, tokenId)    ← last call
6. Emit Purchased
```

**Atomicity:** `safeTransferFrom` is the last external call. If it reverts
(buyer rejects in `onERC721Received`, seller revoked approval, seller no
longer owns the token), the EVM unwinds steps 2–4 — no ETH credited, no
listing change.

**Reentrancy:** the `nonReentrant` guard plus the early `delete` mean a
reentrant call from `onERC721Received` cannot re-buy the same token (listing
is gone) nor a different token (guard blocks).

### `getSuggestedPrice(uint256 tokenId) view → uint256`

Reads the floor price from the NFT's card template. Returns 0 for freeform-
minted tokens (no template).

### `getListingWithDetails(uint256 tokenId) view → (seller, price, name, rarity, hp, imageURI, cardId, suggestedPrice)`

Single-call bundle for the frontend. Calls `nft.getCard(tokenId)` (which
reverts if the token does not exist) and `nft.tokenCardId(tokenId)`. Will
revert on non-existent tokens; the frontend must guard.

### `setPlatformConfig(address treasury, uint256 feeBps)` — `onlyOwner`

Update fee and treasury. Reverts `InvalidFeeBps` if `feeBps >
MAX_PLATFORM_FEE_BPS`.

---

## 4. Events

| Event | Indexed | Notes |
|---|---|---|
| `Listed(tokenId, seller, price, rarity, cardId)` | `tokenId`, `seller` | Rarity + cardId pulled from NFT for frontend filtering |
| `ListingCancelled(tokenId, seller)` | `tokenId`, `seller` | |
| `Purchased(tokenId, buyer, seller, salePrice, platformFee, totalRoyalty, sellerProceeds)` | `tokenId`, `buyer`, `seller` | Frontend uses this to compute realised proceeds |
| `PlatformConfigSet(treasury, feeBps)` | — | Admin action |

---

## 5. Errors

| Error | Trigger |
|---|---|
| `NotListed(uint256 tokenId)` | `listings[tokenId].price == 0` |
| `AlreadyListed(uint256 tokenId)` | `listings[tokenId].price != 0` on `listCard` |
| `NotOwner(uint256 tokenId)` | `nft.ownerOf(tokenId) != msg.sender` on `listCard` |
| `NotApproved(uint256 tokenId)` | neither `getApproved` nor `isApprovedForAll` on `listCard` |
| `PriceZero()` | `price == 0` on `listCard` |
| `WrongPayment(uint256 sent, uint256 required)` | `msg.value != listing.price` on `buyCard` |
| `NotSeller(uint256 tokenId)` | non-seller calls `cancelListing` |
| `InvalidFeeBps(uint256 bps)` | constructor / `setPlatformConfig` with bps > 1 000 |

---

## 6. Invariants & threat model

| Invariant | Enforced by |
|---|---|
| `platformFee + Σ royaltyAmts + sellerProceeds == msg.value == listing.price` | Arithmetic by construction; splitter's `ValueMismatch` would revert any drift |
| `address(market).balance == 0` after every `buyCard` | Full `msg.value` forwarded to splitter |
| `listings[tokenId].price == 0` ⇒ no pending obligation on `tokenId` from this contract | `delete` happens at the top of buy/cancel; never overwritten without re-listing |
| `platformFeeBps ≤ MAX_PLATFORM_FEE_BPS` | Constructor + setter checks |
| Seller cannot front-run their own listing to claim more than the agreed price | `salePrice` is sourced from `listing.price`, not `msg.value` |

**Trusts:**
- `owner` for the `platformFeeBps` and treasury config.
- `PaymentSplitter.DEPOSITOR_ROLE` is held by this contract.
- The NFT contract correctly enforces approval — otherwise `safeTransferFrom`
  would fail and the buy would atomically revert.

**Does not trust:** seller (re-checks ownership at list time but not buy
time, see M-03), buyer (uses `safeTransferFrom`; `onERC721Received` is the
last external call and reentrancy is gated).

---

## 7. Gas profile (Foundry)

| Operation                  | Gas (cold) | Gas (warm) | Notes |
|----------------------------|-----------:|-----------:|-------|
| `listCard` + `approve`     | ~115 k     | ~83 k      | Two SSTOREs (Listing) + ERC-721 approve |
| `cancelListing`            | ~30 k      | ~30 k      | Single SSTORE delete |
| `buyCard` (2 royalty rxs)  | ~165 k     | ~120 k     | Includes splitter deposit + `safeTransferFrom` |

The `splitter.deposit` call inside `buyCard` writes one balance entry per
receiver. With one platform receiver + N royalty receivers + one seller, the
write loop is `N + 2` (≤ 6 in practice).

---

## 8. Known limitations

- **M-03**: stale-listing DoS — see audit for ownership/approval-change
  scenarios and remediations.
- **L-04**: no listing expiration.
- **L-05**: `cancelListing` requires the original seller's signature.
- **L-02**: constructor does not zero-check addresses.

See [`docs/audit.md`](../audit.md) for full discussion.
