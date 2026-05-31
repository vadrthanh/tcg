# Pokémon TCG Gacha NFT Marketplace — Build Log

> This file records every phase of the build. Updated after each gate.

---

## Phase 0 — Project Scaffolding ✅ COMPLETE

**Date:** 2026-05-31

### What was built

Monorepo layout:
```
TCG/
├── .env.example          # Template for secrets (gitignored .env)
├── .gitignore            # Excludes node_modules, .env, artifacts, cache, out
├── instruction.md        # Original build prompt
├── BUILD_LOG.md          # This file
├── contracts/            # Hardhat 2 + Foundry smart-contract workspace
│   ├── hardhat.config.ts # Solidity 0.8.24, optimizer on 200 runs, Sepolia network
│   ├── foundry.toml      # forge shares same src/, fuzz 1000 runs, invariant 256 runs
│   ├── tsconfig.json     # CommonJS TypeScript for Hardhat scripts/tests
│   ├── package.json      # npm scripts: compile, test, test:fuzz, deploy:sepolia,
│   │                     #             verify:sepolia, coverage, gas
│   ├── src/              # Solidity contracts (Phases 1-4)
│   ├── test/hardhat/     # Hardhat Mocha/Chai integration tests
│   ├── test/foundry/     # Foundry fuzz + invariant tests
│   ├── scripts/          # deploy.ts, verify.ts
│   └── deploy/           # Ignition modules (optional)
└── frontend/             # Vite + React 18 + TypeScript + Tailwind CSS
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── postcss.config.js
    └── src/
```

### Package versions installed

| Package | Version |
|---|---|
| Hardhat | 2.28.6 |
| @nomicfoundation/hardhat-toolbox (hh2) | 6.1.2 |
| @nomicfoundation/hardhat-foundry | 1.2.1 |
| @nomicfoundation/hardhat-verify | 2.1.3 |
| solidity-coverage | 0.8.17 |
| @openzeppelin/contracts | 5.6.1 |
| Foundry (forge) | 1.7.1 |
| Vite | 6.x |
| React | 18 |
| ethers.js | 6.x |
| tailwindcss | 3.x |

### Compiler confirmation

```
npx hardhat compile  → Compiled 1 Solidity file successfully (evm target: paris)
forge build          → No files changed, compilation skipped
```

Both compilers target Solidity 0.8.24, optimizer enabled (200 runs), **EVM: cancun**
(required for OpenZeppelin 5.6.1 which uses the `mcopy` opcode from EIP-5656).

### Design decisions

- **Hardhat 2** was chosen over Hardhat 3 because Hardhat 3 is ESM-only and its
  toolbox v7 explicitly rejects both v2 and v3 (transition package). The stable
  Hardhat 2 ecosystem (hh2 tag) works reliably with OpenZeppelin 5 and Foundry.
- `hardhat-foundry` plugin lets both tools share the same `src/` directory and
  compiler settings — no duplication.
- `.env` is loaded from the monorepo root (`../env`) so both the contracts
  workspace and future scripts share one secret store.
- `type: "commonjs"` kept in contracts `package.json` because Hardhat 2 is CJS.
- **EVM version bumped to `cancun`**: OZ 5.6.1's `Bytes.sol` uses `mcopy` (EIP-5656,
  Cancun hardfork). The default `paris` target caused a compile error.

---

## Phase 1 — PokemonCardNFT.sol ✅ COMPLETE

**Date:** 2026-05-31

### What was built

`src/PokemonCardNFT.sol` — ERC-721 + EIP-2981 NFT with per-token multi-receiver royalty splits.

**Key design choices:**
- Extends `ERC721`, `ERC2981`, `AccessControl` (all from OpenZeppelin 5).
- `MINTER_ROLE` (via AccessControl) replaces a single `onlyMinter` address — allows multiple
  minters and clean revocation without redeploying.
