# `GachaPack.sol`

Pay-to-open contract: accept `packPrice` ETH, mint exactly
`CARDS_PER_PACK = 5` cards drawn from the live pool by weighted RNG, and route
the ETH through the `PaymentSplitter` to the platform treasury and the issuer.

- **Inherits:** `Ownable`, `ReentrancyGuard` (OpenZeppelin v5)
- **Solidity:** `0.8.24`
- **Lines:** 198

---

## 1. Purpose & scope

- Single entry point for end-users: `openPack()`.
- Picks 5 cards per call: roll a rarity tier, then draw a specific card from
  the live inventory at that tier (with falldown to lower tiers if the rolled
  tier is sold out).
- Forwards the entire `msg.value` to the splitter, split between
  `platformTreasury` and `issuer` according to `platformFeeBps`.

**Not responsible for:** ETH custody (transient — same-tx forwarding), card
metadata, listing, or royalty distribution on resale.

---

## 2. State

### 2.1 Constants

| Slot | Value | Notes |
|------|-------|-------|
| `CARDS_PER_PACK`   | `5`  | Fixed pack size, drives the loop bound |
| `W_COMMON`         | `60` | Cumulative weight breakpoint |
| `W_UNCOMMON`       | `85` | "" |
| `W_RARE`           | `95` | "" |
| `W_ULTRA_RARE`     | `99` | "" — Legendary is implicit `[99, 100)` |

### 2.2 Immutables

| Slot       | Type                | Notes |
|------------|---------------------|-------|
| `nft`      | `PokemonCardNFT`    | Set in constructor; cannot be changed |
| `splitter` | `PaymentSplitter`   | "" |

### 2.3 Mutable state

| Slot              | Type      | Notes |
|-------------------|-----------|-------|
| `packPrice`       | `uint256` | Default `0.01 ether`; changeable by owner |
| `platformTreasury`| `address` | Owner-configurable |
| `issuer`          | `address` | Owner-configurable |
| `platformFeeBps`  | `uint256` | Platform share of pack revenue; cap is `10_000` — **see audit I-03** |
| `_nonce`          | `uint256` | Monotonic counter feeding the RNG; private |

---

## 3. External / public API

### `openPack() payable nonReentrant`

The single user-facing entry point.

```
1. Check: msg.value == packPrice                 → WrongPayment
2. For i in 0..4:
     rand   = _random(i)                          // increments _nonce
     rolled = _rollRarity(rand)
     (cardId, actual) = _drawFromInventory(rolled, rand >> 8)
     tokenId = nft.mintCard(msg.sender, cardId)   // external — triggers onERC721Received
3. _routeRevenue()                                // splitter.deposit{value:}
4. Emit PackOpened(buyer, tokenIds, cardIds, rarities)
```

Reentrancy: `nonReentrant` is required because `mintCard` triggers an
`onERC721Received` callback on the buyer when the buyer is a contract. The
only mutable state in this contract that could be touched by a reentrant call
is `_nonce`, which is monotonic — an attacker can advance it further but
cannot gain anything from doing so.

Gas: ~1.17 M for a full pack open (5 mints + 1 deposit). Bounded.

### `setPackPrice(uint256 newPrice)` — `onlyOwner`

Update pack price. No bounds check (free to be zero or arbitrarily large).
Emits `PackPriceSet`.

### `setRevenueConfig(address treasury, address issuer, uint256 feeBps)` — `onlyOwner`

Update split routing. Reverts `InvalidFeeBps` if `feeBps > 10_000`.
**Inconsistency with Marketplace:** the Marketplace caps platform fee at 1 000
bps; this one allows up to 10 000. See [audit I-03](../audit.md).

---

## 4. Internal helpers worth understanding

### `_random(uint256 salt) → uint256`

```solidity
uint256(keccak256(abi.encode(block.prevrandao, msg.sender, _nonce++, salt)))
```

Cheap pseudo-RNG. The `_nonce++` ensures uniqueness across multiple calls
within a single block from the same sender. **See [audit M-04](../audit.md)
for the validator-bias attack** — the function body is isolated and is the
single point of swap for a Chainlink VRF integration.

### `_rollRarity(uint256 rand) → Rarity`

```
roll = rand % 100
roll < 60 → Common
roll < 85 → Uncommon
roll < 95 → Rare
roll < 99 → UltraRare
else      → Legendary
```

