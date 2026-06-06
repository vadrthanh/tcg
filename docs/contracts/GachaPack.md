# `GachaPack.sol`

Pay-to-open contract using a **two-step commit-reveal**: `commitPack()` accepts
`packPrice` ETH and records the commit block; `revealPack()`, a block later,
mints exactly `CARDS_PER_PACK = 5` cards drawn from the live pool by weighted
RNG seeded from `blockhash(commitBlock)`. Pack revenue is routed through the
`PaymentSplitter` to the platform treasury and the issuer at commit time.

The split exists so the draw outcome is unknowable when the buyer pays —
defeating the same-tx "simulate then revert unless favourable" attack
(see [audit M-04](../audit.md)).

- **Inherits:** `Ownable`, `ReentrancyGuard` (OpenZeppelin v5)
- **Solidity:** `0.8.24`

---

## 1. Purpose & scope

- Two entry points for end-users: `commitPack()` (pay) then `revealPack()`
  (draw + mint), in separate blocks.
- `revealPack` picks 5 cards: roll a rarity tier, then draw a specific card from
  the live inventory at that tier (with falldown to lower tiers if the rolled
  tier is sold out).
- Forwards the entire `msg.value` to the splitter at commit, split between
  `platformTreasury` and `issuer` according to `platformFeeBps`.

**Not responsible for:** ETH custody (never held — forwarded at commit), card
metadata, listing, or royalty distribution on resale.

---

## 2. State

### 2.1 Constants

| Slot | Value | Notes |
|------|-------|-------|
| `CARDS_PER_PACK`   | `5`  | Fixed pack size, drives the loop bound |
| `REVEAL_WINDOW`    | `256`| Max blocks between commit and reveal (EVM blockhash horizon) |
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
| `commitBlockOf`   | `mapping(address => uint256)` | Block of each buyer's unrevealed commit (0 = none); public |

---

## 3. External / public API

### `commitPack() payable nonReentrant`

Step 1 — pay and lock in a commit block. No cards drawn here.

```
1. Check: msg.value == packPrice                          → WrongPayment
2. Check: no in-window unrevealed commit for msg.sender   → PendingCommitExists
3. commitBlockOf[msg.sender] = block.number
4. _routeRevenue()                                        // splitter.deposit{value:} now
5. Emit PackCommitted(buyer, block.number)
```

Revenue is routed up front so that declining an unfavourable outcome by simply
never revealing only forfeits the cards — the price is already collected.

### `revealPack() nonReentrant`

Step 2 — draw and mint, in a later block than the commit.

```
1. commitBlock = commitBlockOf[msg.sender]
2. Check: commitBlock != 0                        → NoPendingCommit
3. Check: block.number  >  commitBlock            → RevealTooEarly
4. Check: block.number <= commitBlock + 256       → CommitExpired
5. seed = keccak256(blockhash(commitBlock), msg.sender)   // non-zero in window
6. delete commitBlockOf[msg.sender]               // CEI — clear before minting
7. For i in 0..4:
     rand   = keccak256(seed, i)
     rolled = _rollRarity(rand)
     (cardId, actual) = _drawFromInventory(rolled, rand >> 8)
     tokenId = nft.mintCard(msg.sender, cardId)   // external — triggers onERC721Received
8. Emit PackOpened(buyer, tokenIds, cardIds, rarities)
```

Security: because the seed comes from `blockhash(commitBlock)`, which did not
exist when the buyer paid in the prior block, the outcome cannot be simulated
at payment time. `RevealTooEarly` forbids revealing in the commit block, so a
wrapper contract cannot pay and inspect the draw in a single transaction.

Reentrancy: `nonReentrant` plus the `delete` at step 6 (before any `mintCard`)
mean the buyer's `onERC721Received` callback sees no pending commit and cannot
re-enter to double-reveal.

Gas: ~1.17 M for `revealPack` (5 mints); `commitPack` is one SSTORE + a deposit.

### `setPackPrice(uint256 newPrice)` — `onlyOwner`

Update pack price. No bounds check (free to be zero or arbitrarily large).
Emits `PackPriceSet`.

### `setRevenueConfig(address treasury, address issuer, uint256 feeBps)` — `onlyOwner`

Update split routing. Reverts `InvalidFeeBps` if `feeBps > 10_000`.
**Inconsistency with Marketplace:** the Marketplace caps platform fee at 1 000
bps; this one allows up to 10 000. See [audit I-03](../audit.md).

---

## 4. Internal helpers worth understanding

### Seed derivation (in `revealPack`)

```solidity
uint256 seed = uint256(keccak256(abi.encode(blockhash(commitBlock), msg.sender)));
// per card i: rand = uint256(keccak256(abi.encode(seed, i)))
```