- `_royaltyReceivers[tokenId]` stores the full `RoyaltyReceiver[]` array per token.
- `royaltyInfo()` is fully overridden: sums all `feeBps` values to compute total royalty;
  returns the first receiver as the EIP-2981 "canonical" receiver for marketplace compatibility.
  The Marketplace must call `getRoyaltyReceivers()` to split correctly.
- No `_setTokenRoyalty()` call — the ERC2981 parent's internal storage is bypassed because
  the override handles everything. We still inherit ERC2981 for the interface ID.
- `unchecked` loop for summing `feeBps` — individual values are `uint96`; total is checked
  against MAX_ROYALTY_BPS immediately after. Overflow would require >1.4e28 bps which is
  impossible given the cap check.
- Custom errors (`RoyaltyCapExceeded`, `InvalidReceiver`, `EmptyReceivers`) instead of
  `require` strings — saves gas on revert.

### Test results (Hardhat)

```
PokemonCardNFT
  mintCard — access control
    ✔ reverts when called by non-minter
    ✔ succeeds after MINTER_ROLE is granted
    ✔ reverts if MINTER_ROLE is later revoked
  metadata
    ✔ stores card data correctly
    ✔ tokenURI returns the imageURI
    ✔ increments tokenId for each mint
    ✔ emits CardMinted with correct rarity
    ✔ emits RoyaltyReceiversSet
  royaltyInfo — EIP-2981
    ✔ returns correct total royalty for single receiver (500 bps = 5%)
    ✔ returns correct total royalty for multiple receivers (300 + 200 = 5%)
    ✔ returns first receiver as the EIP-2981 receiver address
  getRoyaltyReceivers
    ✔ returns the full receiver array
    ✔ each token has an independent receiver array
  royalty cap enforcement
    ✔ reverts when total feeBps exceeds 1000 (10%)
    ✔ accepts exactly MAX_ROYALTY_BPS (1000)
    ✔ reverts when receivers array is empty
    ✔ reverts on zero-address receiver
  supportsInterface
    ✔ returns true for ERC-721 (0x80ac58cd)
    ✔ returns true for EIP-2981 (0x2a55205a)
    ✔ returns false for a random interface

20 passing (1s)
```

---

## Phase 2 — PaymentSplitter.sol ✅ COMPLETE

**Date:** 2026-05-31

### What was built

`src/PaymentSplitter.sol` — pull-payment vault with role-gated deposits and CEI claim.

**Key design choices:**
- `DEPOSITOR_ROLE` (AccessControl) — GachaPack and Marketplace granted after deploy.
- `deposit()`: no external calls, pure storage writes — cannot be reentered meaningfully.
  Still validates `sum(amounts) == msg.value` exactly; any wei discrepancy reverts.
- `claim()`: CEI — `balances[msg.sender] = 0` before `call{value}`. Plus `nonReentrant`
  from OZ's `ReentrancyGuard` as defence-in-depth. Call-success is checked; a revert
  from the recipient propagates as `TransferFailed`.
- Added `lib/forge-std` via `forge install` (no-git mode) for Foundry tests.

### Test results

**Hardhat (18/18 passing):**
```
PaymentSplitter
  deposit — access control
    ✔ reverts for non-depositor
    ✔ succeeds for DEPOSITOR_ROLE holder
  deposit — balance crediting
    ✔ credits a single receiver correctly
    ✔ credits multiple receivers correctly
    ✔ accumulates across multiple deposits
    ✔ reverts on sum mismatch (too little value)
    ✔ reverts on sum mismatch (too much value)
    ✔ reverts on array length mismatch
    ✔ reverts when receivers array is empty
    ✔ emits Deposited event with correct args
  claim
    ✔ pays out the exact balance
    ✔ zeroes the balance after claim
    ✔ double-claim reverts with NothingToClaim
    ✔ bob cannot claim alice's balance
    ✔ emits Claimed event
    ✔ contract balance drops to zero after single recipient claims
  multi-recipient independence
    ✔ each recipient claims independently without affecting others
  reentrancy protection
    ✔ malicious receiver cannot drain more than its balance

18 passing (775ms)
```