O(1), pure.

### `_drawFromInventory(Rarity rarity, uint256 pickSeed) → (cardId, actual)`

Tries the rolled rarity; if `getAvailableCardIds(rarity)` is empty, falls down
to the next lower tier. Reverts `AllCardsSoldOut` if every tier is empty.

```solidity
for (int256 r = int256(uint256(rarity)); r >= 0; r--) {
    uint16[] memory avail = nft.getAvailableCardIds(Rarity(uint256(r)));
    if (avail.length > 0) return (avail[pickSeed % avail.length], Rarity(uint256(r)));
}
revert AllCardsSoldOut();
```

The falldown is one-way (only ever goes *down*), so rare cards become
*harder* to obtain as supply depletes — a Legendary buyer who finds none gets
an Ultra Rare, never an upgrade. **Gas note:** each loop iteration is a
storage-heavy view call (see [audit I-02](../audit.md)).

### `_routeRevenue()`

```
platformAmt = msg.value * platformFeeBps / 10_000
issuerAmt   = msg.value - platformAmt           // dust → issuer
splitter.deposit{value: msg.value}([treasury, issuer], [platformAmt, issuerAmt])
```

Dust handling: integer-division remainder of `platformAmt` is implicitly given
to the issuer via subtraction. Sum always equals `msg.value` exactly — the
splitter's `ValueMismatch` check will never trigger from this caller.

---

## 5. Events

| Event | Indexed | Notes |
|---|---|---|
| `PackOpened(buyer, tokenIds[5], cardIds[5], rarities[5])` | `buyer` | Frontend reads this to drive the card-reveal animation |
| `PackPriceSet(newPrice)` | — | Admin action |
| `RevenueConfigSet(treasury, issuer, feeBps)` | — | Admin action |

---

## 6. Errors

| Error | Trigger |
|---|---|
| `WrongPayment(uint256 sent, uint256 required)` | `msg.value != packPrice` |
| `InvalidFeeBps(uint256 bps)` | `setRevenueConfig` / constructor with bps > 10_000 |
| `AllCardsSoldOut()` | Every rarity tier in the NFT pool is empty |

---

## 7. Invariants & threat model

| Invariant | Enforced by |
|---|---|
| `address(gacha).balance == 0` after every successful `openPack` | `splitter.deposit{value: msg.value}` forwards the full balance |
| Sum credited to splitter == `msg.value` == `packPrice` | `_routeRevenue` arithmetic + splitter's own value-mismatch revert |
| Every minted token belongs to a real pool template (post-H-01) | Goes through `nft.mintCard(to, cardId)`, which checks `maxSupply > 0` |
| `currentSupply` of every cardId increases monotonically | `mintCard` is the only writer |

**Trusts:**
- `owner` not to set hostile `platformFeeBps` or redirect treasury.
- Block proposer not to bias `block.prevrandao` beyond the documented
  tolerance (see audit M-04).
- `PokemonCardNFT.MINTER_ROLE` is held only by this contract (deploy-script
  responsibility).

**Does not trust:** the buyer's `onERC721Received` callback — `nonReentrant`
blocks reentrant `openPack`, and no other state is exposed.

---

## 8. Gas profile

| Operation                   | Gas      | Notes |
|-----------------------------|----------|-------|
| `openPack()` (5 mints)      | ~1.17 M  | Dominated by 5 × `mintCard` |
| Per-card overhead           | ~234 k   | Includes `getAvailableCardIds` + mint |
| `setPackPrice`              | ~30 k    | Single SSTORE |
| `setRevenueConfig`          | ~50 k    | Three SSTOREs |

---

## 9. Known limitations

- **M-04**: `block.prevrandao` is validator-biaseable. VRF upgrade path is
  documented at the `_random` definition.
- **I-02**: `_drawFromInventory` calls a view 1–5 times per pack, each of
  which scans the rarity array twice. Acceptable at n ≤ 40 cards/tier.
- **I-03**: `platformFeeBps` cap is 10 000, not 1 000 like the Marketplace.
- **I-05**: `_routeRevenue` reads `msg.value` rather than receiving it as a
  parameter — couples to caller context.
- **L-02**: Constructor does not zero-check `_nft`, `_splitter`,
  `_platformTreasury`, `_issuer`.

See [`docs/audit.md`](../audit.md) for full discussion.
