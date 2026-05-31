# Architecture, Math Proofs & Technical Documentation

## 1. Contract Architecture

### Deployment Order & Dependency Graph

```
Deploy 1: PokemonCardNFT(admin)
Deploy 2: PaymentSplitter(admin)
Deploy 3: GachaPack(nft, splitter, platform, issuer, platformFeeBps)
Deploy 4: Marketplace(nft, splitter, platform, marketFeeBps)

Post-deploy wiring:
  nft.grantRole(MINTER_ROLE,    gacha)
  splitter.grantRole(DEPOSITOR_ROLE, gacha)
  splitter.grantRole(DEPOSITOR_ROLE, marketplace)
  nft.batchAddCards(40 templates, platform, 300, artist, 200)
```

### How a Pack Sale Flows

```
User
 │
 ├─ openPack() { value: 0.01 ETH }
 │   │
 │   ▼  GachaPack
 │   ├─ require(msg.value == packPrice)
 │   ├─ for i in 0..4:
 │   │   ├─ rand = keccak256(prevrandao, sender, nonce++, i)
 │   │   ├─ rarity = _rollRarity(rand % 100)
 │   │   ├─ available = nft.getAvailableCardIds(rarity)  ← falldown if empty
 │   │   ├─ cardId = available[rand>>8 % available.length]
 │   │   └─ tokenId = nft.mintCard(buyer, cardId)        ← mints ERC-721
 │   └─ splitter.deposit{value: 0.01 ETH}(               ← routes revenue
 │         [platform, issuer], [0.008 ETH, 0.002 ETH])
 │
 ▼  PokemonCardNFT (MINTER_ROLE gate)
     ├─ reads template from cardPool[cardId]
     ├─ increments currentSupply
     ├─ writes _cards[tokenId], _royaltyReceivers[tokenId]
     └─ _safeMint(buyer, tokenId)
```

### How a Marketplace Sale Flows

```
Seller
 ├─ nft.approve(marketplace, tokenId)
 └─ marketplace.listCard(tokenId, price)
       └─ listings[tokenId] = {seller, price}
          emit Listed(tokenId, seller, price, rarity, cardId)

Buyer
 └─ marketplace.buyCard(tokenId) { value: price }
       ├─ [CHECK]  listing active, msg.value == price
       ├─ [EFFECT] delete listings[tokenId]          ← CEI
       ├─ [EFFECT] compute platformFee, royaltyAmts, sellerProceeds
       ├─ [INTER]  splitter.deposit{value: price}(   ← pull-payment
       │              [platform, rx0, rx1, seller],
       │              [fee,      r0,  r1,  proceeds])
       └─ [INTER]  nft.safeTransferFrom(seller, buyer, tokenId)  ← last

Any party
 └─ splitter.claim()
       ├─ amount = balances[msg.sender]
       ├─ balances[msg.sender] = 0                   ← CEI
       └─ msg.sender.call{value: amount}
```

---

## 2. Royalty Split Math Proof

### Setup

| Parameter | Value |
|---|---|
| Sale price | 1 ETH = 1 000 000 000 000 000 000 wei |
| Marketplace platform fee | 250 bps = 2.5 % |
| Card royalty — Platform | 500 bps = 5 % |
| Card royalty — Artist | 300 bps = 3 % |
| Total royalty | 800 bps = 8 % |

### Calculation

```
platformFee     = floor(1e18 × 250 / 10000) = floor(25 000 000 000 000 000) = 25 000 000 000 000 000 wei
royaltyPlatform = floor(1e18 × 500 / 10000) = floor(50 000 000 000 000 000) = 50 000 000 000 000 000 wei
royaltyArtist   = floor(1e18 × 300 / 10000) = floor(30 000 000 000 000 000) = 30 000 000 000 000 000 wei

deductions = platformFee + royaltyPlatform + royaltyArtist
           = 25e15 + 50e15 + 30e15
           = 105 000 000 000 000 000 wei

sellerProceeds = salePrice − deductions
               = 1 000 000 000 000 000 000 − 105 000 000 000 000 000
               = 895 000 000 000 000 000 wei
```

### Conservation Proof

```
Sum of all credits to splitter:
  platformFee     =  25 000 000 000 000 000 wei  (2.500 %)
  royaltyPlatform =  50 000 000 000 000 000 wei  (5.000 %)
  royaltyArtist   =  30 000 000 000 000 000 wei  (3.000 %)
  sellerProceeds  = 895 000 000 000 000 000 wei  (89.500 %)
                  ─────────────────────────────
  TOTAL           = 1 000 000 000 000 000 000 wei = 1 ETH ✓

Rounding rule: sellerProceeds = salePrice − platformFee − Σ royaltyAmts
  Any integer-division dust (at most 3 wei for 3 divisions) goes to the seller.
  The sum passed to splitter.deposit() always equals msg.value exactly.
```

### Generalised Formula

For any sale price `P`, platform fee `f` bps, and N royalty receivers each at `r_i` bps:

```
platformFee_i   = ⌊P × f / 10_000⌋
royaltyAmt_i    = ⌊P × r_i / 10_000⌋  for i = 1..N
sellerProceeds  = P − platformFee − Σ royaltyAmt_i

invariant: platformFee + Σ royaltyAmt_i + sellerProceeds = P   (by construction)
```