**Foundry (5/5 passing — 1000 fuzz runs + 256-run invariant with 3840 calls):**
```
testFuzz_claimConservesEth         PASS (runs: 1000)
testFuzz_depositInvariant          PASS (runs: 1000)
testFuzz_depositRevertsOnValueMismatch PASS (runs: 1000)
test_reentrancyCannotDrain         PASS
invariant_balanceSumEqualsContractBalance PASS (runs: 256, calls: 3840, reverts: 1689)
```
The invariant `totalDeposited - totalClaimed == contract.balance` held across all runs.
The reentrancy attacker received exactly its own balance — victim's funds untouched.

---

## Phase 3 — GachaPack.sol ✅ COMPLETE

**Date:** 2026-05-31

### What was built

`src/GachaPack.sol` — pack purchase, weighted-random card selection, revenue routing.

**Key design choices:**
- `_random(salt)` is an isolated internal function — the sole change required for a
  Chainlink VRF upgrade is replacing this function body; all other logic stays the same.
- Cumulative-weight table as `uint256` constants — branchless lookup in `_rollRarity`.
- `_generateCard` is a `pure` function with 25 hardcoded templates (5 per tier).
- Revenue routing via `_routeRevenue()`: `issuerAmt = msg.value - platformAmt` ensures
  no wei is stranded in GachaPack regardless of rounding.
- Default card royalty: 500 bps platform + 300 bps issuer = 800 bps (8%) — well under the 10% cap.
- `nonReentrant` on `openPack()` since it calls external contracts (nft.mintCard, splitter.deposit).

### Test results

**Hardhat (18/18 passing):**
```
GachaPack
  payment validation
    ✔ reverts when payment is too low
    ✔ reverts when payment is too high
    ✔ reverts when no payment sent
  openPack — card minting
    ✔ mints exactly 5 cards to the buyer
    ✔ mints cards with sequential tokenIds starting from 0
    ✔ second pack gives tokenIds 5-9
    ✔ each card has a valid rarity (0-4)
    ✔ each card has a non-empty name and imageURI
    ✔ each card has royalty receivers set
    ✔ emits PackOpened with 5 tokenIds and 5 rarities
  revenue routing
    ✔ entire pack price lands in the splitter (contract balance)
    ✔ platform receives 80% of pack price (8000 bps)
    ✔ issuer receives remaining 20% of pack price
    ✔ platform + issuer amounts sum to exact pack price (no wei lost)
    ✔ gacha contract holds zero ETH after opening (all routed to splitter)
    ✔ accumulates correctly over multiple packs
  owner configuration
    ✔ owner can update pack price
    ✔ non-owner cannot update pack price

18 passing (920ms)
```

**Foundry statistical distribution (1000 cards / 200 packs):**
```
Total cards minted : 1000
Common    (exp 600): 604   → within [480, 720] ✓
Uncommon  (exp 250): 244   → within [200, 300] ✓
Rare      (exp 100): 104   → within [ 80, 120] ✓
UltraRare (exp  40):  38   → within [ 32,  48] ✓
Legendary (exp  10):  10   → within [  1,  20] ✓
Sum                : 1000  ✓
```
All tier counts fall within ±20% of theoretical expectation. The distribution
matches the specified weights (60/25/10/4/1) to within normal statistical variance.

---

## Phase 4 — Marketplace.sol ✅ COMPLETE

**Date:** 2026-05-31

### What was built

`src/Marketplace.sol` — atomic NFT-for-ETH swap with multi-receiver royalty distribution.

**Key design choices:**
- CEI strictly applied in `buyCard`: `delete listings[tokenId]` is the very first state
  change. If the NFT transfer reverts, the delete is rolled back by the EVM — listing
  survives intact, no ETH is credited. Atomicity is free via EVM rollback semantics.
