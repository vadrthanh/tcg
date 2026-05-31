# Security Audit Report — Pokémon TCG Gacha NFT Marketplace

> Self-audit for capstone IT4527E. Performed manually + Slither 0.11.5.
> All findings are triaged below.

---

## 1. Reentrancy Analysis

Every function that moves ETH or triggers external callbacks is audited below.

### PaymentSplitter.claim()

```
CEI order:
  Check  → if (amount == 0) revert NothingToClaim
  Effect → balances[msg.sender] = 0        ← zeroed BEFORE external call
  Inter  → msg.sender.call{value: amount}  ← external call last
Guard: nonReentrant (ReentrancyGuard)
```

**Assessment:** Safe. Two-layer protection: CEI + `nonReentrant`. A reentrant `claim()` call hits the lock before reaching the balance check. Even without the lock, the zeroed balance would make the second call revert with `NothingToClaim`.

**Attack test result:** `ReentrancyAttacker` attempted 5 nested `claim()` calls in `receive()`. Received exactly its allocated balance; victim untouched. (Phase 2 Foundry test.)

---

### Marketplace.buyCard()

```
CEI order:
  Check  → listing active, msg.value == price
  Effect → delete listings[tokenId]          ← deleted BEFORE any external call
  Inter  → splitter.deposit{value:}()        ← writes to PaymentSplitter mapping (no ETH pushed)
  Inter  → nft.safeTransferFrom(...)         ← triggers onERC721Received on buyer contract
Guard: nonReentrant
```

**Assessment:** Safe. The listing is deleted before the first external call. Any reentrant `buyCard(tokenId)` call hits `NotListed` (the listing no longer exists). The `nonReentrant` guard blocks the same `buyCard` being reentered even if the token ID differs.

**Atomicity proof:** `nft.safeTransferFrom` is the *last* call. If it reverts, the EVM unwinds the `delete` and the `splitter.deposit`. No ETH or listing state changes persist.

**Attack test result:** `MarketplaceAttacker.onERC721Received()` tried to reenter `buyCard`. Guard blocked it; seller proceeds were correctly credited. (Phase 4 Hardhat test.)

---

### GachaPack.openPack()

```
CEI order:
  Check  → msg.value == packPrice
  Inter  → nft.mintCard(buyer, cardId) × 5  ← mints, triggers onERC721Received on buyer
  Inter  → splitter.deposit{value:}()
Guard: nonReentrant
```

**Assessment:** Safe. The `nonReentrant` guard prevents reentering `openPack` from within any callback. The pack price check and revenue routing are atomic within the transaction.

**Note:** Calling `nft.mintCard` inside a loop is flagged by Slither as `calls-loop`. This is a **design requirement** (5 cards per pack) and cannot be avoided. Gas is bounded by the fixed `CARDS_PER_PACK = 5` constant; it is not an unbounded loop.

---

### PokemonCardNFT._mintCardInternal()

**Before fix (Slither `reentrancy-benign`):**
```
tokenId = _nextTokenId++
_safeMint(to, tokenId)          ← external call (onERC721Received)
_cards[tokenId] = data          ← state write AFTER external call
_royaltyReceivers[tokenId]...   ← state write AFTER external call
```

**After fix (applied in this audit pass):**
```
tokenId = _nextTokenId++
_cards[tokenId] = data          ← state write BEFORE external call
tokenCardId[tokenId] = cardId   ← state write BEFORE external call
_royaltyReceivers[tokenId]...   ← state write BEFORE external call
_safeMint(to, tokenId)          ← external call last
```

**Assessment:** Fixed. Slither rated the original as "benign" because no ETH is at risk, but the corrected CEI order is the canonical pattern and ensures any `onERC721Received` callback sees a fully initialised token state.

---

## 2. Access Control

| Function | Gate | Threat if missing |
|---|---|---|
| `PokemonCardNFT.mintCard(address, uint16)` | `MINTER_ROLE` | Arbitrary minting, supply inflation |
| `PokemonCardNFT.mintCard(address, Card, Rx[])` | `MINTER_ROLE` | Arbitrary minting, bypasses pool |
| `PokemonCardNFT.addCardToPool` | `onlyOwner` | Fake cards injected into pool |
| `PokemonCardNFT.batchAddCards` | `onlyOwner` | Same as above |
| `GachaPack.setPackPrice` | `onlyOwner` | Rug via price manipulation |
| `GachaPack.setRevenueConfig` | `onlyOwner` | Redirect pack revenue |
| `Marketplace.setPlatformConfig` | `onlyOwner` | Redirect platform fees |
| `PaymentSplitter.deposit` | `DEPOSITOR_ROLE` | Drain contract with phantom deposits |

**Deployment wiring:**
- `MINTER_ROLE` granted only to GachaPack (set in deploy script after deploy)
- `DEPOSITOR_ROLE` granted only to GachaPack and Marketplace
- Admin (`DEFAULT_ADMIN_ROLE`) is the deployer EOA; should be transferred to a multisig in production

