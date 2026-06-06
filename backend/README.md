# TCG Backend — Read-Replica API + Event Indexer

Read replica of on-chain state for the Pokémon TCG Gacha frontend. Indexes
Sepolia events into SQLite via Prisma; serves read-only JSON over HTTP. **All
writes go directly to the chain via the user's wallet — this backend never
holds keys and never signs transactions.**

## Architecture

```
┌──────────────────┐        ┌──────────────┐         ┌─────────────┐
│  Sepolia chain   │ events │   indexer    │ writes  │   SQLite    │
│  (4 contracts)   │───────▶│  (ethers v6) │────────▶│ (Prisma)    │
└──────────────────┘        └──────────────┘         └─────────────┘
                                                            ▲
                                                            │ reads
                                                     ┌──────┴──────┐
                                                     │   API       │
                                                     │  (Express)  │
                                                     └─────────────┘
                                                            ▲
                                                            │ GET /api/...
                                                       (frontend)
```

The indexer and API are separate Node processes. They share the same SQLite
file via Prisma. Run them in two terminals during development; run them as two
services in production.

## Quick start

```bash
cd backend
cp .env.example .env       # tweak SEPOLIA_RPC_URL and INDEXER_START_BLOCK if needed
npm install
npm run setup              # copies ABIs, generates Prisma client, migrates DB, seeds cards
npm run dev:indexer        # terminal 1 — catches up + polls live
npm run dev                # terminal 2 — Express on :4000
```

Smoke test:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/cards | jq '.cards | length'   # 40
curl http://localhost:4000/api/stats
```

## Endpoints

All read-only.

| Method | Endpoint                          | Returns                                |
|--------|-----------------------------------|----------------------------------------|
| GET    | `/api/cards`                      | All 40 cards with current supply       |
| GET    | `/api/cards/:cardId`              | Single card + last 50 mint history     |
| GET    | `/api/cards/rarity/:rarity`       | Cards filtered by rarity tier          |
| GET    | `/api/nfts?owner=0x...`           | NFTs owned by address                  |
| GET    | `/api/nfts/:tokenId`              | NFT + card + listing history           |
| GET    | `/api/listings`                   | Active listings (default status=active)|
| GET    | `/api/listings?rarity=Rare`       | Filtered by rarity                     |
| GET    | `/api/listings?seller=0x...`      | Filtered by seller                     |
| GET    | `/api/listings?status=sold`       | Sold / cancelled history               |
| GET    | `/api/listings/:tokenId`          | Active + history for a single token    |
| GET    | `/api/transactions?address=0x...` | Tx history for an address              |
| GET    | `/api/transactions?type=card_bought` | Filter by tx type                   |
| GET    | `/api/stats`                      | Totals: minted, listed, sold, claimed  |
| GET    | `/api/stats/rarity`               | Remaining supply per rarity tier       |
| GET    | `/api/health`                     | Indexer status + last synced block     |

## Indexer

`src/indexer.ts` listens for the following events and writes them into the
local DB. The events come from `contracts/deploy/addresses.json` by default.
If that generated file does not exist, set the contract address variables in
`backend/.env` instead. See `.env.example` for the supported names.

```
PokemonCardNFT.CardMinted          (informational, not used directly)
GachaPack.PackOpened               → 5× MintedNFT, bump Card.currentSupply, Transaction(pack_opened)
Marketplace.Listed                 → Listing(active), Transaction(card_listed)
Marketplace.Purchased              → Listing(sold), MintedNFT.owner ← buyer, Transaction(card_bought)
Marketplace.ListingCancelled       → Listing(cancelled), Transaction(card_cancelled)
PaymentSplitter.Claimed            → RoyaltyClaim
```

### Catch-up

On startup the indexer reads `IndexerState.lastBlock`. If it's 0 it falls back
to `INDEXER_START_BLOCK` from `.env` (the deploy block — `10964578` for the
current Sepolia deployment). It then scans forward in `INDEXER_BATCH_BLOCKS`
chunks until it reaches the chain tip. Each chunk's events are processed
idempotently (every `Transaction`/`RoyaltyClaim` row is keyed by
`@@unique([txHash, logIndex])`), so a restart during catch-up just resumes
from `lastBlock + 1` and re-processes the partial chunk safely.

### Rate-limit resilience

Public Sepolia RPCs vary in their `eth_getLogs` block-range limits. If a chunk
fails with a "block range" error, `queryWithBisect` recursively halves the
window until it fits. The default of 2 000 blocks per chunk works against the
configured `publicnode.com` RPC; Alchemy's free tier caps at 10, in which case
either set `INDEXER_BATCH_BLOCKS=10` or rely on the auto-bisect.

### Live mode

After catch-up the indexer switches to polling every
`INDEXER_POLL_INTERVAL_MS` (default 15 s). Set `SEPOLIA_RPC_WSS` to a
WebSocket URL to use real-time `eth_subscribe` instead.

## Frontend integration

The frontend's hybrid pattern (per `FULL_STACK_PLAN.md`):

- **Reads** hit this API for fast, indexed lookups.
- **Writes** go directly to the chain via ethers + MetaMask.
- After a successful write `tx.wait()`, the frontend polls the API for a few
  seconds until the indexer catches up and the new state is visible.
- If the API is unreachable, the frontend falls back to direct RPC reads
  (slower but always correct, since the chain is the source of truth).

## DB schema

See `prisma/schema.prisma`. Six models — `Card`, `MintedNFT`, `Listing`,
`Transaction`, `RoyaltyClaim`, `IndexerState`. SQLite for portability; the
schema is Postgres-compatible (only `tokenIds` is stored as JSON-string
instead of `Int[]` because SQLite lacks the array type).

## Files

```
backend/
├── prisma/
│   ├── schema.prisma          ← models + datasource
│   ├── migrations/            ← versioned migration history
│   └── dev.db                 ← local SQLite (gitignored)
├── abi/                       ← ABIs copied from contracts/artifacts
├── src/
│   ├── index.ts               ← Express server
│   ├── indexer.ts             ← Sepolia event listener
│   ├── routes/
│   │   ├── cards.ts
│   │   ├── nfts.ts
│   │   ├── listings.ts
│   │   ├── transactions.ts
│   │   ├── stats.ts
│   │   └── health.ts
│   └── lib/
│       ├── db.ts              ← shared PrismaClient
│       ├── addresses.ts       ← loads contracts/deploy/addresses.json
│       ├── abis.ts            ← loads backend/abi/*.json
│       ├── contracts.ts       ← ethers v6 Contract factories
│       ├── copy-abi.ts        ← copies ABIs after `hardhat compile`
│       └── seed.ts            ← seeds Card table from pokemon-cards.json
├── package.json
├── tsconfig.json
└── .env(.example)
```