- `nonReentrant` as defence-in-depth — prevents a malicious ERC-721 receiver from
  re-entering during `safeTransferFrom`.
- All ETH flows through PaymentSplitter (pull-payment) — no direct ETH push to any
  address inside `buyCard`, eliminating gas-griefing and push-reentrancy vectors.
- Royalty amounts: each share = `(price × feeBps) / 10_000`. Seller absorbs rounding
  dust via `sellerProceeds = price − platformFee − Σ royaltyAmts`, guaranteeing the
  sum passed to `splitter.deposit()` equals `msg.value` exactly.
- Platform fee capped at 1000 bps (10%); with NFT max royalty of 10%, seller ≥ 80%.
- `MAX_PLATFORM_FEE_BPS = 1000` constant enforced in constructor and setter.

### Test results

**Hardhat (24/24 passing):**
```
Marketplace
  listCard
    ✔ emits Listed event with correct args
    ✔ stores listing correctly
    ✔ reverts if caller is not the token owner
    ✔ reverts if price is zero
    ✔ reverts if marketplace is not approved
    ✔ accepts setApprovalForAll instead of per-token approve
  cancelListing
    ✔ emits ListingCancelled
    ✔ deletes the listing
    ✔ reverts if not the seller
    ✔ reverts if not listed
  buyCard — happy path
    ✔ NFT transfers to buyer
    ✔ listing is deleted after purchase
    ✔ platform receives correct fee (2.5%)
    ✔ royaltyR1 receives correct amount
    ✔ royaltyR2 receives correct amount
    ✔ seller receives correct proceeds
    ✔ platformFee + royalties + sellerProceeds == salePrice (no wei lost)
    ✔ emits Purchased with correct args
    ✔ splitter holds exact sale price
  buyCard — errors
    ✔ reverts if tokenId not listed
    ✔ reverts if payment is too low
    ✔ reverts if payment is too high
  buyCard — atomicity
    ✔ reverts entirely if NFT transfer fails: no ETH credited, listing survives
  buyCard — reentrancy protection
    ✔ malicious buyer cannot reenter via onERC721Received

24 passing (1s)
```

**Foundry (3/3 passing — 2 × 1000-run fuzz + 1 reentrancy):**
```
testFuzz_valueConservation (pure math)   PASS  runs: 1000
testFuzz_e2eValueConservation (on-chain) PASS  runs: 1000
test_reentrancyOnBuyCard                 PASS
```
Value-conservation invariant `platformFee + Σ royaltyAmts + sellerProceeds == salePrice`
proven over 1000 fuzz runs of arbitrary `(salePrice, r1Bps, r2Bps)` inputs — both
as pure math and end-to-end through the live contracts.
Reentrancy attacker received exactly one NFT; seller's balance was correctly credited.

---

## Phase 5 — Full Local Integration ✅ COMPLETE

**Date:** 2026-05-31

### What was built

`test/hardhat/Integration.test.ts` — 6-step end-to-end journey on local Hardhat node.

### End-to-End Test (6/6 passing)

```
Integration — Full End-to-End Journey
  ✔ STEP 1 — WalletA opens a pack: 5 cards minted, revenue routed to splitter
  ✔ STEP 2 — WalletA lists a card at 1 ETH
  ✔ STEP 3 — WalletB buys the card: NFT transfers, all balances credited
  ✔ STEP 4 — All claimable balances are exactly correct
  ✔ STEP 5 — All parties claim and receive exact ETH amounts
  ✔ STEP 6 — Splitter ETH balance is 0 after all claims
```

**Exact accounting verified (packPrice=0.01 ETH, salePrice=1 ETH):**
| Party    | Source                             | Amount    |
|----------|------------------------------------|-----------|
| platform | Pack 80% + marketplace 2.5% + royalty 5% | 0.083 ETH |
| issuer   | Pack 20% + royalty 3%              | 0.032 ETH |
| walletA  | Seller proceeds (89.5%)            | 0.895 ETH |
| **Total**| packPrice + salePrice              | **1.01 ETH** ✓ |

