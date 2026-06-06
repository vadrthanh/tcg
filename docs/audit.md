# Security Audit — Pokémon TCG Gacha NFT Marketplace

| Field             | Value                                                              |
|-------------------|--------------------------------------------------------------------|
| Audited system    | `contracts/src/` — 4 production Solidity contracts (`solc 0.8.24`) |
| Commit / state    | working tree at `2026-06-01` (post-H-01 remediation)               |
| Methodology       | Manual review · Slither 0.11.5 · Hardhat (119) + Foundry (17, fuzz 1 000 runs / invariant 256 × 15) |
| Severity scheme   | Critical / High / Medium / Low / Informational                     |
| Auditor posture   | Self-audit for capstone IT4527E. Treat findings as a learning artefact, not a production sign-off. |

---

## 1. Executive Summary

The system implements a four-contract marketplace where users pay ETH to open
"gacha packs" of ERC-721 Pokémon cards (`PokemonCardNFT`), then trade them on a
secondary market (`Marketplace`) with EIP-2981-style multi-receiver royalties
distributed through a pull-payment vault (`PaymentSplitter`). Pack revenue is
also routed through the splitter (`GachaPack`).

Overall the codebase is well-structured for its scope: CEI is observed in every
function that moves ETH, all ETH distribution is pull-based (no push loops),
custom errors are used throughout, and the test suite exercises both the happy
path and most negative-path cases. Two of the four contracts are essentially
"boring" (PaymentSplitter, Marketplace) — a good thing in security.

### Findings at a glance

| # | Severity | Title | Status |
|---|----------|-------|--------|
| **H-01** | High | `addCardToPool` / `batchAddCards` silently re-write existing cards → supply inflation + rarity-array duplication | **Fixed in this pass** |
| **M-01** | Medium | EIP-2981 `royaltyInfo` returns total bps against a single receiver — external marketplaces will pay 100% to `rxs[0]` | Acknowledged |
| **M-02** | Medium | `cardId == 0` sentinel collision between freeform mints and pool mints | **Fixed in this pass** (folded into H-01 fix) |
| **M-03** | Medium | Stale-listing DoS — seller can transfer or revoke approval, leaving listing un-buyable and locking the new owner out of re-listing | Acknowledged |
| **M-04** | Medium | `block.prevrandao` is validator-biaseable; a validator can skip a slot to re-roll | Acknowledged (VRF upgrade documented) |
| L-01 | Low | `PaymentSplitter.deposit` does not reject `address(0)` receivers → ETH can be permanently locked | Open |
| L-02 | Low | Missing zero-address checks in constructors (NFT admin, splitter admin, treasury, issuer, NFT addr, splitter addr) | Open |
| L-03 | Low | `tokenURI` returns raw image URL, not an ERC-721-Metadata JSON URI | Open |
| L-04 | Low | Listings have no expiration | Open |
| L-05 | Low | `cancelListing` only callable by `listing.seller`; current owner cannot evict a stale listing | Open |
| L-06 | Low | `PaymentSplitter` has no admin sweep for ETH delivered via SELFDESTRUCT / coinbase | Open |
| L-07 | Low | Deploy script wrote `contracts/deploy/addresses.json` but never updated the `VITE_*` vars the frontend actually reads, so the UI stayed on zero addresses after deploy | Fixed |
| I-01 | Info | Two parallel auth systems on `PokemonCardNFT` (Ownable + AccessControl) | Open |
| I-02 | Info | `GachaPack._drawFromInventory` calls a view 1–5 times per pack that iterates the rarity array twice each call | Open |
| I-03 | Info | `GachaPack.setRevenueConfig` accepts up to 10 000 bps, while `Marketplace.setPlatformConfig` caps at 1 000 — inconsistent | Open |
| I-04 | Info | `royaltyInfo` divides by 10 000 even when `totalBps == 0` (returns 0 cleanly); leftover from defensive coding | Open |
| I-05 | Info | `_routeRevenue` reads `msg.value` rather than the validated copy — harmless but couples to caller context | Open |
| I-06 | Info | `feeBps` typed `uint96` (overkill; fits `uint16`) — kept for storage packing with `address` | Open |

Net post-audit posture: **0 Critical, 0 High** (after H-01 fix), 3 unresolved
Medium (acknowledged with documented mitigations), 7 Low, 6 Informational.

---

## 2. Scope

**In scope (production contracts):**

```
contracts/src/PokemonCardNFT.sol     343 lines  ERC-721 + EIP-2981 + on-chain card pool
contracts/src/GachaPack.sol          198 lines  pack opener, weighted RNG, falldown draw
contracts/src/Marketplace.sol        215 lines  atomic NFT-for-ETH swap with royalty split
contracts/src/PaymentSplitter.sol    104 lines  pull-payment vault
```

**Out of scope:**

- `contracts/src/test/*.sol` — attacker contracts used only by tests
- OpenZeppelin Contracts v5 (`ERC721`, `ERC2981`, `AccessControl`, `Ownable`,
  `ReentrancyGuard`) — trusted dependency, version is pinned in package-lock
- Frontend code (`frontend/`) — non-custodial UI, no value at risk client-side
- Deploy script (`scripts/deploy.ts`) — reviewed for trust-bootstrap correctness,
  but Hardhat / TypeScript runtime is not in the threat model

**Methodology**

1. Manual line-by-line review of all four production contracts.
2. Slither 0.11.5 — every detector triaged in §9.
3. Hardhat suite: 119 passing tests (after this pass added 7).
4. Foundry: 5 suites, 17 tests including 1 000-run fuzz and 256 × 15 invariants
   (full output in §10).
