# Pokémon TCG Gacha NFT Marketplace

![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity&logoColor=white)
![OpenZeppelin](https://img.shields.io/badge/OpenZeppelin-5.6-4E5EE4?logo=openzeppelin&logoColor=white)
![Hardhat](https://img.shields.io/badge/Hardhat-2.28-F7DF1E?logoColor=black)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Network](https://img.shields.io/badge/Network-Sepolia-8247E5)

> Buy packs, pull cards, trade them on-chain — all royalties enforced automatically.

---

## Overview

This project is a fully on-chain Pokémon Trading Card Game collectible system built on the Ethereum Sepolia testnet. Users pay ETH to open card packs; a weighted gacha engine draws from a live card pool of 40 Gen-I Pokémon and mints ERC-721 NFTs directly to the buyer's wallet. Each card belongs to one of five rarity tiers — Common through Legendary — with strictly limited supply. As a tier sells out, the gacha naturally falls down to the next-lower rarity, making rare cards harder to obtain over time.

Cards can be listed and traded on the integrated Marketplace in atomic, single-transaction swaps. Every sale automatically distributes royalties to the card's creators via EIP-2981, routes platform fees, and credits seller proceeds — all through a pull-payment vault that recipients withdraw from individually, eliminating gas-griefing and reentrancy risk.

This is the blockchain capstone project for IT4527E at university. It demonstrates four advanced Ethereum engineering concepts: extended ERC-721 with multi-receiver EIP-2981 royalties, a claim-based payment splitter as a reentrancy defence, atomic NFT-for-ETH swaps, and a weighted on-chain gacha with inventory tracking.

---

## Architecture

```
                    ┌──────────────────────────────────────────────────┐
                    │                   User Wallet                    │
                    └──────┬──────────────────┬───────────┬────────────┘
                           │ commit/reveal    │ listCard  │ claim()
                           │ (ETH)            │ buyCard   │
                           ▼                  │           ▼
                    ┌─────────────┐           │  ┌─────────────────────┐
                    │  GachaPack  │           │  │   PaymentSplitter   │
                    │  (gacha     │           │  │   (pull-payment     │
                    │   engine)   │           │  │    vault, CEI)      │
                    └──────┬──────┘           │  └──────────▲──────────┘
          mintCard(cardId) │ deposit revenue  │             │ deposit
                           ▼                  │             │ (fees + royalties)
                    ┌─────────────────────┐   │  ┌──────────┴──────────┐
                    │  PokemonCardNFT     │◄──┘  │    Marketplace      │
                    │  ERC-721 + EIP-2981 │──────►  (atomic swap,      │
                    │  40-card pool       │ getRoyaltyReceivers         │
                    │  supply tracking    │      │   nonReentrant)      │
                    └─────────────────────┘      └─────────────────────┘
```

---

## Card Pool & Rarity Table

| Tier | Gacha Rate | Cards in Pool | Supply / Card | Floor Price |
|---|---|---|---|---|
| Common | 60 % | 12 | 600 – 1,000 | 0.0005 – 0.002 ETH |
| Uncommon | 25 % | 9 | 250 – 350 | 0.006 – 0.01 ETH |
| Rare | 10 % | 8 | 60 – 80 | 0.03 – 0.04 ETH |
| Ultra Rare | 4 % | 6 | 20 – 30 | 0.08 – 0.12 ETH |
| Legendary | 1 % | 5 | 3 – 8 | 0.3 – 0.8 ETH |

**Falldown rule:** when a rolled tier has zero remaining supply, the gacha gives the next-lower tier instead. Legendary → Ultra Rare → Rare → Uncommon → Common. If all tiers are sold out, `revealPack()` reverts with `AllCardsSoldOut`.

---

## How the Gacha Works

A pack opens in **two transactions** (commit-reveal) so the draw is unknowable when you pay — see [`docs/gacha-algorithm.md`](docs/gacha-algorithm.md).

1. **Commit & pay** — user sends exactly `packPrice` ETH to `GachaPack.commitPack()`, which records the commit block and routes the revenue to the splitter immediately.
2. **Reveal** — in a later block, `GachaPack.revealPack()` seeds the draw from `keccak256(blockhash(commitBlock), buyer)` — a value that did not exist at commit time, so the outcome can't be simulated and reverted.
3. **Roll rarity** — for each of 5 cards, a per-card `keccak256(seed, i)` hash is taken mod 100 and mapped against the cumulative weight table `[60, 85, 95, 99, 100]`.
4. **Check inventory** — `PokemonCardNFT.getAvailableCardIds(rarity)` returns pool cardIds with `currentSupply < maxSupply`.
5. **Falldown** — if the rolled tier is sold out, try the next-lower tier. Repeat until stock is found or all tiers exhausted.
6. **Pick card** — select a random cardId from available cards using `pickSeed % available.length`.
7. **Mint** — `nft.mintCard(buyer, cardId)` reads the template, increments `currentSupply`, and mints the ERC-721 token.
8. **Reveal event** — `PackOpened(buyer, tokenIds, cardIds, rarities)` triggers the frontend card-flip animation.

> **VRF upgrade path:** `_random()` is an isolated internal function. Replace its body with a Chainlink VRF callback and nothing else changes.

---

## How Royalties Work

Every card minted from the pool carries a royalty split stored on-chain per token.

**On secondary sale:**
1. Buyer calls `Marketplace.buyCard(tokenId)` with exact ETH.
2. Marketplace calls `nft.getRoyaltyReceivers(tokenId)` — returns an array of `{receiver, feeBps}`.
3. Each royalty share is computed: `amount = salePrice × feeBps / 10_000`.
4. Seller proceeds = `salePrice − platformFee − Σ royaltyAmounts`.
5. All amounts deposited to `PaymentSplitter` in one call — no ETH is pushed directly.
6. Each recipient calls `PaymentSplitter.claim()` to withdraw their balance.

**Worked example — 1 ETH sale:**

| Recipient | Rate | Amount |
|---|---|---|
| Platform fee (Marketplace) | 2.5 % | 0.025 ETH |
| Platform royalty (card creator) | 5 % | 0.050 ETH |
| Artist royalty (card artist) | 3 % | 0.030 ETH |
| **Seller proceeds** | **89.5 %** | **0.895 ETH** |
| **Total** | **100 %** | **1.000 ETH** |

The invariant `platformFee + Σ royaltyAmts + sellerProceeds ≡ salePrice` is proven by 1,000-run Foundry fuzz tests — zero wei is created or destroyed.

---

## Security Features

| Concern | Mitigation |
|---|---|
| **Reentrancy on claim** | CEI pattern (balance zeroed before `.call`) + `ReentrancyGuard` |
| **Reentrancy on buyCard** | Listing deleted before external calls (CEI) + `nonReentrant` |
| **Out-of-gas on distribution** | Pull-payment: `deposit()` writes to a mapping (no ETH loops); each recipient `claim()`s independently |
| **Atomicity on swap** | NFT `safeTransferFrom` is the last external call; EVM rollback undoes the splitter deposit if it reverts |
| **Access control** | `MINTER_ROLE` (GachaPack only), `DEPOSITOR_ROLE` (GachaPack + Marketplace only) via OpenZeppelin AccessControl |
| **Royalty cap** | `MAX_ROYALTY_BPS = 1000` (10 %) enforced on every `mintCard` call |
| **Integer overflow** | Solidity 0.8 checked arithmetic; `unchecked` used only where overflow is structurally impossible |
| **Custom errors** | All reverts use `error Foo(...)` instead of `require` strings — lower gas, richer revert data |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart contracts | Solidity 0.8.24, OpenZeppelin Contracts 5.6 |
| Compilation / testing | Hardhat 2.28 (Mocha/Chai), Foundry 1.7 (fuzz + invariant) |
| Frontend | Vite 8, React 19, TypeScript, Tailwind CSS 3, ethers.js v6 |
| Backend | Express, Prisma + SQLite, ethers v6 (event indexer + read-only API) |
| Network | Ethereum Sepolia testnet |
| NFT standard | ERC-721 (OpenZeppelin), EIP-2981 royalty standard |

> **Why a backend?** All writes go straight to the chain from the browser wallet. The backend is a read replica: an **indexer** subscribes to contract events and writes them into SQLite, and a small **API** serves that data to the UI fast. If the API is down, the frontend falls back to reading directly from the chain — so the app still works without it.

---

## Getting Started

The project has three workspaces, each with its own `package.json` and `.env`:
`contracts/` (Hardhat + Foundry), `backend/` (indexer + API), `frontend/` (Vite app).

### Prerequisites

- Node.js 18+ and npm
- A Sepolia RPC URL (Alchemy / Infura / public node) and a funded test wallet
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (only if you want to run the fuzz/invariant tests)

### 1. Clone & install

```bash
git clone <repo-url> && cd TCG

cd contracts && npm install && cd ..
cd backend   && npm install && cd ..
cd frontend  && npm install && cd ..
```

### 2. Environment files

```bash
# Root — used by Hardhat (contracts): SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY
cp .env.example .env

# Backend — RPC URL, DB path, indexer + API settings
cp backend/.env.example backend/.env

# Frontend — deployed contract addresses + API base URL
cp frontend/.env.example frontend/.env
```

The contracts are **already deployed to Sepolia** and `frontend/.env` ships with the live
addresses, so you can run the app against the existing deployment without redeploying.
If you deploy your own (see below), `scripts/deploy.ts` rewrites `frontend/.env` and
`contracts/deploy/addresses.json` for you.

### 3. (Optional) Compile & test the contracts

```bash
cd contracts
npm run compile        # hardhat compile
npm run test           # Hardhat unit + integration (Mocha/Chai)
npm run test:fuzz      # Foundry fuzz + invariant (needs Foundry installed)
npm run coverage       # coverage report
npm run gas            # gas report (REPORT_GAS=true)
```

---

## Run the app

The app runs as **three processes** (the backend is split into an API and an indexer).
Start them in three terminals.

```bash
# ── Terminal 1 · Backend setup (run ONCE), then the API ──────────────────
cd backend
npm run setup          # copy ABIs + prisma generate + migrate + seed the 40-card DB
npm run dev            # API on http://localhost:4000  (hot-reload)

# ── Terminal 2 · Event indexer (backfills + follows Sepolia) ─────────────
cd backend
npm run dev:indexer    # writes on-chain events into SQLite

# ── Terminal 3 · Frontend ────────────────────────────────────────────────
cd frontend
npm run dev            # app on http://localhost:5173
```

Open **http://localhost:5173**, connect a wallet (MetaMask / Rabby / OKX — a picker
appears when more than one is installed), make sure it's on **Sepolia**, and open a pack.

> `npm run setup` is only needed the first time (or after pulling new contract ABIs /
> Prisma schema changes). On later runs just `npm run dev` + `npm run dev:indexer`.
> Other useful backend scripts: `npm run seed` (re-seed the card table from
> `pokemon-cards.json`), `npm run copy-abi` (refresh ABIs from `contracts/artifacts`),
> `npm run prisma:studio` (browse the DB).

### Local-only chain (optional)

To run everything against a local Hardhat node instead of Sepolia:

```bash
cd contracts
npx hardhat node                                          # Terminal A
npx hardhat run scripts/deploy.ts --network localhost     # Terminal B (writes addresses)
# then point backend/.env + frontend/.env at chainId 31337 and the local addresses
```

---

## Deploy to Sepolia

```bash
# Ensure root .env has SEPOLIA_RPC_URL and PRIVATE_KEY (funded with Sepolia ETH)
cd contracts

npm run deploy:sepolia   # deploy all 4 contracts + wire permissions + seed pool
npm run verify:sepolia   # verify on Etherscan (requires ETHERSCAN_API_KEY)
```

Deploy order: `PokemonCardNFT` → `PaymentSplitter` → `GachaPack` → `Marketplace`, then:
- Grant `MINTER_ROLE` to GachaPack on NFT
- Grant `DEPOSITOR_ROLE` to GachaPack and Marketplace on PaymentSplitter
- Call `nft.batchAddCards(...)` to seed all 40 cards from `data/pokemon-cards.json`

The script writes the new addresses to `contracts/deploy/addresses.json` **and** updates
`frontend/.env`. After deploying, point `backend/.env` at the new addresses (or its
`DEPLOY_BLOCK`) and re-run `npm run setup` so the indexer starts from the right block.

### Adding a card after deploy

Card templates are write-once on-chain. To add one without redeploying:

- **In the app** — connect the deployer wallet; an **"Add Card"** tab appears (gated on
  `POOL_MANAGER_ROLE`). Fill the form; the indexer picks up `CardAddedToPool` and the card
  shows in Collection within a poll.
- **From the CLI** — append it to `contracts/data/pokemon-cards.json`, then
  `cd contracts && npx hardhat run scripts/add-card.ts --network sepolia`
  (adds any card in the JSON not already in the pool).

---

## Project Structure

```
TCG/
├── .env.example                    # Root secrets template (Hardhat)
├── .gitignore
├── BUILD_LOG.md                    # Phase-by-phase build log
├── README.md
├── contracts/
│   ├── data/
│   │   └── pokemon-cards.json      # 40 Gen-I card templates (supply, rarity, imageURI)
│   ├── src/
│   │   ├── PokemonCardNFT.sol      # ERC-721 + EIP-2981, on-chain card pool
│   │   ├── GachaPack.sol           # Gacha engine — commit-reveal draw, inventory falldown
│   │   ├── Marketplace.sol         # Atomic swap, royalty routing, price hints
│   │   ├── PaymentSplitter.sol     # Pull-payment vault (CEI + ReentrancyGuard)
│   │   └── test/                   # ReentrancyAttacker, MarketplaceAttacker helpers
│   ├── test/
│   │   ├── hardhat/                # Integration tests (Mocha/Chai + ethers v6)
│   │   └── foundry/                # Fuzz, invariant, statistical tests
│   ├── scripts/
│   │   ├── deploy.ts               # Full deploy + role wiring + pool seeding
│   │   ├── verify.ts               # Etherscan verification
│   │   ├── add-card.ts             # Add new card template(s) to the live pool
│   │   ├── check-balance.ts        # Deployer balance helper
│   │   └── smoke-test.ts           # Post-deploy sanity checks
│   ├── deploy/addresses.json       # Written by deploy.ts (frontend/backend read this)
│   ├── hardhat.config.ts           # Solidity 0.8.24, optimizer 200, EVM cancun
│   ├── foundry.toml                # Shares src/ with Hardhat, 1000 fuzz runs
│   └── package.json
├── backend/                        # Event indexer + read-only API
│   ├── prisma/schema.prisma        # SQLite schema (Card, MintedNFT, Listing, …)
│   ├── abi/                        # ABIs copied from contracts/artifacts (copy-abi)
│   ├── src/
│   │   ├── index.ts                # Express API (all GET endpoints)
│   │   ├── indexer.ts              # Sepolia event indexer → SQLite
│   │   ├── routes/                 # cards, nfts, listings, transactions, stats, health
│   │   └── lib/                    # db, contracts, abis, addresses, seed, copy-abi
│   └── package.json
└── frontend/
    ├── src/
    │   ├── pages/                  # Home, Gacha, Collection, Inventory, Marketplace,
    │   │                           #   RoyaltyDashboard, AdminAddCard (deployer-only)
    │   ├── components/             # CreatureCard, CardModal, WalletPicker, TxToast, ui/
    │   ├── hooks/useWallet.ts      # EIP-6963 multi-wallet connect + chain guard
    │   ├── lib/                    # api client, eip6963, tokens, types, formatters
    │   └── config/contracts.ts     # Typed ABIs + addresses (from VITE_* env)
    ├── tailwind.config.js
    ├── vite.config.ts
    └── package.json
```

---

## Team

| Member | Role | Owns | Key deliverables |
|---|---|---|---|
| **Hieu** | NFT & Gacha Contracts | `PokemonCardNFT.sol`, `GachaPack.sol` | ERC-721 + multi-receiver EIP-2981 royalties, on-chain card pool & supply tracking, commit-reveal weighted gacha with falldown, Foundry statistical/gacha tests |
| **Thanh** | Marketplace & Payments / Security | `Marketplace.sol`, `PaymentSplitter.sol` | Atomic NFT-for-ETH swap, royalty + platform-fee routing, pull-payment vault (CEI + ReentrancyGuard), reentrancy & value-conservation fuzz/invariant tests, security audit |
| **Hung** | Backend & DevOps | `backend/`, `contracts/scripts/` | Express read API + Prisma/SQLite, Sepolia event indexer (incl. `CardAddedToPool`), deploy / verify / `add-card` scripts, Hardhat + Foundry test wiring, README & setup docs |
| **Nam** | Frontend | `frontend/` | Vite/React app, EIP-6963 multi-wallet connect (MetaMask/Rabby/OKX), gacha reveal animation, Marketplace / Inventory / Royalty pages, deployer-only Add-Card admin page |

**Shared / cross-cutting:** deploy order & role wiring (Hieu ↔ Thanh ↔ Hung), ABI sync between contracts → backend → frontend (Hung ↔ Nam), and the end-to-end integration test — open pack → list → buy → claim — is co-owned by all four.

---

## License

MIT © 2026