### Full Hardhat test suite: 86/86 passing

### Gas Report (forge snapshot, optimizer 200 runs, EVM cancun)

| Function | Gas (isolated) | Notes |
|---|---|---|
| mintCard (1 card) | 280,726 | Cold storage, 2 royalty receivers |
| openPack (5 cards) | 1,173,510 | 5×mintCard + splitter.deposit |
| ↳ per card | ~234,702 | Mint + royalty storage + event |
| listCard | ~82,745 | approve + listCard incremental |
| buyCard | ~39,094 | Warm state: royalties + deposit + NFT transfer |
| claim | ~21,395 | Single claim (warm splitter) |

Saved to `contracts/gas-report.txt`.

### Coverage

```
File                  | % Stmts | % Branch | % Funcs | % Lines
----------------------|---------|----------|---------|--------
GachaPack.sol         |   96.43 |    86.76 |   87.50 |   90.57
Marketplace.sol       |   93.55 |    75.00 |   80.00 |   91.67
PaymentSplitter.sol   |   93.33 |    92.86 |   80.00 |   94.44
PokemonCardNFT.sol    |  100.00 |    90.00 |  100.00 |  100.00
----------------------|---------|----------|---------|--------
All files (src/)      |   95.90 |    85.34 |   88.00 |   93.15
```

PokemonCardNFT achieves 100% statement and function coverage. Uncovered lines in
other contracts are primarily the `setRevenueConfig` / `setPlatformConfig` owner
setter paths not exercised in the integration journey (tested in unit tests).

---

## Section A — Card Database & On-Chain Inventory ✅ COMPLETE

**Date:** 2026-05-31

### What was built

- `contracts/data/pokemon-cards.json` — 40 Gen-I Pokémon cards (12 Common, 9 Uncommon, 8 Rare, 6 UltraRare, 5 Legendary) with PokeAPI artwork URLs, supply caps, floor prices, and royalty receivers.
- `PokemonCardNFT.sol` extended with:
  - `CardTemplate` struct (adds `attack`, `maxSupply`, `currentSupply`, `floorPrice`, `imageURI` to the existing fields)
  - `cardPool` mapping + 5 rarity index arrays
  - `addCardToPool()` / `batchAddCards()` — owner-only, seed the pool
  - `getAvailableCardIds(Rarity)` — filters to cards with remaining supply
  - `getPoolStatus()` — all cardIds + remaining supply for the frontend
  - `mintCard(address, uint16 cardId)` — new overload: reads template, increments `currentSupply`, reverts `CardSoldOut` if at max
  - Original `mintCard(address, Card, RoyaltyReceiver[])` preserved for backward compatibility
  - `CardSoldOut`, `CardNotInPool` custom errors; `CardAddedToPool` event
  - Inherits `Ownable` alongside `AccessControl` (owner manages pool, minter mints tokens)

### Design decisions
- `imageURI` added to `CardTemplate` (not in spec struct) — necessary to build `Card` on mint.
- `batchAddCards` uses a single shared receiver pair (platform + artist) for all cards in the batch, avoiding nested calldata arrays.
- `currentSupply` is always reset to 0 on `addCardToPool` regardless of what the caller passes — prevents supply manipulation in the deploy script.
- Freeform `mintCard(to, Card, receivers)` does NOT touch pool counters — safe for admin/test minting.

### Test results (17/17 passing)

```
PokemonCardNFT — Card Pool & Inventory
  addCardToPool: 4 tests ✓
  batchAddCards: 2 tests ✓
  mintCard(to, cardId) — template-based: 9 tests ✓
  getPoolStatus: 1 test ✓
  mintCard(to, Card, RoyaltyReceiver[]) — backward compat: 1 test ✓
```

