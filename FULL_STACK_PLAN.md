# Full-Stack Task Plan — Pokémon TCG Gacha NFT Marketplace

> 14 working days · 5 people · ~60 person-days
> Status: Phase 5 contracts exist, adding inventory + full-stack completion

---

## Stack Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND — React 18 + Vite + TypeScript + Tailwind + ethers v6 │
│  Pages: Gacha · Collection · Inventory · Marketplace · Royalty   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ reads / writes
              ┌────────────┴────────────┐
              ▼                         ▼
┌──────────────────────┐   ┌──────────────────────────────────┐
│  BACKEND API          │   │  SEPOLIA (on-chain)               │
│  Express + Prisma     │   │                                   │
│  ┌──────────────────┐ │   │  PokemonCardNFT.sol  ← mint      │
│  │ Event Indexer    │ │◄──│  GachaPack.sol       ← openPack   │
│  │ (listens to      │ │   │  Marketplace.sol     ← buy/list   │
│  │  chain events)   │ │   │  PaymentSplitter.sol ← claim      │
│  └────────┬─────────┘ │   └──────────────────────────────────┘
│           ▼           │
│  ┌──────────────────┐ │
│  │ PostgreSQL       │ │
│  │ (via Prisma)     │ │
│  │                  │ │
│  │ • cards (pool)   │ │
│  │ • minted_nfts    │ │
│  │ • listings       │ │
│  │ • transactions   │ │
│  │ • royalty_claims  │ │
│  └──────────────────┘ │
└──────────────────────┘
```

### Why an off-chain backend?

The contracts are the source of truth, but querying the chain for every UI
render is slow and expensive. The backend indexes on-chain events into
Postgres so the frontend gets fast reads (card collection, listing history,
transaction log, leaderboards) while all writes still go directly to the
chain via the user's wallet.

---

## Sprint Phases

| Phase | Name                | Days    | Goal                                                    |
|-------|---------------------|---------|---------------------------------------------------------|
| A     | Inventory + DB      | 1–3     | Card pool on-chain, card DB seeded, backend scaffolded   |
| B     | Frontend + Backend  | 2–8     | All pages + API endpoints + indexer running              |
| C     | Integration         | 6–9     | Full flow: frontend → chain → indexer → DB → frontend    |
| D     | Audit + Testing     | 8–11    | Fuzz tests, reentrancy proofs, gas optimization          |
| E     | Docs + Demo         | 10–14   | Technical report, README, demo rehearsal                 |

---

## Person 1 — Smart Contract: NFT + Inventory System

**Owns:** `PokemonCardNFT.sol` · card pool · `pokemon-cards.json` · deploy seeding

### Phase A — Inventory System (Day 1–3)

| Day | Task | Details |
|-----|------|---------|
| 1 | Add `CardTemplate` struct to NFT contract | `cardId`, `name`, `rarity`, `pokemonType`, `hp`, `attack`, `maxSupply`, `currentSupply`, `floorPrice` (uint96). Pack struct to minimize storage slots. |
| 1 | Add `cardPool` mapping + per-rarity arrays | `mapping(uint16 => CardTemplate) cardPool` + `uint16[]` arrays per rarity for O(1) lookup. |
| 2 | Implement `batchAddCards()` | Owner-gated. Reads array of `CardTemplate`, pushes each to the correct rarity array. Event: `CardAddedToPool`. |
| 2 | Implement view functions | `getAvailableCardIds(Rarity)` → returns cardIds where `currentSupply < maxSupply`. `getCardTemplate(cardId)` → returns full struct. `getPoolStatus()` → returns all cardIds + remaining supply in one call. |
| 2 | Modify `mintCard()` | Now takes `cardId` instead of raw metadata. Reads template from `cardPool`, increments `currentSupply`, reverts `CardSoldOut()` if at max. |
| 3 | Create `pokemon-cards.json` | 40 Gen-I cards: 12 Common (supply 600–1000, floor 0.0005–0.002 ETH), 9 Uncommon (250–350, 0.006–0.01), 8 Rare (60–80, 0.03–0.04), 6 Ultra Rare (20–30, 0.08–0.12), 5 Legendary (3–8, 0.3–0.8). Use PokeAPI artwork URLs. |
| 3 | Unit tests | Seed 5 cards → mint until `maxSupply` → assert `CardSoldOut()` revert. Verify `getAvailableCardIds` excludes depleted cards. Verify `getPoolStatus` returns correct remaining counts. |

### Phase C–D — Integration + Gas (Day 6, 8–9)

| Day | Task | Details |
|-----|------|---------|
| 6 | Coordinate with P4 on `getPoolStatus()` response shape | Ensure the view returns data in a format the frontend can consume in one RPC call. |
| 8–9 | Gas optimization pass | Pack structs into fewer slots. Use `uint96` for floorPrice (fits with `address` in one slot). Measure with `hardhat-gas-reporter`: before vs after. |

### Phase E — Report (Day 12)

| Day | Task | Details |
|-----|------|---------|
| 12 | Write royalty math proof section | Worked example: 1 ETH sale, 5% royalty, 3 receivers [50/30/20], 2.5% platform fee. Show exact wei per party, prove sum == salePrice. |

---

## Person 2 — Smart Contract: Gacha Engine + Backend API

**Owns:** `GachaPack.sol` · rarity logic · Express backend · Prisma schema · event indexer

### Phase A — Gacha Inventory Draw (Day 1–3)

| Day | Task | Details |
|-----|------|---------|
| 1–2 | Rewire `openPack()` to draw from inventory | For each of 5 cards: roll rarity (cumulative weight table) → `getAvailableCardIds(rarity)` → random index → `mintCard(buyer, cardId)`. |
| 2 | Implement rarity falldown | If rolled tier has no stock, drop to next lower: Legendary → UltraRare → Rare → Uncommon → Common. If everything empty, revert `AllCardsSoldOut()`. |
| 3 | Hardhat tests | Set Legendary `maxSupply=1` → open packs → verify falldown to UltraRare. Tiny supplies → verify `AllCardsSoldOut()` revert. |

### Phase B — Backend Scaffolding (Day 4–7)

| Day | Task | Details |
|-----|------|---------|
| 4 | Scaffold Express + Prisma + PostgreSQL | `backend/` folder. Prisma schema with models: `Card`, `MintedNFT`, `Listing`, `Transaction`, `RoyaltyClaim`. Docker compose for Postgres. |
| 4 | Prisma schema | See [Database Schema](#database-schema) below. Run `prisma migrate dev` to create tables. |
| 5 | Seed script | Read `pokemon-cards.json` → insert all 40 cards into `Card` table with full metadata + supply + pricing. |
| 5–6 | Event indexer service | ethers.js v6 WebSocket provider listening to Sepolia. Index events: `CardMinted` → upsert `MintedNFT`, `PackOpened` → insert `Transaction`, `Listed` → upsert `Listing`, `Purchased` → update `Listing` + insert `Transaction`, `Claimed` → insert `RoyaltyClaim`. |
| 6–7 | REST API endpoints | See [API Endpoints](#api-endpoints) below. Express routes returning JSON. |

### Phase D — Foundry Tests (Day 8–9)

| Day | Task | Details |
|-----|------|---------|
| 8 | Fuzz invariant: `currentSupply <= maxSupply` | Small supplies (3–10), 500+ iterations. No card should ever exceed its max. |
| 9 | Statistical test: 1000 packs → rarity distribution | Assert each rarity within ±5% of configured weight. Save output for report. |

### Phase E — Report (Day 11–12)

| Day | Task | Details |
|-----|------|---------|
| 11 | Write gacha algorithm section | RNG method, cumulative weight table, falldown logic, Chainlink VRF upgrade path. |
| 12 | Write rarity distribution chart | Configured vs. observed %, bar chart from Foundry data. |

---

## Person 3 — Smart Contract: Marketplace + Security Audit

**Owns:** `Marketplace.sol` · `PaymentSplitter.sol` · security audit of all contracts + backend

### Phase A — Marketplace Updates (Day 2–3)

| Day | Task | Details |
|-----|------|---------|
| 2–3 | Add `getSuggestedPrice(tokenId)` | Reads `floorPrice` from NFT's `CardTemplate`. Frontend uses as pricing hint. |
| 3 | Add `getListingWithDetails(tokenId)` | Returns listing data + card metadata (name, rarity, hp, imageURI) in one call. |
| 3 | Update `Listed` event | Emit `cardId` + `rarity` — indexer uses these for filtering. |

### Phase C — Integration (Day 6–7)

| Day | Task | Details |
|-----|------|---------|
| 6–7 | Full end-to-end integration test | Seed cards → open pack → list card → buy from second wallet → verify: seller balance, each royalty receiver balance, platform fee balance. All exact to the wei. |

### Phase D — Security Audit (Day 8–11)

| Day | Task | Details |
|-----|------|---------|
| 8 | Audit: map all external calls in all 4 contracts | For each `.call{value}`, `.transferFrom`, cross-contract call: confirm CEI ordering + `nonReentrant` guard + access control. |
| 9 | Audit: access control matrix | Table of every privileged function → who can call it → what modifier gates it. |
| 9 | Foundry: reentrancy attack tests | Malicious contract calling `claim()` inside `receive()`. Same for `buyCard`. Both must survive — attacker gets exactly their balance, no more. |
| 10 | Foundry: value conservation invariant | Fuzz `salePrice` (0.001–100 ETH) × random splits. Assert: `sellerProceeds + sum(royalties) + platformFee == salePrice`. Zero wei lost or created. |
| 10–11 | Run Slither static analysis | Triage every finding: fixed / false-positive-with-reason. Document in audit report. |
| 11 | Audit: backend + API review | Review indexer for missed events, verify API doesn't expose sensitive data, confirm DB queries use parameterized statements (Prisma handles this). |

### Phase E — Report (Day 11–12)

| Day | Task | Details |
|-----|------|---------|
| 11–12 | Write security analysis section | Reentrancy map, access control matrix, pull-payment rationale, integer safety, CEI proof per contract, Slither triage table. |

---

## Person 4 — Frontend (React Dapp)

**Owns:** Entire frontend — all 6 pages, wallet integration, animations, API consumption

### Phase B — Build Pages (Day 2–7)

| Day | Task | Details |
|-----|------|---------|
| 2 | **Connect Wallet** | MetaMask connect, Sepolia detection, `wallet_switchEthereumChain`, `useWallet` hook with auto-reconnect. |
| 3–4 | **Gacha Page** | "Open Pack" button → tx pending toast → listen `PackOpened` event → 5-card CSS 3D flip animation (staggered 200ms). Rarity glows: Common (none), Uncommon (green), Rare (blue), Ultra Rare (purple pulse), Legendary (gold shimmer). |
| 4–5 | **Collection Page** | Fetch all 40 cards from backend API (`GET /api/cards`). Show remaining supply badge. Gray out sold-out. Glow border on cards user owns. |
| 5–6 | **Inventory Page** | Fetch user's owned NFTs from backend (`GET /api/nfts?owner=0x...`). Card grid with "List for Sale" button per card. |
| 6–7 | **Marketplace Page** | Browse listings from backend (`GET /api/listings?status=active`). Card detail + suggested price. Buy triggers on-chain `buyCard()`. List-your-card flow. |
| 7 | **Royalty Dashboard** | Read `claimable(address)` directly from chain (real-time accuracy). Claim button → tx toast → balance refresh. |

### Phase B — Data Layer (Day 3–4)

| Day | Task | Details |
|-----|------|---------|
| 3 | Set up API client layer | `frontend/src/lib/api.ts` — typed fetch wrapper for all backend endpoints. Fallback to direct RPC if backend is down. |
| 4 | Hybrid data strategy | Reads: from backend API (fast, indexed). Writes: directly to chain via ethers.js. After write tx confirms: re-fetch from API with short polling until indexer catches up. |

### Phase C — Integration (Day 8–9)

| Day | Task | Details |
|-----|------|---------|
| 8 | Test full flow against local Hardhat + backend | Connect → open pack → cards appear in inventory → list one → buy from second browser tab → both see royalties → both claim. |
| 9 | Fix edge cases | Loading states for slow RPC, error handling for rejected tx, empty states for no listings / no owned cards. |

### Phase E — Polish + Sepolia (Day 10–12)

| Day | Task | Details |
|-----|------|---------|
| 10–11 | Visual polish | Loading skeletons, responsive breakpoints, card hover effects, transaction history panel, mobile-friendly layout. |
| 12 | Switch to Sepolia | Update `addresses.json` + backend API URL. Smoke test all 6 pages against live contracts + indexed data. |

---

## Person 5 — DevOps, Deployment, Docs & Demo

**Owns:** Deploy pipeline, CI, Sepolia, README, technical report compilation, demo

### Phase A–B — Infrastructure (Day 2–4)

| Day | Task | Details |
|-----|------|---------|
| 2–3 | Update deploy script | Deploy order: NFT → PaymentSplitter → GachaPack → Marketplace → wire permissions → `batchAddCards(40 cards)`. Output `addresses.json` for frontend + backend. |
| 3 | Docker Compose for local dev | PostgreSQL + backend API + Hardhat node in one `docker-compose.yml`. `docker compose up` starts everything. |
| 4 | GitHub Actions CI | Job 1: `npx hardhat compile && npx hardhat test`. Job 2: `forge test -vvv`. Job 3: `cd backend && npx prisma migrate deploy && npm test`. Cache deps. Run on push to main + PRs. |

### Phase C — Deploy (Day 7–9)

| Day | Task | Details |
|-----|------|---------|
| 7–8 | Deploy contracts to Sepolia | Run deploy script. Verify all 4 contracts on Etherscan (`hardhat-verify`). Save verified links. |
| 8 | Deploy backend to hosting | Deploy Express API + Postgres (Railway / Render / VPS). Set `SEPOLIA_RPC_WSS` env var for indexer. Start indexer, verify events are being captured. |
| 9 | Sepolia smoke test | Open 3 packs, list a card, buy from second wallet, claim royalties. Record tx hashes. Verify backend indexed all events correctly. |

### Phase D — Metrics (Day 10)

| Day | Task | Details |
|-----|------|---------|
| 10 | Run `hardhat-gas-reporter` + coverage | Gas table for: `batchAddCards`, `openPack`, `listCard`, `buyCard`, `claim`. Coverage target: >90%. Save both artifacts. |

### Phase E — Documentation (Day 10–14)

| Day | Task | Details |
|-----|------|---------|
| 10–11 | Write README.md | Badges, project overview, architecture diagram (mermaid), card pool table, quickstart (clone → install → docker compose up → test → deploy), team table. |
| 11–13 | Compile technical report | Merge sections from P1 (royalty math), P2 (gacha algorithm + stats), P3 (security audit). Add: architecture diagram, DB schema diagram, API documentation, gas table, coverage report, Sepolia tx proof links. |
| 13–14 | Demo script + rehearsal | Step-by-step click script for live Sepolia demo (under 3 min). Rehearse ×2 with full team. Prepare backup screenshots in case Sepolia RPC is slow during presentation. |

---

## Database Schema

```prisma
// backend/prisma/schema.prisma