5. Independent re-derivation of the value-conservation invariant
   (`platformFee + Σ royalties + sellerProceeds == salePrice`) — proof in §6.

---

## 3. System Model

### 3.1 Trust assumptions

| Actor                | Trust level | Powers                                                                                     |
|----------------------|-------------|--------------------------------------------------------------------------------------------|
| `DEFAULT_ADMIN_ROLE` (NFT) / `owner` (NFT) | **Fully trusted** | Adds cards to pool, grants/revokes `MINTER_ROLE`. With a malicious admin the entire pool is captured.       |
| `MINTER_ROLE` (NFT)                        | **Fully trusted** | Wired to `GachaPack` only. A second minter (e.g. compromised key) can mint arbitrary cards from the pool or freeform mints with arbitrary royalties. |
| `DEPOSITOR_ROLE` (splitter)                | **Fully trusted** | Wired to `GachaPack` + `Marketplace` only. A rogue depositor can credit phantom balances to any address. The honest pair both validate `msg.value == sum(amounts)` and so cannot inflate. |
| `owner` (GachaPack / Marketplace)          | **Fully trusted** | Sets fees, treasury, issuer.                                                                |
| Card pool entry (artist / platform addrs)  | Trusted to publish honest royalty splits when seeding. After mint, the `_royaltyReceivers[tokenId]` array is **immutable** — admin cannot retroactively change royalties on existing tokens. |
| Pack buyer / card trader                   | Untrusted (adversary model). Assumed to deploy arbitrary contracts, attempt reentrancy, send malformed value, etc. |
| Block proposer (validator)                 | Partially trusted — assumed honest for liveness; can bias `block.prevrandao` (see M-04). |

### 3.2 Invariants the audit verified

1. **Value conservation on sale.** For any successful `Marketplace.buyCard`:
   `platformFee + Σ royaltyAmts + sellerProceeds == salePrice == msg.value`.
   Holds by construction; cross-checked with the 1 000-run Foundry fuzz
   (`testFuzz_valueConservation`).
2. **Splitter solvency.** At all times: `address(splitter).balance == Σ balances[*]`.
   Foundry invariant `invariant_balanceSumEqualsContractBalance` ran 256 × 15
   with 3 840 random handler calls, no violations.
3. **Supply cap.** For every card template: `currentSupply ≤ maxSupply`.
   Foundry fuzz `testFuzz_supplyNeverExceedsMax` ran 1 000 random pack-open
   sequences, no violations. The H-01 fix in this pass eliminates the one
   admin-side path that could have broken this invariant.
4. **No locked ETH in the trade path.** `GachaPack` and `Marketplace` retain
   zero ETH after every state-changing call (both forward `msg.value` to the
   splitter in the same transaction). Foundry tests assert
   `address(gacha).balance == 0` and `address(market).balance == 0`.
5. **Royalty cap.** Σ `feeBps` across receivers ≤ `MAX_ROYALTY_BPS` (1 000 = 10 %).
   Enforced on every mint path.

---

## 4. Findings

> Each finding lists: severity, location, description, attack scenario, impact,
> proof-of-concept (where useful), and remediation. Findings already remediated
> in this pass are marked **Fixed** and show the patch.

### H-01 — `addCardToPool` / `batchAddCards` silently overwrite cards (supply inflation + probability skew)

| Field        | Value |
|--------------|-------|
| Severity     | **High** |
| Likelihood   | Low (admin-only) |
| Impact       | High (collectible scarcity violated; gacha probabilities silently corrupted) |
| Status       | **Fixed** in this audit pass — see patch below |
| Location     | `PokemonCardNFT.sol` — `_validateAndStoreCard`, callable via `addCardToPool` and `batchAddCards` |

#### Description (pre-fix)

`_validateAndStoreCard` writes the incoming template into `cardPool[cardId]`
unconditionally — there was no check that `cardId` was unused. Two consequences:

1. **Supply-counter reset.** The line `stored.currentSupply = 0;` runs on every
   call. If `cardId = 7` already had `currentSupply = 800` (the configured
   `maxSupply`), an admin re-add resets the counter to 0, allowing another 800
   mints. There is **no on-chain receipt** that distinguishes a re-add from a
   first add — `CardAddedToPool` is emitted in both cases. The collectible's
   "1-of-N" scarcity is silently violated.
2. **Rarity-array duplication.** The end of the function pushes the cardId into
   the matching `cardIdsByRarity_*` array. Re-adding `cardId = 20` (Legendary)
   pushes a second entry; `getAvailableCardIds(Legendary)` then returns
   `[20, 20, …]`. `GachaPack._drawFromInventory` indexes uniformly into that
   array, so card 20 receives **twice** the probability weight inside its tier
   for every additional re-add. Other Legendary cards' draw probability falls
   correspondingly.

The function name `addCardToPool` reads as create-only, which is the natural
mental model for an admin operator. The actual upsert behaviour is invisible
without reading the implementation.

#### Attack scenario

```
1. Deploy + seed 40 cards.
2. Users open packs; the only Legendary (cardId = 20) sells out at maxSupply = 1.
3. Admin (compromised key or operator mistake) calls
     addCardToPool(template_for_cardId_20, [...])
   → currentSupply reset to 0
   → cardIdsByRarity_Legendary = [20, 20] (now length 2)
4. Subsequent pack opens mint another "Legendary #20", violating the published
   1-of-1 scarcity AND giving anyone else who pulls Legendary a 100% chance of
   getting #20 over any other Legendary that's added later.
```