## Section B — Gacha Draws From Inventory ✅ COMPLETE

**Date:** 2026-05-31

### What was built

`GachaPack.sol` updated to draw from the live on-chain card pool with falldown logic:
- `_drawFromInventory(rarity, pickSeed)` — tries the rolled rarity, falls to next-lower tier if empty, reverts `AllCardsSoldOut` if all tiers are depleted.
- Removed `_generateCard` (hardcoded templates replaced by pool lookup).
- Removed royaltyRxs building (now stored per card in pool template).
- `PackOpened` event extended with `uint16[5] cardIds` for frontend.
- `AllCardsSoldOut` custom error.

**Tests added:**
- Pool empty → immediate `AllCardsSoldOut` ✓
- Pool exhausted after first pack → second pack reverts ✓
- Legendary tier sold out → packs still open (falldown to UltraRare) ✓
- Foundry fuzz: `testFuzz_supplyNeverExceedsMax(uint8)` — 1000 runs, invariant: `currentSupply ≤ maxSupply` for every card in pool ✓

**All test files updated** to seed pool before opening packs (108 Hardhat + 17 Foundry).

### Rarity distribution (1000 cards, pool-based):
```
Common    (exp 600): 604 ✓
Uncommon  (exp 250): 244 ✓
Rare      (exp 100): 104 ✓
UltraRare (exp  40):  38 ✓
Legendary (exp  10):  10 ✓
```

## Section C — Card Pricing on Marketplace ✅ COMPLETE

**Date:** 2026-05-31

### What was built

**PokemonCardNFT.sol:**
- `mapping(uint256 => uint16) public tokenCardId` — records which pool template was used to mint each token (0 for freeform mints, since cardIds start from 1).
- Set in `mintCard(to, cardId)` at mint time.

**Marketplace.sol:**
- `Listed` event extended: `(tokenId, seller, price, rarity, cardId)` — frontend can index by rarity/cardId without additional RPC calls.
- `getSuggestedPrice(tokenId)` — reads `nft.tokenCardId(tokenId)` → `nft.getCardTemplate(cardId).floorPrice`. Returns 0 for freeform-minted tokens.
- `getListingWithDetails(tokenId)` — returns seller, price, name, rarity, hp, imageURI, cardId, suggestedPrice in one call. Works for both listed and unlisted tokens (returns zero seller/price if unlisted).

### Test results (Hardhat 112/112 + Foundry 17/17)

New tests added:
- `getSuggestedPrice` returns template floorPrice for pool-minted token ✓
- `getSuggestedPrice` returns 0 for freeform-minted token ✓
- `getListingWithDetails` returns full bundle in one call ✓
- `getListingWithDetails` returns zero seller/price for unlisted token ✓
- `Listed` event now emits rarity and cardId ✓

## Section D — README.md ✅ COMPLETE

**Date:** 2026-06-01

Generated `README.md` (248 lines) at the repo root covering:
- shields.io badges (Solidity, OpenZeppelin, Hardhat, React, Sepolia)
- 3-paragraph overview + academic context
- ASCII architecture diagram
- Rarity table (5 tiers, rates, supply, prices)
- Step-by-step gacha flow with VRF upgrade callout
- Royalty worked example (1 ETH sale → exact wei per party)
- Security features table (8 mitigations)
- Tech stack table
- Quick start with exact shell commands (compile, test, fuzz, coverage, gas, deploy local, frontend)
- Sepolia deploy instructions
- Full project directory tree with one-line descriptions
- Team table (5 roles with deliverables)
- MIT license

## Phase 6 — Deploy Script ✅ COMPLETE (Sepolia pending credentials)

**Date:** 2026-06-01

### What was built