model Card {
  id            Int       @id                  // matches on-chain cardId
  name          String
  rarity        String                          // Common | Uncommon | Rare | UltraRare | Legendary
  pokemonType   String
  hp            Int
  attack        String
  maxSupply     Int
  currentSupply Int       @default(0)          // updated by indexer on CardMinted
  floorPrice    String                          // ETH as string for precision
  imageURI      String
  mintedNfts    MintedNFT[]
  listings      Listing[]
  createdAt     DateTime  @default(now())
}

model MintedNFT {
  tokenId       Int       @id                  // on-chain tokenId
  cardId        Int
  card          Card      @relation(fields: [cardId], references: [id])
  owner         String                          // current owner address (lowercase)
  mintedTo      String                          // original minter address
  mintedAt      DateTime
  txHash        String
  listings      Listing[]
}

model Listing {
  id            Int       @id @default(autoincrement())
  tokenId       Int
  nft           MintedNFT @relation(fields: [tokenId], references: [tokenId])
  cardId        Int
  card          Card      @relation(fields: [cardId], references: [id])
  seller        String                          // address
  price         String                          // ETH as string
  status        String    @default("active")    // active | sold | cancelled
  listedAt      DateTime
  soldAt        DateTime?
  buyer         String?
  txHash        String
}

model Transaction {
  id            Int       @id @default(autoincrement())
  type          String                          // pack_opened | card_bought | card_listed | card_cancelled
  from          String                          // address
  to            String?                         // address (null for pack_opened)
  tokenIds      Int[]                           // array of tokenIds involved
  value         String                          // ETH amount
  txHash        String    @unique
  blockNumber   Int
  timestamp     DateTime
}