The same effect is achievable via `batchAddCards` with any batch containing a
collision. No on-chain mechanism allows an honest party to undo or even detect
the inflation event from after-the-fact event logs.

#### Remediation (applied)

Added three guards to `_validateAndStoreCard`. The template now follows
write-once semantics:

```solidity
// Reject the sentinel cardId — 0 marks a freeform mint in tokenCardId.
if (template.cardId == 0) revert InvalidCardId();
// Reject zero-supply templates so cardPool[id].maxSupply is a reliable
// "is this slot occupied?" probe for the duplicate check below.
if (template.maxSupply == 0) revert InvalidMaxSupply();
// Write-once: prevent supply-counter reset and rarity-array duplication.
if (cardPool[template.cardId].maxSupply != 0) {
    revert CardAlreadyInPool(template.cardId);
}
```

Regression tests added in `test/hardhat/CardPool.test.ts`:

```
✔ reverts InvalidCardId when cardId == 0 (sentinel collision)
✔ reverts InvalidMaxSupply when maxSupply == 0
✔ reverts CardAlreadyInPool when re-adding an existing cardId
✔ re-add cannot reset currentSupply mid-sale (supply inflation guard)
✔ re-add does not duplicate cardId in rarity array (probability skew guard)
✔ reverts CardAlreadyInPool if any template in the batch duplicates an existing one
✔ reverts InvalidCardId if a batch template uses cardId == 0
```

This fix also closes **M-02** (cardId-0 sentinel collision) as a side effect.

If a future requirement genuinely needs to mutate a template (e.g. raising
`maxSupply` to release a second print run), a separate function — say
`raiseMaxSupply(uint16 cardId, uint16 newCap)` with `newCap > currentSupply` —
should be added with its own explicit event. Bundling that into `addCardToPool`
hides the operation from indexers.

---

### M-01 — EIP-2981 `royaltyInfo` reports sum of all bps against a single receiver

| Field        | Value |
|--------------|-------|
| Severity     | **Medium** |
| Likelihood   | High (any off-platform sale on an EIP-2981-compliant marketplace) |
| Impact       | Medium (artist receives 0 royalty on off-platform sales; platform receives all) |
| Status       | Acknowledged — not blocking for capstone scope (no off-platform marketplace will be wired up) |
| Location     | `PokemonCardNFT.sol:294-303` |

#### Description

`royaltyInfo(tokenId, salePrice)` is the standardised hook from EIP-2981.
Third-party marketplaces (OpenSea, Blur, LooksRare, etc.) call it and pay
`royaltyAmount` ETH to `receiver`. Per the standard, **a single address
receives the entire royalty**.

The current implementation aggregates the bps of all multi-receivers but only
returns the first receiver's address:

```solidity
receiver      = rxs.length > 0 ? rxs[0].receiver : address(0);
royaltyAmount = (salePrice * totalBps) / 10_000;
```

If a card is configured with `[Platform 300 bps, Artist 200 bps]`, an OpenSea
sale of 1 ETH will pay 0.05 ETH (5 %) entirely to the platform; the artist
receives nothing. The internal `Marketplace` contract sidesteps this by reading
the full `getRoyaltyReceivers` array directly — so in-app trades distribute
correctly — but the contract is *advertising* EIP-2981 support via
`supportsInterface(0x2a55205a) == true`, which tells external venues to trust
`royaltyInfo`.

#### Remediation options

1. **Document the limitation prominently** and accept it. The platform must
   trust itself to forward the artist's share off-band. (Cheapest; aligns with
   capstone-scope reality.)
2. **Drop EIP-2981 support** — remove `ERC2981` from the inheritance list and
   stop reporting `0x2a55205a` in `supportsInterface`. External marketplaces
   will then fall back to their own royalty negotiation (typically off-chain
   registries).
3. **Implement EIP-2981 + ERC-7572 (or a comparable multi-receiver extension)**
   so off-platform venues call back for the split. There is no widely-adopted
   standard for multi-receiver royalties on-chain; OpenSea's solution is the
   centralised Royalty Registry.
4. **Aggregate to a splitter contract.** Make `royaltyInfo` return
   `(address(splitter), totalAmount)` and have the splitter route to the
   per-token receivers on demand. This requires the splitter to know per-token
   receivers — a meaningful refactor.

Recommendation for this codebase: **option 2 or option 4**. Option 1 is
acceptable for the capstone but the limitation must be called out in the
report.

---

### M-02 — `cardId == 0` sentinel collision

| Field        | Value |
|--------------|-------|
| Severity     | **Medium** |
| Likelihood   | Low (admin would need to choose cardId 0 explicitly) |
| Impact       | Medium (pool-minted tokens silently behave as freeform; pricing helpers return 0; downstream tooling sees garbage) |
| Status       | **Fixed** (folded into H-01 fix) |
| Location     | `PokemonCardNFT.sol` — `_mintCardInternal` writes `tokenCardId` only when `poolCardId != 0` |

`_mintCardInternal` uses `poolCardId = 0` as the sentinel meaning "freeform
mint, no template". If an admin added a template with cardId 0, the mint would
record `tokenCardId[tokenId] = 0`, indistinguishable from a freeform mint.
Downstream impact:

- `Marketplace.getSuggestedPrice` returns 0 for that token.
- `Marketplace.getListingWithDetails` returns `cardId = 0, suggestedPrice = 0`.
- The `Listed` event carries `cardId = 0`, breaking any frontend index keyed
  by cardId.