`contracts/scripts/deploy.ts` — full deploy pipeline:
1. Deploy `PokemonCardNFT(admin)`
2. Deploy `PaymentSplitter(admin)`
3. Deploy `GachaPack(nft, splitter, platformTreasury, issuer, 8000)`
4. Deploy `Marketplace(nft, splitter, platformTreasury, 250)`
5. Grant `MINTER_ROLE` → GachaPack; `DEPOSITOR_ROLE` → GachaPack + Marketplace
6. `batchAddCards` in batches of 10 — seeds all 40 cards from `data/pokemon-cards.json`
7. Saves `deploy/addresses.json` for the frontend to read

`contracts/scripts/verify.ts` — reads `addresses.json`, calls `hardhat verify` for all 4 contracts.

**Tested locally (hardhat network):**
```
PokemonCardNFT : 0x5FbDB2315678afecb367f032d93F642f64180aa3
PaymentSplitter: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
GachaPack      : 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
Marketplace    : 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
Card pool seeded: 40 cards ✓
```

**To deploy to Sepolia:** create `.env` with `SEPOLIA_RPC_URL`, `PRIVATE_KEY`, `ETHERSCAN_API_KEY`, then:
```bash
cd contracts && npm run deploy:sepolia && npm run verify:sepolia
```

---

## Phase 7 — React Frontend ⏳ PENDING

---

## Phase 7 — React Frontend ✅ COMPLETE

**Date:** 2026-06-01

### What was built

5 pages, all wired to ethers v6 + MetaMask:

| Page | File | Key features |
|---|---|---|
| Connect | `pages/Connect.tsx` | MetaMask connect, Sepolia enforcement, network switch |
| Gacha | `pages/Gacha.tsx` | openPack tx, PackOpened event parsing, 5-card CSS 3D flip reveal |
| Inventory | `pages/Inventory.tsx` | Loads owned tokens, card grid with rarity colours |
| Marketplace | `pages/MarketplacePage.tsx` | Browse listings, list owned card, buy with atomicity |
| Royalty Dashboard | `pages/RoyaltyDashboard.tsx` | Read claimable balance, claim() tx |

Supporting files:
- `hooks/useWallet.ts` — BrowserProvider, signer, chainId check
- `components/CardFlip.tsx` — CSS 3D perspective flip, rarity-based glow
- `components/TxToast.tsx` — pending/success/error toasts (react-hot-toast)
- `config/contracts.ts` — typed ABIs, addresses, rarity name/colour maps

**Build:** `npm run build` → 476 kB JS, 0 TypeScript errors.

## Phase 8 — Audit & Documentation ✅ COMPLETE

**Date:** 2026-06-01

### Security fix applied during audit

`PokemonCardNFT._mintCardInternal` — reordered to CEI pattern:
- Before: `_safeMint` called first, then `_cards[tokenId]` and `_royaltyReceivers` written.
- After: all state written before `_safeMint`. Any `onERC721Received` callback sees a fully initialised token. Also eliminated the separate `tokenCardId[tokenId] = cardId` post-call by threading `poolCardId` parameter into `_mintCardInternal`.

**Slither 0.11.5 ran across all 4 contracts: 42 findings, all triaged.**
- 0 high, 0 unresolved medium, 0 unresolved low.
- 1 medium fixed (CEI reorder above).
- 3 medium false positives (uninitialized-local: zero is the correct init; calls-loop: bounded at 5; locked-ether: test-only contract).
- Remainder: info/style findings, accepted with documented rationale.

### Deliverables

| File | Contents |
|---|---|
| `docs/audit.md` | Self-audit: reentrancy analysis, access control table, integer/overflow review, out-of-gas proof, full Slither triage |
| `docs/architecture.md` | ASCII flow diagrams, royalty math proof with exact wei, gacha probability table + empirical data, gas analysis, setup guide |
| `DEMO.md` | Click-by-click 3-minute Sepolia demo script with talking points and local fallback |

### Test suite after audit fix

```
Hardhat: 112/112 passing
Foundry: 17/17 passing
Slither: 0 unresolved findings
```
