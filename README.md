# Pokémon TCG Gacha NFT Marketplace

![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity&logoColor=white)
![OpenZeppelin](https://img.shields.io/badge/OpenZeppelin-5.6-4E5EE4?logo=openzeppelin&logoColor=white)
![Hardhat](https://img.shields.io/badge/Hardhat-2.28-F7DF1E?logoColor=black)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
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
                           │ openPack (ETH)   │ listCard  │ claim()
                           ▼                  │ buyCard   ▼
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
| Frontend | Vite 6, React 18, TypeScript, Tailwind CSS 3, ethers.js v6 |
| Network | Ethereum Sepolia testnet |
| NFT standard | ERC-721 (OpenZeppelin), EIP-2981 royalty standard |

---

## Quick Start

```bash
# 1. Clone the repo
git clone <repo-url> && cd TCG

# 2. Install contract dependencies
cd contracts && npm install

# 3. Install frontend dependencies
cd ../frontend && npm install && cd ../contracts

# 4. Create environment file
cp ../.env.example ../.env
# Fill in SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY

# 5. Compile contracts
npm run compile

# 6. Run Hardhat tests (112 tests)
npm run test

# 7. Run Foundry fuzz + invariant tests (17 tests, 1000 runs each)
npm run test:fuzz

# 8. Coverage report
npm run coverage

# 9. Gas report
npm run gas

# 10. Run local Hardhat node (separate terminal)
npx hardhat node

# 11. Deploy to local node
npx hardhat run scripts/deploy.ts --network localhost

# 12. Start frontend dev server
cd ../frontend && npm run dev
```

---

## Deploy to Sepolia

```bash
# Ensure .env has SEPOLIA_RPC_URL and PRIVATE_KEY (funded with Sepolia ETH)
cd contracts

# Deploy all 4 contracts and wire permissions
npm run deploy:sepolia

# Verify on Etherscan (requires ETHERSCAN_API_KEY)
npm run verify:sepolia
```

Deploy order: `PokemonCardNFT` → `PaymentSplitter` → `GachaPack` → `Marketplace`, then:
- Grant `MINTER_ROLE` to GachaPack on NFT
- Grant `DEPOSITOR_ROLE` to GachaPack and Marketplace on PaymentSplitter
- Call `nft.batchAddCards(...)` to seed all 40 cards from `data/pokemon-cards.json`

Deployed addresses are saved to `contracts/deploy/addresses.json` which the frontend reads automatically.

---

## Project Structure

```
TCG/
├── .env.example                    # Required secrets template
├── .gitignore
├── BUILD_LOG.md                    # Phase-by-phase build log
├── README.md
├── contracts/
│   ├── data/
│   │   └── pokemon-cards.json      # 40 Gen-I card templates (supply, rarity, imageURI)
│   ├── src/
│   │   ├── PokemonCardNFT.sol      # ERC-721 + EIP-2981, 40-card on-chain pool
│   │   ├── GachaPack.sol           # Gacha engine — weighted draw, inventory falldown
│   │   ├── Marketplace.sol         # Atomic swap, royalty routing, price hints
│   │   ├── PaymentSplitter.sol     # Pull-payment vault (CEI + ReentrancyGuard)
│   │   └── test/                   # ReentrancyAttacker, MarketplaceAttacker helpers
│   ├── test/
│   │   ├── hardhat/                # Integration tests (Mocha/Chai + ethers v6)
│   │   └── foundry/                # Fuzz, invariant, statistical tests
│   ├── scripts/
│   │   ├── deploy.ts               # Full deploy + role wiring + pool seeding
│   │   └── verify.ts               # Etherscan verification
│   ├── gas-report.txt              # forge snapshot output
│   ├── hardhat.config.ts           # Solidity 0.8.24, optimizer 200, EVM cancun
│   ├── foundry.toml                # Shares src/ with Hardhat, 1000 fuzz runs
│   └── package.json
└── frontend/
    ├── src/
    │   ├── pages/                  # Connect, Gacha, Inventory, Marketplace, Royalty
    │   ├── components/             # CardFlip, Toast, WalletButton
    │   └── config/                 # Typed ABIs + deployed addresses
    ├── tailwind.config.js
    ├── vite.config.ts
    └── package.json
```

---

## Team

| Member | Role | Deliverables |
|---|---|---|
| Person 1 | Smart Contract Lead | PokemonCardNFT.sol, EIP-2981 design, card pool system |
| Person 2 | DeFi / Security | PaymentSplitter.sol, Marketplace.sol, reentrancy audits |
| Person 3 | Gacha Engine | GachaPack.sol, randomness design, statistical tests (Foundry) |
| Person 4 | Frontend | Vite/React app, MetaMask integration, card-flip animation |
| Person 5 | DevOps / Docs | Hardhat scripts, Sepolia deploy, Etherscan verify, README |

---

## License

MIT © 2026