The H-01 patch rejects `template.cardId == 0` at pool-entry time, closing this
case. No additional changes needed.

---

### M-03 — Stale-listing DoS

| Field        | Value |
|--------------|-------|
| Severity     | **Medium** |
| Likelihood   | Medium (any seller behaviour that moves the NFT after listing) |
| Impact       | Medium (purchases fail; new owner cannot re-list; no funds at risk) |
| Status       | Acknowledged |
| Location     | `Marketplace.sol` — `listCard` / `buyCard` / `cancelListing` |

#### Description

`listCard` records `{seller, price}` after verifying the caller owns the token
and has approved the marketplace. After listing, **neither ownership nor
approval is re-checked at buy time**. Two failure modes:

1. **Approval revoked.** Seller calls `nft.approve(address(0), tokenId)`.
   The listing stays active in storage. Any buyer who calls `buyCard` gets a
   transaction that runs through `Marketplace.delete`, runs through
   `splitter.deposit{value:}` (which mutates the splitter), then reverts on
   `nft.safeTransferFrom` (no approval). EVM unwind makes this atomic, so no
   ETH is lost — but the buyer wastes gas and the listing remains active for
   the next victim. Sellers can effectively grief buyers indefinitely until
   somebody calls `cancelListing`.

2. **Ownership transferred.** Seller transfers `tokenId` to Bob after listing.
   `buyCard` still reverts at `safeTransferFrom` (seller no longer owns it).
   Worse, Bob now owns an NFT he cannot list himself: the marketplace's
   `listCard` checks `if (listings[tokenId].price != 0) revert AlreadyListed`,
   and `cancelListing` checks `if (listing.seller != msg.sender) revert
   NotSeller`. Bob is locked out of listing until the original seller (Alice)
   cancels — a coordination problem that may never resolve.

The second case is the more serious one because it survives the seller's
inaction. A malicious seller can lock targeted NFTs against re-listing as part
of an off-chain trade dispute.

#### PoC sketch

```solidity
// Alice
nft.approve(marketplace, 5);
marketplace.listCard(5, 1 ether);
nft.transferFrom(alice, bob, 5);   // direct ERC-721 transfer

// Bob now owns 5 but cannot list:
marketplace.listCard(5, 2 ether);  // reverts AlreadyListed(5)

// Bob cannot cancel:
marketplace.cancelListing(5);      // reverts NotSeller(5)

// Bob is stuck until Alice voluntarily calls cancelListing.
```

#### Remediation

Add a stale-listing eviction path. Two clean options:

```solidity
// Option A: any party may cancel a listing whose seller is no longer the owner.
function cancelStaleListing(uint256 tokenId) external {
    Listing memory l = listings[tokenId];
    if (l.price == 0) revert NotListed(tokenId);
    if (nft.ownerOf(tokenId) == l.seller) revert NotStale(); // still valid
    delete listings[tokenId];
    emit ListingCancelled(tokenId, l.seller);
}

// Option B: current owner can always cancel.
function cancelListing(uint256 tokenId) external {
    Listing memory l = listings[tokenId];
    if (l.price == 0) revert NotListed(tokenId);
    if (l.seller != msg.sender && nft.ownerOf(tokenId) != msg.sender) {
        revert NotSeller(tokenId);
    }
    delete listings[tokenId];
    emit ListingCancelled(tokenId, l.seller);
}
```

Also worth adding a defensive ownership re-check inside `buyCard`:

```solidity
if (nft.ownerOf(tokenId) != listing.seller) {
    delete listings[tokenId];
    revert NotListed(tokenId);
}
```

so the buyer's transaction reverts *before* depositing to the splitter rather
than during the trailing `safeTransferFrom`, saving them some gas.

---

### M-04 — `block.prevrandao` is validator-biaseable

| Field        | Value |
|--------------|-------|
| Severity     | **Medium** (mainnet) / Low (testnet) |
| Likelihood   | Low (requires being block proposer and the marginal value to exceed slot-skip cost) |
| Impact       | Medium (biased rarity outcomes; in extremis a validator can re-roll for Legendaries) |
| Status       | Acknowledged — VRF upgrade path documented in code |
| Location     | `GachaPack.sol:139-143` |

`block.prevrandao` is the post-Merge replacement for `block.difficulty` and
exposes the previous block's RANDAO mix. A validator that knows it is about to
propose a slot can:

1. Simulate the `openPack` outcome before publication.
2. If unfavourable (e.g. did not produce a Legendary), **deliberately miss the
   slot**, surrendering ~0.04 ETH of consensus rewards.
3. The next proposer's `prevrandao` is now different — repeat.

This becomes economically rational once the **expected marginal value of a
re-roll** exceeds the slot-skip cost. With a Legendary at 1 % and a 1-of-1
maxSupply, the value of a single Legendary pull can easily exceed 0.04 ETH on
mainnet. Sepolia and the capstone demo are not exposed because slot rewards
have no market value there.

The contract already documents the upgrade path: `_random` is isolated, and
`_rollRarity` / `_drawFromInventory` are pure or view and accept any
`uint256` seed. Swapping in Chainlink VRF (`VRFConsumerBaseV2`) requires
changing only `_random` to enqueue a request and `openPack` to split into a
request phase and a fulfilment phase (commit-reveal).

**Recommendation:** ship VRF before any mainnet deployment, even with low TVL.
For Sepolia and academic submission, the current scheme is acceptable.