model RoyaltyClaim {
  id            Int       @id @default(autoincrement())
  claimant      String                          // address
  amount        String                          // ETH claimed
  txHash        String    @unique
  timestamp     DateTime
}

model IndexerState {
  id            Int       @id @default(1)
  lastBlock     Int       @default(0)          // resume indexing from here
}
```

---

## API Endpoints

| Method | Endpoint                       | Returns                                    | Source     |
|--------|--------------------------------|--------------------------------------------|------------|
| GET    | `/api/cards`                   | All 40 cards with current supply            | DB         |
| GET    | `/api/cards/:cardId`           | Single card with mint history               | DB         |
| GET    | `/api/cards/rarity/:rarity`    | Cards filtered by rarity                    | DB         |
| GET    | `/api/nfts?owner=0x...`        | NFTs owned by address                       | DB         |
| GET    | `/api/nfts/:tokenId`           | Single NFT with card data + listing status  | DB         |
| GET    | `/api/listings`                | Active listings, sorted by recent           | DB         |
| GET    | `/api/listings?rarity=Rare`    | Listings filtered by rarity                 | DB         |
| GET    | `/api/listings/:tokenId`       | Single listing with card details            | DB         |
| GET    | `/api/transactions?address=0x` | Transaction history for an address          | DB         |
| GET    | `/api/stats`                   | Total minted, total listed, total volume    | DB         |
| GET    | `/api/stats/rarity`            | Remaining supply per rarity tier            | DB         |
| GET    | `/api/health`                  | Indexer status + last synced block          | DB         |

All endpoints are **read-only**. No POST/PUT/DELETE — all writes go to the
blockchain. The backend is a **read replica** of on-chain state.

---

## Event Indexer — Events to Capture

```
PokemonCardNFT:
  CardMinted(tokenId, cardId, to, rarity)
    → INSERT MintedNFT, UPDATE Card.currentSupply