---

## 3. Integer / Overflow

Solidity 0.8.24 performs checked arithmetic by default. Overflows revert automatically.

**`unchecked` blocks used — 1 instance:**

```solidity
// PokemonCardNFT._validateAndStoreCard()
unchecked {
    // Note: this unchecked block was REMOVED during this audit.
    // The original loop summing feeBps was wrapped in unchecked.
    // Replaced with normal checked addition.
}
```

Post-audit there are **zero `unchecked` blocks** in production contracts. All arithmetic is fully checked.

**Overflow risk analysis:**
- `feeBps` is `uint96` (max ~79e24). Sum of ≤ 4 receivers can't overflow `uint96` at realistic values; the `MAX_ROYALTY_BPS = 1000` check triggers before any wrap could occur.
- `salePrice * feeBps / 10_000` — Foundry fuzz tests cover full `uint96` range for salePrice with no overflow found.

---

## 4. Out-of-Gas / Unbounded Loops

**PaymentSplitter.deposit() — O(n) write loop, no ETH pushed:**
```
for i in receivers: balances[receivers[i]] += amounts[i]   ← storage write, no ETH push
```
This is intentionally O(n) in the number of receivers. For the Marketplace, n = 1 (platform) + royalty count (≤ 4) + 1 (seller) = at most 6. For GachaPack, n = 2. Both are bounded. There are no loops that push ETH — the pull-payment pattern is the out-of-gas defence.

**GachaPack.openPack() — bounded 5-iteration loop:**
CARDS_PER_PACK is an `immutable` constant (5). The loop is not user-controllable.

**getAvailableCardIds() — O(pool_size) view:**
View functions (off-chain reads) are not gas-limited for callers. The pool is capped at 40 cards; the loop is bounded by 40 iterations.

**Verdict:** No unbounded ETH-sending loops exist anywhere in the system.

---

## 5. Slither 0.11.5 — Full Finding Triage

| Detector | Severity | Finding | Verdict |
|---|---|---|---|
| `reentrancy-benign` | Medium | `_mintCardInternal`: state writes after `_safeMint` | **FIXED** — CEI reordered |
| `reentrancy-events` | Info | Events emitted after `_safeMint` | **Accepted** — events after external call is standard ERC-721 pattern; no value at risk |
| `calls-loop` | Medium | `nft.mintCard` and `nft.getAvailableCardIds` called inside `openPack` loop | **False positive** — loop is bounded at 5 (CARDS_PER_PACK constant); design requirement |
| `uninitialized-local` | Medium | 10 local variables default-zero | **False positive** — Solidity zero-initialises all local variables; these are correctly 0 |
| `locked-ether` | Medium | `ReentrancyAttacker` can receive ETH but has no withdraw | **Test-only** — not deployed to production |
| `missing-zero-check` | Low | Treasury/issuer addresses not zero-checked | **Accepted** — admin responsibility; adding zero-checks adds gas for a capstone demo |
| `missing-inheritance` | Info | Marketplace/PaymentSplitter don't inherit from test-only interfaces | **False positive** — `IMarketplace` and `ISplitter` are test stubs, not standards |
| `low-level-calls` | Info | `msg.sender.call{value:}` in `PaymentSplitter.claim` | **Accepted** — return value is checked (`if (!ok) revert TransferFailed()`); low-level call is required for ETH transfer with CEI |
| `pragma` | Info | Multiple OZ pragma versions | **False positive** — OZ library uses range pragmas by design |
| `costly-loop` | Info | `keccak256` in loop, `delete` in loop | **Accepted** — keccak loop is unavoidable for per-card randomness; delete in `batchAddCards` is a one-time deploy operation |
| `naming-convention` | Info | Underscore-prefixed params, `cardIdsByRarity_*` names | **Accepted** — underscore params are a common Solidity convention; rarity arrays use underscore for readability |
| `unindexed-event-address` | Info | `RevenueConfigSet`, `PlatformConfigSet` address params not indexed | **Accepted** — minor; these events are admin-only and not filtered by frontend |

**Post-audit status:** 0 high, 0 unresolved medium, 0 unresolved low.

---

## 6. Additional Manual Checks

| Check | Result |
|---|---|
| No `selfdestruct` or `delegatecall` | ✓ None present |
| No `tx.origin` auth | ✓ All auth uses `msg.sender` |
| No hardcoded addresses | ✓ All set via constructor |
| No `block.timestamp` for security | ✓ Only `block.prevrandao` for randomness (documented limitation) |
| Royalty cap enforced | ✓ `MAX_ROYALTY_BPS = 1000`; checked on every `mintCard` and `addCardToPool` |
| Pack price enforced | ✓ `if (msg.value != packPrice) revert WrongPayment` |
| Exact value match in `PaymentSplitter.deposit` | ✓ `if (total != msg.value) revert ValueMismatch` — no wei can be orphaned in the contract |