---

### L-01 — `PaymentSplitter.deposit` does not reject `address(0)` receivers

| Severity / Status | Low / Open |
|---|---|
| Location          | `PaymentSplitter.sol:48-66` |

The function loops over `receivers[]` and credits each balance, with no
per-address validation. If any caller passes `address(0)`, ETH is credited to
the zero address and is permanently unclaimable (the zero address has no
private key to call `claim`).

Both current callers (`GachaPack._routeRevenue`, `Marketplace.buyCard`) source
recipient addresses from configured state (`platformTreasury`, `issuer`,
royalty receivers, `listing.seller`), so the only way to inject `address(0)`
is via a misconfiguration. Still, defence-in-depth costs ~30 gas per receiver:

```solidity
for (uint256 i; i < receivers.length; ++i) {
    if (receivers[i] == address(0)) revert InvalidReceiver();
    balances[receivers[i]] += amounts[i];
}
```

A complementary check should be added in the constructors of `GachaPack` and
`Marketplace` so the platform/issuer/treasury addresses cannot be zero.

---

### L-02 — Missing zero-address checks in constructors

| Severity / Status | Low / Open |
|---|---|
| Location          | `PokemonCardNFT.sol:85-90`, `PaymentSplitter.sol:38-40`, `GachaPack.sol:72-86`, `Marketplace.sol:78-89` |

None of the constructors validate their address parameters. A deploy with
`admin = address(0)` results in a contract with no controllable admin — for
`PokemonCardNFT`, ownership is still settable via `Ownable.transferOwnership`,
but for `PaymentSplitter` the admin role is non-recoverable (no other role
holder, no Ownable on the splitter).

Add `if (X == address(0)) revert InvalidAddress();` to every constructor that
takes an address. The audit team usually accepts admin-side responsibility for
this — but the cost is trivial and the failure mode is permanent.

---

### L-03 — `tokenURI` returns raw image URL

| Severity / Status | Low / Open |
|---|---|
| Location          | `PokemonCardNFT.sol:319-322` |

ERC-721 Metadata expects `tokenURI(tokenId)` to return a URI resolving to a
JSON document `{name, description, image, attributes}`. The current
implementation returns the raw image URL directly. Off-platform tools that
expect the JSON shape (OpenSea, Etherscan token view, wallet collectibles
tabs) will render the token as "Unknown asset" with the URL as the image.