GachaPack:
  PackOpened(buyer, tokenIds[], rarities[])
    → INSERT Transaction(type: pack_opened)

Marketplace:
  Listed(tokenId, cardId, seller, price, rarity)
    → INSERT Listing(status: active)
    → INSERT Transaction(type: card_listed)

  Purchased(tokenId, buyer, seller, price)
    → UPDATE Listing(status: sold, buyer, soldAt)
    → UPDATE MintedNFT(owner: buyer)
    → INSERT Transaction(type: card_bought)

  ListingCancelled(tokenId, seller)
    → UPDATE Listing(status: cancelled)
    → INSERT Transaction(type: card_cancelled)

PaymentSplitter:
  Claimed(claimant, amount)
    → INSERT RoyaltyClaim
```

The indexer stores `lastBlock` in `IndexerState` so it resumes correctly
after restarts. On startup, it catches up from `lastBlock` to `latest`
before switching to live event listening.

---

## Dependency Chain

```
Day 1:  P1 CardTemplate struct done
              │
Day 2:  ├── P2 rewires gacha (needs struct)
        ├── P3 adds marketplace views (needs struct)
        ├── P4 starts wallet page (no dependency)
        └── P5 updates deploy script
              │
Day 3:  P1+P2 inventory system complete
              │
Day 4:  ├── P2 starts backend scaffold + Prisma schema
        ├── P4 starts gacha page (can test locally)
        └── P5 Docker Compose setup
              │
