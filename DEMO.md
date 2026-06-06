# Live Demo Script — Pokémon TCG Gacha NFT Marketplace

> Target: complete this flow on Sepolia in **under 3 minutes**.
> Requires: two MetaMask wallets (Wallet A = seller, Wallet B = buyer), both funded with Sepolia ETH.

---

## Pre-flight (do before the presentation)

1. Deploy contracts and verify: `npm run deploy:sepolia && npm run verify:sepolia`
2. Start frontend: `cd frontend && npm run dev`
3. Confirm `frontend/src/config/contracts.ts` contains the Sepolia addresses from `deploy/addresses.json`
4. Fund Wallet A with ≥ 0.1 ETH (Sepolia). Fund Wallet B with ≥ 1.1 ETH.
5. Open two browser windows — one for Wallet A, one for Wallet B.
6. Open the Etherscan Sepolia explorer in a third window.

---

## Click-by-click Demo (≤ 3 minutes)

### Step 1 — Connect Wallet A (30 s)

1. Browser 1: Navigate to `http://localhost:5173`
2. Click **🔌 Connect** tab → **Connect MetaMask**
3. Approve in MetaMask popup
4. Confirm "✓ Connected to Sepolia" appears with Wallet A address

### Step 2 — Open a Pack · Wallet A (45 s)

1. Click **⚡ Gacha** tab
2. Click **⚡ Open Pack** (cost: 0.01 ETH)
3. Approve the MetaMask transaction
4. *While pending:* show the Etherscan explorer tab — paste the tx hash and watch it confirm
5. *On confirm:* five card backs appear with a yellow glow pulse
6. Click each card to flip — watch the 3D flip animation reveal the Pokémon
7. Point out the rarity label on each card (Common / Uncommon / Rare / etc.)

### Step 3 — List a Card · Wallet A (30 s)

1. Click **🏪 Marketplace** tab
2. In **"List Your Card"** section:
   - Token ID: `0`
   - Price: `1` (ETH)
3. Click **List** → MetaMask shows two transactions (approve + listCard)
4. Confirm both
5. Click **Browse Listings** — the card appears with its image, rarity, and floor price hint

### Step 4 — Buy the Card · Wallet B (30 s)

1. Browser 2: Open `http://localhost:5173`, connect **Wallet B**, switch to Sepolia
2. Click **🏪 Marketplace** tab → **Browse Listings**
3. Find Wallet A's listing → click **Buy** (1 ETH)
4. Approve in MetaMask
5. Show confirmation: card disappears from listings

### Step 5 — Check Royalties · Both Wallets (30 s)

1. **Wallet A** (seller) → **💰 Royalties** tab → **Refresh Balance**
   - Shows claimable ≈ 0.895 ETH (89.5% seller proceeds)
   - Click **Claim ETH** → approve tx → balance goes to 0
2. **Wallet B** (card creator / platform) → **💰 Royalties** tab → **Refresh Balance**
   - Shows claimable ≈ 0.083 ETH (platform fee + royalties)
   - Click **Claim ETH** → approve tx

### Step 6 — Show Etherscan (15 s)

Navigate to one of the verified contract addresses on Etherscan Sepolia:
- PokemonCardNFT → Source tab → confirm ERC-721 + EIP-2981 interfaces
- PaymentSplitter → Read Contract → `claimable(wallet_b_address)` = 0 (just claimed)

---

## Talking Points (for each step)

**Pack opening:**
> "Each pack costs 0.01 ETH and opens in two transactions — a commit-reveal scheme. You pay in `commitPack`; a block later `revealPack` rolls the rarity from the hash of your commit block, which didn't exist when you paid — so nobody can simulate the draw and only buy on a Legendary. Weights run 60% Common through 1% Legendary, drawn from a live on-chain pool of 40 Gen-I cards with strict supply limits: Mewtwo has only 5 copies ever."

**Listing:**
> "The seller approves the Marketplace contract as an operator, then lists at any price. The marketplace reads the card's template floor price to suggest a starting point."

**Buying:**
> "The entire sale is atomic — EIP-2981 royalty distribution, platform fee, seller proceeds, and the NFT transfer all happen in one transaction. If the NFT transfer fails, every credit in the payment splitter rolls back. There's no way for money and card to get out of sync."

**Claiming:**
> "Royalties accumulate in a pull-payment vault — no ETH is ever pushed. The seller and each royalty receiver call claim() independently. This eliminates gas-griefing and reentrancy risk from multi-recipient ETH pushes."

---

## Fallback: if Sepolia is congested

The same flow works on a local Hardhat node:
```bash
# Terminal 1
cd contracts && npx hardhat node

# Terminal 2
npx hardhat run scripts/deploy.ts --network localhost

# Terminal 3
cd ../frontend && npm run dev
# MetaMask → Add Network → localhost:8545, chainId 31337
# Import Hardhat test account #0 with private key (from node output)
```