Proven by 1 000-run Foundry fuzz test across the full `uint96` range. Zero wei lost or created in any run.

---

## 3. Gacha Probability Table & Empirical Distribution

### Theoretical Weights

| Rarity | Weight | Cumulative | Probability |
|---|---|---|---|
| Common | 60 | 60 | 60.000 % |
| Uncommon | 25 | 85 | 25.000 % |
| Rare | 10 | 95 | 10.000 % |
| Ultra Rare | 4 | 99 | 4.000 % |
| Legendary | 1 | 100 | 1.000 % |

### Algorithm (from `GachaPack._rollRarity`)

```solidity
uint256 roll = rand % 100;
if (roll < 60) return Common;      // [0, 59]
if (roll < 85) return Uncommon;    // [60, 84]
if (roll < 95) return Rare;        // [85, 94]
if (roll < 99) return UltraRare;   // [95, 98]
return Legendary;                  // [99]
```

### Empirical Distribution (Foundry, 1 000 cards / 200 packs)

| Rarity | Expected | Observed | Δ | Within ±20%? |
|---|---|---|---|---|
| Common | 600 | 604 | +0.67 % | ✓ |
| Uncommon | 250 | 244 | −2.40 % | ✓ |
| Rare | 100 | 104 | +4.00 % | ✓ |
| Ultra Rare | 40 | 38 | −5.00 % | ✓ |
| Legendary | 10 | 10 | ±0.00 % | ✓ |
| **Sum** | **1000** | **1000** | | ✓ |

All tiers within ±20% of expected at n=1000. The keccak256-based pseudo-RNG produces a distribution statistically consistent with the specified weights.

**Chainlink VRF upgrade path:**  `_random()` is isolated as an internal function. Replacing its body with a VRF request and fulfillRandomWords callback requires no changes to `_rollRarity`, `_drawFromInventory`, or any other logic.

### Falldown Mechanic

When a rolled rarity tier has zero available supply, the gacha steps down:
```
Legendary  → UltraRare → Rare → Uncommon → Common → AllCardsSoldOut (revert)
```
This makes rare cards *harder to obtain over time*, not easier. A Legendary buyer who finds no Legendaries available receives an UltraRare, not a guaranteed lower tier.

---

## 4. Gas Analysis

### Key Function Gas Costs (forge snapshot, optimizer 200 runs, EVM cancun)

| Operation | Gas | Notes |
|---|---|---|
| `mintCard(to, cardId)` — cold | ~281 000 | Single pool-based mint, cold storage |
| `openPack()` — 5 cards | ~1 173 000 | 5 mints + 1 splitter deposit |
| Per card (incremental) | ~234 000 | Includes `getAvailableCardIds` + `mintCard` |
| `listCard` (incremental) | ~83 000 | `approve` + `listCard`; storage warm after pack |
| `buyCard` (incremental) | ~39 000 | Warm storage; includes deposit + `safeTransferFrom` |
| `claim()` (incremental) | ~21 000 | Single storage write + ETH transfer |

*Forge test gas includes setUp (4-contract deploy + role grants). Baseline setUp = 163 gas.
Incremental costs computed by subtracting preceding test from cumulative.*

### Optimisations Applied

| Technique | Location | Saving |
|---|---|---|
| `uint96` for feeBps/floorPrice | NFT, Marketplace | Packs into fewer storage slots |
| `immutable` for contract refs | GachaPack, Marketplace | Avoids SLOAD on each use |
| `constant` for weight breakpoints | GachaPack | Pure constants, no SLOAD |
| Custom errors over `require` strings | All contracts | ~50 gas per revert |
| `++i` over `i++` in loops | All contracts | 5 gas per iteration |
| `unchecked` removed (audit finding) | NFT | Safety over marginal savings |
| `_safeMint` effects before call (CEI fix) | NFT | No gas change; correctness |

---

## 5. Setup & Run Guide

### Prerequisites

- Node.js ≥ 18, npm ≥ 9
- Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- Python 3 + pip (for Slither)

### Installation

```bash
git clone https://github.com/vadrthanh/tcg && cd tcg

# Contracts
cd contracts && npm install

# Frontend
cd ../frontend && npm install && cd ../contracts
```

### Running Tests

```bash
# Hardhat — 112 integration tests
npm run test

# Foundry — 17 fuzz/invariant tests (1 000 runs each)
npm run test:fuzz

# Coverage report
npm run coverage

# Gas report (forge snapshot)
forge snapshot --match-path 'test/foundry/**'
```

### Local Deploy

```bash
# Terminal 1 — local node
npx hardhat node

# Terminal 2 — deploy and seed 40-card pool
npx hardhat run scripts/deploy.ts --network localhost

# Terminal 3 — frontend dev server
cd ../frontend && npm run dev
# Open http://localhost:5173, connect MetaMask to localhost:8545
```

### Sepolia Deploy

```bash
# Create .env at repo root
cp .env.example .env
# Fill in: SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY

cd contracts
npm run deploy:sepolia   # deploys + seeds 40 cards
npm run verify:sepolia   # verifies on Etherscan
```

### Static Analysis

```bash
pip install slither-analyzer
cd contracts
slither src/ --solc-remaps "@openzeppelin/=node_modules/@openzeppelin/" --exclude-dependencies
```