Day 5:  P2 seed script + indexer started
              │
Day 6:  ├── P2 API endpoints done
        ├── P4 collection page (reads from API)
        └── P3 starts integration test
              │
Day 7:  ALL contracts + backend finalized
        └── P5 deploys contracts to Sepolia
              │
Day 8:  ├── P5 deploys backend to hosting
        ├── P3 starts security audit
        └── P4 starts integration testing
              │
Day 10: ├── P3 security audit done → P5 adds to report
        └── P5 runs gas + coverage reports
              │
Day 12: ├── P4 frontend on Sepolia → all can test live
        └── P1+P2+P3 submit report sections to P5
              │
Day 13: P5 compiles report → team rehearses demo
              │
Day 14: DONE — demo-ready
```

---

## Blockers & Mitigations

| Blocker | Impact | Mitigation |
|---------|--------|------------|
| P1 CardTemplate struct delayed past Day 1 | P2 + P3 idle on Day 2 | P1 pushes struct + interface only on Day 1 evening, even if tests aren't done yet. P2/P3 code against the interface. |
| Sepolia RPC down during demo | Demo fails live | P5 prepares backup: pre-recorded screen capture of full flow + Etherscan tx links as proof. |
| Backend indexer misses events | Frontend shows stale data | Indexer has catchup-from-lastBlock on restart. Frontend falls back to direct RPC calls if API returns empty. |
| Gas too high for `batchAddCards(40)` | Deploy tx fails | Split into `batchAddCards(20)` × 2. Or seed 10 cards for MVP demo and note "40-card pool in production". |
| Foundry fuzz test flaky | CI fails intermittently | Pin seed: `forge test --fuzz-seed 12345`. Document the seed in CI config. |

---

## Daily Standup Format

Every day, async in Slack or 2-min call. Each person posts:

```
✅ Yesterday: [what I finished]
🔨 Today: [what I'm working on]
🚧 Blocked by: [person/thing] OR nothing
```

Rule: if someone is blocked, the blocker responds within 2 hours. If it's
a code dependency, push a minimal interface (types/ABI only) so the blocked
person can code against it.

---

## Definition of Done

- [ ] 40 cards seeded on-chain, inventory tracking works with falldown
- [ ] All 4 contracts deployed + verified on Sepolia Etherscan
- [ ] Backend API running, indexer synced, all endpoints returning data
- [ ] PostgreSQL seeded with card pool, indexer populating live data
- [ ] Hardhat tests pass — unit + integration, coverage >90%
- [ ] Foundry tests pass — reentrancy, value conservation, supply invariant, rarity stats
- [ ] Frontend: all 6 pages work against Sepolia + backend API
- [ ] Frontend falls back to direct RPC if backend is unreachable
- [ ] Gas report + coverage report saved as artifacts
- [ ] Security audit document complete (reentrancy map, access control, Slither)
- [ ] Technical report compiled with all sections
- [ ] README.md with architecture diagram, quickstart, team table
- [ ] Demo script written + rehearsed ×2
- [ ] CI green on main branch (contracts + backend + lint)
- [ ] Docker Compose starts full local stack in one command

---

## File Deliverables Checklist

```
pokemon-nft-gacha/
├── README.md                              ← P5
├── CLAUDE.md                              ← already done
├── docker-compose.yml                     ← P5
├── contracts/
│   ├── src/
│   │   ├── PokemonCardNFT.sol             ← P1
│   │   ├── GachaPack.sol                  ← P2
│   │   ├── Marketplace.sol                ← P3
│   │   └── PaymentSplitter.sol            ← P3
│   ├── data/
│   │   └── pokemon-cards.json             ← P1
│   ├── test/
│   │   ├── PokemonCardNFT.test.ts         ← P1
│   │   ├── GachaPack.test.ts              ← P2
│   │   ├── Marketplace.test.ts            ← P3
│   │   ├── PaymentSplitter.test.ts        ← P3
│   │   └── Integration.test.ts            ← P3
│   ├── test-foundry/
│   │   ├── PaymentSplitter.fuzz.t.sol     ← P3
│   │   ├── GachaPack.invariant.t.sol      ← P2
│   │   └── Marketplace.fuzz.t.sol         ← P3
│   └── script/
│       └── deploy.ts                      ← P5
├── backend/
│   ├── prisma/
│   │   └── schema.prisma                  ← P2
│   ├── src/
│   │   ├── index.ts                       ← P2  (Express server)
│   │   ├── indexer.ts                     ← P2  (event listener)
│   │   ├── routes/
│   │   │   ├── cards.ts                   ← P2
│   │   │   ├── nfts.ts                    ← P2
│   │   │   ├── listings.ts               ← P2
│   │   │   ├── transactions.ts            ← P2
│   │   │   └── stats.ts                   ← P2
│   │   └── lib/
│   │       ├── contracts.ts               ← P2  (ethers contract instances)
│   │       └── seed.ts                    ← P2  (seed cards from JSON)
│   └── Dockerfile                         ← P5
├── frontend/
│   ├── src/
│   │   ├── abi/                           ← P4  (copied from artifacts)
│   │   ├── config/
│   │   │   ├── addresses.json             ← P5  (deploy output)
│   │   │   └── chains.ts                  ← P4
│   │   ├── hooks/
│   │   │   ├── useWallet.ts               ← P4
│   │   │   ├── usePack.ts                 ← P4
│   │   │   ├── useMarketplace.ts          ← P4
│   │   │   └── useSplitter.ts             ← P4
│   │   ├── lib/
│   │   │   ├── api.ts                     ← P4  (backend API client)
│   │   │   ├── contracts.ts               ← P4  (ethers direct calls)
│   │   │   └── types.ts                   ← P4
│   │   ├── components/                    ← P4
│   │   └── pages/                         ← P4
│   └── Dockerfile                         ← P5
└── docs/
    ├── technical-report.md                ← P5 (compiled)
    ├── security-audit.md                  ← P3
    ├── demo-script.md                     ← P5
    └── diagrams/
        ├── architecture.png               ← P5
        └── db-schema.png                  ← P2
```