`blockhash(commitBlock)` is the entropy; the window checks in `revealPack`
guarantee it is a non-zero, settled hash. The seed is isolated to this one
expression — the single point of swap for a Chainlink VRF integration that
would also close the residual validator-bias vector. **See
[audit M-04](../audit.md).**

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
| `PackCommitted(buyer, commitBlock)` | `buyer` | Emitted by `commitPack`; tells the buyer which block to reveal against |
| `PackOpened(buyer, tokenIds[5], cardIds[5], rarities[5])` | `buyer` | Emitted by `revealPack`; frontend/indexer read this to record the mint and drive the card-reveal animation |
| `PackPriceSet(newPrice)` | — | Admin action |
| `RevenueConfigSet(treasury, issuer, feeBps)` | — | Admin action |

---

## 6. Errors

| Error | Trigger |
|---|---|
| `WrongPayment(uint256 sent, uint256 required)` | `commitPack` with `msg.value != packPrice` |
| `InvalidFeeBps(uint256 bps)` | `setRevenueConfig` / constructor with bps > 10_000 |
| `AllCardsSoldOut()` | `revealPack`: every rarity tier in the NFT pool is empty |
| `PendingCommitExists()` | `commitPack` while an unrevealed, unexpired commit exists |
| `NoPendingCommit()` | `revealPack` with no commit recorded for the caller |
| `RevealTooEarly()` | `revealPack` in the same block as the commit |
| `CommitExpired()` | `revealPack` more than `REVEAL_WINDOW` blocks after the commit |

---

## 7. Invariants & threat model

| Invariant | Enforced by |
|---|---|
| `address(gacha).balance == 0` after every `commitPack` | `splitter.deposit{value: msg.value}` forwards the full balance at commit; the contract never custodies ETH |
| Sum credited to splitter == `msg.value` == `packPrice` | `_routeRevenue` arithmetic + splitter's own value-mismatch revert |
| At most one unrevealed in-window commit per address | `PendingCommitExists` guard in `commitPack` |
| Pack outcome unknowable at payment time | seed = `blockhash(commitBlock)`, unset until the block after commit; `RevealTooEarly` blocks same-block reveal |
| Every minted token belongs to a real pool template (post-H-01) | Goes through `nft.mintCard(to, cardId)`, which checks `maxSupply > 0` |
| `currentSupply` of every cardId increases monotonically | `mintCard` is the only writer |

**Trusts:**
- `owner` not to set hostile `platformFeeBps` or redirect treasury.
- The proposer of the reveal block not to bias/withhold `blockhash(commitBlock)`
  (residual validator-only vector; see audit M-04).
- `PokemonCardNFT.MINTER_ROLE` is held only by this contract (deploy-script
  responsibility).

**Does not trust:** the buyer's `onERC721Received` callback — `nonReentrant`
plus deleting the commit before minting block any reentrant double-reveal, and
no other state is exposed. Nor does it trust a contract caller to refrain from
the simulate-and-revert attack — commit-reveal makes it impossible rather than
relying on an EOA check.

---

## 8. Gas profile

| Operation                   | Gas      | Notes |
|-----------------------------|----------|-------|
| `commitPack()`              | ~80 k    | One SSTORE + splitter deposit |
| `revealPack()` (5 mints)    | ~1.17 M  | Dominated by 5 × `mintCard` |
| Per-card overhead           | ~234 k   | Includes `getAvailableCardIds` + mint |
| `setPackPrice`              | ~30 k    | Single SSTORE |
| `setRevenueConfig`          | ~50 k    | Three SSTOREs |

---

## 9. Known limitations

- **M-04** (fixed): the same-tx randomness that let any caller cherry-pick the
  draw is replaced by commit-reveal. A residual validator-bias vector on
  `blockhash(commitBlock)` remains; the VRF upgrade path closes it.
- **Reveal forfeit**: a commit not revealed within `REVEAL_WINDOW` (256 blocks)
  expires; the price was collected at commit, so the cards are forfeited. The
  frontend reveals immediately, so this only bites abandoned sessions.
- **I-02**: `_drawFromInventory` calls a view 1–5 times per pack, each of
  which scans the rarity array twice. Acceptable at n ≤ 40 cards/tier.
- **I-03**: `platformFeeBps` cap is 10 000, not 1 000 like the Marketplace.
- **I-05**: `_routeRevenue` reads `msg.value` rather than receiving it as a
  parameter — couples to caller context.
- **L-02**: Constructor does not zero-check `_nft`, `_splitter`,
  `_platformTreasury`, `_issuer`.

See [`docs/audit.md`](../audit.md) for full discussion.