For an on-chain-only metadata model (the README's stated direction), the
cleanest solution is data-URI inline JSON:

```solidity
function tokenURI(uint256 tokenId) public view override returns (string memory) {
    _requireOwned(tokenId);
    Card memory c = _cards[tokenId];
    return string.concat(
        "data:application/json;base64,",
        Base64.encode(bytes(string.concat(
            '{"name":"', c.name, '","image":"', c.imageURI,
            '","attributes":[{"trait_type":"Rarity","value":"', _rarityName(c.rarity),
            '"},{"trait_type":"Type","value":"', c.pokemonType,
            '"},{"trait_type":"HP","value":', Strings.toString(c.hp), "}]}"
        )))
    );
}
```

OpenZeppelin ships `Base64` and `Strings` utilities. Bytecode cost: ~2 KB.

---

### L-04 — Listings have no expiration

| Severity / Status | Low / Open |
|---|---|
| Location          | `Marketplace.sol:95-109` |

A listing remains active indefinitely until cancelled or filled. If ETH price
moves materially after listing, the seller may be selling at significantly
under-market value. Standard NFT marketplaces include an `expiresAt` field
(usually 1–30 days). Mitigation is one storage slot and a check in `buyCard`:

```solidity
struct Listing { address seller; uint96 price; uint64 expiresAt; }
// buyCard: if (block.timestamp > listing.expiresAt) revert ListingExpired();
```

Not a security issue per se — sellers can always call `cancelListing` — but
it is a real UX foot-gun. Accept for capstone; revisit for any production
deployment.

---

### L-05 — `cancelListing` callable only by the seller

| Severity / Status | Low / Open |
|---|---|
| Location          | `Marketplace.sol:112-118` |

See M-03 for the consequence. Once approval/ownership state diverges from the
listing, only the listing-seller can clean it up. Allowing the current
`ownerOf(tokenId)` (or any caller, if the listing is provably stale) to cancel
costs nothing and resolves the lock-out.

---

### L-06 — No admin sweep for forced ETH in PaymentSplitter

| Severity / Status | Low / Open |
|---|---|
| Location          | `PaymentSplitter.sol` (no such function) |

`deposit()` is the only payable entry, but ETH can still arrive without
incrementing any balance via `SELFDESTRUCT` from another contract or via the
coinbase reward (if the splitter were ever used as a fee recipient). The
result: `address(splitter).balance > Σ balances[*]` — small wei that no
recipient can claim.

The invariant test `invariant_balanceSumEqualsContractBalance` would catch
violations during fuzzing because the handler never triggers these paths, but
it can drift in production.

Mitigation: add an admin-only `sweep(address to)` that withdraws
`address(this).balance - totalBalances` (track the sum in a `uint256
_totalCredited` variable so the difference is cheap to compute). Admin trust
is already required for the role grants, so this introduces no new trust
assumption.

---

### L-07 — Deploy script never updated what the frontend reads

| Severity / Status | Low / Fixed |
|---|---|
| Location          | `contracts/scripts/deploy.ts` |

The deploy script writes `contracts/deploy/addresses.json`, which the **backend**
read replica consumes (`backend/src/lib/addresses.ts`). The **frontend**, however,
reads addresses from `VITE_*` env vars in `frontend/.env` (not from any JSON file —
see `frontend/src/config/contracts.ts` and `CLAUDE.md`). Nothing wrote those vars,
so after a Sepolia deploy the UI kept all-zero addresses and silently targeted the
zero address (every call reverts).

> Note: an earlier draft of this finding prescribed writing to
> `frontend/src/config/addresses.json`. That path is dead — no code reads it, and
> redirecting the deploy output there would break the backend, which depends on
> `contracts/deploy/addresses.json`. The finding is corrected here.

**Fix applied:** `deploy.ts` still writes `contracts/deploy/addresses.json` for the
backend, and now also merge-upserts the four `VITE_*_ADDRESS` vars plus
`VITE_CHAIN_ID` into `frontend/.env` (`upsertFrontendEnv`), preserving existing keys
such as `VITE_API_BASE_URL`. A single `npm run deploy:sepolia` now wires both
subsystems. Not a contract bug — a deploy-time foot-gun and reproducibility hazard,
now closed.

---

### I-01 — Two parallel auth systems on `PokemonCardNFT`

| Severity / Status | Informational / Open |
|---|---|
| Location          | `PokemonCardNFT.sol:10, 85-90` |

`PokemonCardNFT` inherits both `Ownable` and `AccessControl`. The deployer
holds both `owner` and `DEFAULT_ADMIN_ROLE`. `addCardToPool` / `batchAddCards`
gate on `onlyOwner`; `mintCard` gates on `onlyRole(MINTER_ROLE)`. The two
authorities can be transferred independently (`transferOwnership` vs
`grantRole`/`revokeRole`) and could diverge after deploy.

This is *legal* — there is no functional bug — but the dual surface complicates
audit and increases the chance of an admin-key migration misconfiguring one
without the other. Pick one (the OpenZeppelin recommendation is to drop
`Ownable` for `AccessControl`-only on contracts that already use role-based
auth) and document.

---

### I-02 — `_drawFromInventory` makes up to 5 external view calls per pack

| Severity / Status | Informational / Open |
|---|---|
| Location          | `GachaPack.sol:166-180`, `PokemonCardNFT.sol:165-181` |

Each iteration of `_drawFromInventory` calls `nft.getAvailableCardIds(tier)`,
which itself iterates the rarity array twice (once to count, once to fill).
For a fully depleted Legendary tier and a roll of Legendary, the falldown loops
through 5 tiers — up to 10 array scans (and 10 storage reads per scan).

Optimisation: cache the `cardIdsByRarity_*` lengths and `currentSupply` reads
locally, or expose a `getFirstAvailable(rarity)` view that returns one
candidate plus a "tier exhausted" boolean — saves one full scan per draw.
Bounded at 40 cards/tier today, so impact is minor.

---

### I-03 — `GachaPack` accepts up to 10 000 bps platform fee; `Marketplace` caps at 1 000

| Severity / Status | Informational / Open |
|---|---|
| Location          | `GachaPack.sol:79, 129`; compare `Marketplace.sol:22, 84` |

`GachaPack.setRevenueConfig` and the constructor revert only at
`bps > 10_000`. A misconfigured `platformFeeBps` of, say, 9 500 would route
95 % of pack revenue to the platform and 5 % to the issuer (presumably the
artist). The Marketplace, by contrast, caps `_platformFeeBps` at 1 000 (10 %).

Recommend a `MAX_PLATFORM_FEE_BPS` constant on `GachaPack` consistent with the
Marketplace (or whatever the documented policy is). Reduces the blast radius
of a fat-finger config change.

---

### I-04 — `royaltyInfo` divides by 10 000 unconditionally

| Severity / Status | Informational / Open |
|---|---|
| Location          | `PokemonCardNFT.sol:294-303` |

If `rxs.length == 0`, `receiver` is `address(0)` and `royaltyAmount` is 0
(since `totalBps == 0`). The division by 10 000 never divides by zero; the
branch is harmless. Noted for completeness — no remediation needed.

---

### I-05 — `_routeRevenue` reads `msg.value` directly

| Severity / Status | Informational / Open |
|---|---|
| Location          | `GachaPack.sol:184-197` |

`_routeRevenue` is called only from `openPack`, which has already validated
`msg.value == packPrice`. Reading `msg.value` again inside the helper is safe
today but tightens the coupling between caller and callee — if another path
ever calls `_routeRevenue` without an upstream check, the behaviour is opaque.
Prefer threading `msg.value` (or `packPrice`) in as an explicit parameter.

---

### I-06 — `feeBps` typed as `uint96`

| Severity / Status | Informational / Open |
|---|---|
| Location          | `PokemonCardNFT.sol:46`, `Marketplace.sol`, `GachaPack.sol` |

`feeBps` values never exceed `MAX_ROYALTY_BPS = 1000`; `uint16` is plenty
(`max 65 535`). The `uint96` choice is deliberate — it packs `(address,
uint96)` into a single storage slot per `RoyaltyReceiver` struct, matching the
EIP-2981 convention. No change recommended; called out so a future
"optimisation" doesn't accidentally repack and waste a slot.

---

## 5. Defensive Patterns — Verification Notes

### 5.1 Checks-Effects-Interactions

| Function                              | Order | Verdict |
|---------------------------------------|-------|---------|
| `PaymentSplitter.claim`               | check → zero balance → external `call` | Correct. Two-layer: CEI + `nonReentrant`. |
| `Marketplace.buyCard`                 | check listing/value → delete listing → deposit (mutates external storage) → `safeTransferFrom` (external) | Correct. `delete` happens before any external call; `safeTransferFrom` is last so its callback cannot mutate listing/splitter state. |
| `GachaPack.openPack`                  | check value → mint × 5 (external, triggers `onERC721Received`) → deposit | Acceptable under `nonReentrant`. No state in `GachaPack` is exposed to the reentrant callback (the only mutable state is `_nonce`, which the callback would only advance further — no value at risk). |
| `PokemonCardNFT._mintCardInternal`    | write `_cards`, `tokenCardId`, `_royaltyReceivers` → `_safeMint` (external) → emit | Correct. Effects before external call — a previous version had effects after, fixed in a prior audit pass per `docs/audit.md`. |

### 5.2 Reentrancy guards

`ReentrancyGuard` applied to: `PaymentSplitter.claim`, `Marketplace.buyCard`,
`GachaPack.openPack`. `PaymentSplitter.deposit` correctly omits the guard
(it has no external call), as does the entire `PokemonCardNFT` (no value
flows through it).

The repo's `MarketplaceAttacker` and `ReentrancyAttacker` test contracts
exercise both paths; both attacks are blocked. Verified during this audit by
running the Hardhat and Foundry suites end-to-end.

### 5.3 Custom errors

100 % usage. No `require("string")` instances. Saves ~50 gas/revert and is
ABI-stable for typed-error consumption.

### 5.4 Integer arithmetic

Solidity 0.8.24 with default checked arithmetic. Zero `unchecked` blocks
remain in production contracts (one was removed in the previous audit pass).
The `for` loop counters are bounded (`< receivers.length`, `< CARDS_PER_PACK`,
etc.) so the overflow risk is structural rather than arithmetic.

### 5.5 Out-of-gas

No unbounded loops sending ETH. The longest write loop is `PaymentSplitter.
deposit` at `n ≤ 6` (Marketplace: 1 platform + ≤ 4 royalty receivers + 1
seller). The longest view loop is `getAvailableCardIds` at `n ≤ 40` (size of
seeded pool).

---

## 6. Royalty Math — Conservation Proof

Setup (matches `docs/architecture.md` §2 and the Foundry fuzz):

```
salePrice         = P
platformFeeBps    = f         (in [0, 1000])
royaltyReceivers  = [(rx_i, b_i)]_{i=1..N}    Σ b_i ≤ 1000
```

The Marketplace computes:

```
platformFee     = ⌊P · f / 10000⌋
royaltyAmts[i]  = ⌊P · b_i / 10000⌋     for i = 1..N
sellerProceeds  = P − platformFee − Σ royaltyAmts[i]
```

Then deposits `[platform, rx_1..rx_N, seller]` with
`[platformFee, royaltyAmts..., sellerProceeds]`. The splitter requires
`Σ deposits == msg.value`, and `msg.value == P` by the upstream check.

**Claim (conservation):** `platformFee + Σ royaltyAmts + sellerProceeds = P`.

**Proof:** By construction `sellerProceeds := P − platformFee − Σ
royaltyAmts`, so `platformFee + Σ royaltyAmts + sellerProceeds = platformFee +
Σ royaltyAmts + (P − platformFee − Σ royaltyAmts) = P`. The floor function in
each fee calculation produces a non-negative remainder which is absorbed into
`sellerProceeds` (the seller is the last-distributed party). No wei is created
or destroyed.

**Empirical verification.** `testFuzz_valueConservation` runs 1 000 randomised
(`P, b_1, b_2, f`) tuples and asserts exact wei equality. Zero failures across
the most recent run. The `testFuzz_e2eValueConservation` runs the full
end-to-end pack-open → list → buy → claim flow and asserts wei conservation
across all parties.

---

## 7. Gacha Distribution — Empirical vs Theoretical

| Rarity     | Theoretical | Observed (1 000 cards) | Δ        | Within ±20% |
|------------|------------:|-----------------------:|---------:|:-----------:|
| Common     | 600         | 604                    | +0.67 %  | ✓ |
| Uncommon   | 250         | 244                    | −2.40 %  | ✓ |
| Rare       | 100         | 104                    | +4.00 %  | ✓ |
| Ultra Rare | 40          | 38                     | −5.00 %  | ✓ |
| Legendary  | 10          | 10                     | ±0.00 %  | ✓ |

The keccak256-based pseudo-RNG produces a distribution statistically
consistent with the specified weights at n = 1 000. See M-04 for the
adversarial side of this analysis (validator MEV).

---

## 8. Access Control Matrix

| Function | Gate | Threat if unguarded |
|---|---|---|
| `PokemonCardNFT.addCardToPool` / `batchAddCards` | `onlyOwner` | Pool poisoning (fake cards, royalty redirect) |
| `PokemonCardNFT.mintCard(*)` (both overloads) | `onlyRole(MINTER_ROLE)` | Arbitrary supply inflation |
| `PokemonCardNFT.grantRole` / `revokeRole` | `onlyRole(DEFAULT_ADMIN_ROLE)` (inherited) | Privilege escalation |
| `GachaPack.setPackPrice` / `setRevenueConfig` | `onlyOwner` | Rug via fee or destination flip |
| `Marketplace.setPlatformConfig` | `onlyOwner` | Fee or treasury redirect |
| `PaymentSplitter.deposit` | `onlyRole(DEPOSITOR_ROLE)` | Phantom credits (drain via crafted balance) |
| `PaymentSplitter.claim` | `msg.sender` only | (self-only, safe) |

**Deployment wiring (from `scripts/deploy.ts`):**

```
nft.grantRole(MINTER_ROLE,           gachaPack)
splitter.grantRole(DEPOSITOR_ROLE,   gachaPack)
splitter.grantRole(DEPOSITOR_ROLE,   marketplace)
```

The deployer EOA retains `DEFAULT_ADMIN_ROLE` on both NFT and splitter, plus
`Ownable.owner` on NFT / GachaPack / Marketplace. **Recommendation:** before
any mainnet deploy, transfer all three to a Safe multisig and revoke the EOA's
admin role on the splitter. The capstone demo can keep the EOA.

---

## 9. Slither Triage (0.11.5)

| Detector              | Severity | Finding                                    | Verdict |
|-----------------------|----------|--------------------------------------------|---------|
| `reentrancy-benign`   | Medium   | `_mintCardInternal` state writes after `_safeMint` | **Fixed** in prior pass — CEI reordered |
| `reentrancy-events`   | Info     | Events emitted after `_safeMint`           | Accepted — standard ERC-721 pattern |
| `calls-loop`          | Medium   | `nft.mintCard` inside `openPack` loop      | False positive — bounded at `CARDS_PER_PACK = 5` |
| `uninitialized-local` | Medium   | Default-zero locals                        | False positive — Solidity initialises locals to 0 |
| `locked-ether`        | Medium   | `ReentrancyAttacker` has no withdraw       | Test-only contract |
| `missing-zero-check`  | Low      | Treasury / issuer / admin addresses        | Accepted (see L-01, L-02) |
| `missing-inheritance` | Info     | Marketplace / Splitter vs. test-only interfaces | False positive |
| `low-level-calls`     | Info     | `msg.sender.call{value:}` in `claim`       | Accepted — return checked, required pattern |
| `pragma`              | Info     | Multiple OZ pragma versions                | False positive — OZ uses range pragmas |
| `costly-loop`         | Info     | `keccak256`, `delete` in loops             | Accepted — required for gacha; deploy-time only |
| `naming-convention`   | Info     | Underscore-prefixed names                  | Accepted |
| `unindexed-event-address` | Info | `RevenueConfigSet`, `PlatformConfigSet`    | Accepted (admin-only events) |

---

## 10. Test Suite Status (post-audit)

```
Hardhat:
  119 passing (3s)

Foundry:
  17 tests across 5 suites — 0 failed, 0 skipped
  Fuzz:      1 000 runs per testFuzz_*
  Invariant: 256 runs × 15 calls per invariant_*
```

The H-01 fix in this pass added 7 new Hardhat tests; the full suite still
passes. No existing test was changed in a way that could mask a regression.

### Coverage gaps observed

- **M-03 (stale listing) has no test.** Adding a regression for "transfer
  after listing then attempt to buy" would catch any future refactor that
  weakens the atomicity guarantee.
- **L-01 (zero-address receiver in `deposit`)** is not exercised — Foundry
  handler should occasionally pass `address(0)` to confirm the eventual
  guard.
- **Fork test for OpenSea / external EIP-2981 consumer** would empirically
  demonstrate M-01 (the artist receiving 0). Useful for the report.

---

## 11. Centralisation & Operational Risks

The system is non-custodial for users (NFTs and ETH always live in well-known
contracts), but the admin keys hold genuine power:

1. **Admin can capture future revenue** via `setRevenueConfig` (GachaPack) and
   `setPlatformConfig` (Marketplace). Cannot retroactively redirect already-
   credited balances in the splitter.
2. **Admin can pollute the pool** — add cards with self-favouring royalty
   splits. Cannot retroactively change royalties on already-minted tokens
   (`_royaltyReceivers[tokenId]` is set at mint and never mutated).
3. **Admin can mint additional cards within `maxSupply`** via the deployed
   minter (GachaPack) by lowering `packPrice` to a token amount and opening
   packs. Cannot exceed `maxSupply` after the H-01 fix.
4. **No emergency pause.** If a future bug is discovered, there is no way to
   stop trading or pack opens short of revoking minter and depositor roles
   (which freezes the system entirely — including legitimate users' ability
   to claim). For a capstone, acceptable. For mainnet, consider an
   `AccessControl`-gated `Pausable` mixin on Marketplace and GachaPack only.

---

## 12. Recommended Pre-Mainnet Checklist

If this codebase were to leave the capstone context for a real deployment:

1. [ ] Replace `block.prevrandao` with Chainlink VRF (M-04).
2. [ ] Decide M-01 disposition (drop EIP-2981 advertising, or implement a
       splitter-routed `royaltyInfo`).
3. [ ] Add the stale-listing eviction path (M-03).
4. [ ] Apply zero-address checks in constructors and in `PaymentSplitter.
       deposit` (L-01, L-02).
5. [ ] Implement on-chain JSON metadata via data URIs (L-03).
6. [ ] Add `Pausable` to GachaPack and Marketplace.
7. [ ] Transfer all admin roles to a multisig; revoke EOA admin.
8. [ ] Get a second opinion from an external auditor.
9. [ ] Bug bounty (Immunefi or similar) before public launch.
10. [ ] Monitor `PackOpened`, `Purchased`, and `Deposited` events with an
        off-chain indexer for anomaly detection.

---

*Auditor: senior blockchain engineer (this pass). Capstone IT4527E,
Hanoi University of Science and Technology. Findings and remediations as of
2026-06-01.*
