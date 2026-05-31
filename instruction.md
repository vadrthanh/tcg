# Claude Code Build Prompt — Pokémon TCG Gacha NFT Marketplace

> Copy everything below the line into Claude Code as your opening message.
> It is written so Claude Code builds in phases, stops at each gate for you to
> verify, and never skips testing or auditing.

---

## ROLE & CONTEXT

You are building a **Pokémon Trading Card Game Gacha NFT Marketplace** on the
**Ethereum Sepolia testnet** for a university Blockchain capstone project
(IT4527E). This is graded work. The project must satisfy these academic
requirements:

- **Advanced ERC-721**: extend the standard NFT contract to support **EIP-2981**
  (royalty standard) with a **custom multi-receiver array** (revenue splits to
  multiple stakeholders).
- **Payment Splitter**: implement a **pull-payment** (claim-based) pattern so the
  contract is secure against **reentrancy** and **out-of-gas** errors when
  distributing funds to many creators.
- **Atomic Swaps**: the transfer of the NFT and the distribution of funds
  (including royalties) must occur in a **single atomic transaction**.
- **Gacha mechanic**: users pay ETH to open a card pack; randomness determines
  which cards (by rarity) they receive.

I want to grade well on: flawless contract logic, custom algorithmic modeling
(weighted gacha + royalty split math), robust security (reentrancy guards, gas
optimization), high-quality documentation (diagrams + math proofs), and a
polished live demo.

## TECH STACK (pin these versions)

- Solidity `0.8.24`
- OpenZeppelin Contracts `^5.0.0`
- Hardhat (latest) — compilation, deployment, integration tests
- Foundry (`forge`) — fuzz tests and invariant tests
- ethers.js `v6`
- Frontend: Vite + React 18 + TypeScript + Tailwind CSS
- Network: Sepolia (RPC via Alchemy or Infura — read URL + private key from
  `.env`, never hardcode)

## CONTRACTS TO BUILD

1. `PokemonCardNFT.sol` — ERC-721 + EIP-2981, multi-receiver royalties, card
   metadata (name, rarity, type, HP, imageURI), mint-gated to the gacha contract.
2. `GachaPack.sol` — pack purchase in ETH, weighted on-chain randomness, mints
   5 cards per pull, routes pack revenue to the splitter.
3. `Marketplace.sol` — list / buy with **atomic** NFT-for-ETH swap, reentrancy
   guarded, queries EIP-2981 on every sale and routes royalties.
4. `PaymentSplitter.sol` — claim-based vault, per-recipient balance mapping,
   `claim()` withdraws, no push payments.

Rarity table: Common 60%, Uncommon 25%, Rare 10%, Ultra Rare 4%, Legendary 1%.

---

## CRITICAL WORKING RULES — READ FIRST

1. **Build in the phases below, in order. STOP at each `// GATE //` and wait for
   me to confirm before continuing.** Do not build the whole project in one go.
2. **No phase is "done" until its tests pass.** Run the tests, paste the output,
   then stop at the gate.
3. **Security is not a final step — it is enforced per contract.** Every payable
   or state-changing function uses Checks-Effects-Interactions (CEI) and a
   `nonReentrant` guard where funds move.
4. Never commit secrets. `.env` is gitignored; provide a `.env.example`.
5. Prefer custom errors over `require` strings (gas). Use `immutable`/`constant`
   where possible. Emit events on every state change.
6. Use OpenZeppelin audited components (`ERC721`, `ERC2981`, `ReentrancyGuard`,
   `Ownable`, `AccessControl`) rather than rolling your own.
7. After each phase, give me: (a) what you built, (b) test results, (c) any
   design decisions worth noting for the report.

---

## PHASE 0 — Project Scaffolding

- Initialize a monorepo: `/contracts` (Hardhat + Foundry), `/frontend` (Vite).
- Set up Hardhat with the toolbox, `hardhat-foundry`, and `hardhat-verify`.
- Configure `foundry.toml` to share the same `src`/`lib` so `forge test` works.
- Create `.env.example` with `SEPOLIA_RPC_URL`, `PRIVATE_KEY`, `ETHERSCAN_API_KEY`.
- Add `.gitignore` (node_modules, `.env`, artifacts, cache, out).
- Configure the Solidity compiler: version `0.8.24`, optimizer on, runs 200.
- Add npm scripts: `compile`, `test`, `test:fuzz` (forge), `deploy:sepolia`,
  `verify:sepolia`, `coverage`.

**Deliverable:** clean `npx hardhat compile` and `forge build` both succeed.

`// GATE 0 // Show me the folder structure and confirm both compilers work.`

---

## PHASE 1 — PokemonCardNFT.sol (NFT + Royalties)

- Extend `ERC721` + `ERC2981`. Override `supportsInterface` for both.
- Card struct: `name`, `rarity` (enum), `pokemonType`, `hp`, `imageURI`.
- `mintCard(address to, Card calldata data, RoyaltyReceiver[] calldata receivers)`
  — restricted so only the GachaPack contract can call it (use AccessControl or
  an `onlyMinter` modifier set after deploy).
- **Custom multi-receiver royalties**: store an array of `{receiver, feeBps}` per
  tokenId. Override `royaltyInfo(tokenId, salePrice)` to return the *total*
  royalty, and expose a `getRoyaltyReceivers(tokenId)` view returning the full
  split so the marketplace can distribute correctly.
- Enforce: sum of `feeBps` across receivers ≤ a max cap (e.g. 1000 bps = 10%).
- Events: `CardMinted`, `RoyaltyReceiversSet`.

**Tests (Hardhat):** minting permissions (only minter), metadata correctness,
`royaltyInfo` returns expected total, `getRoyaltyReceivers` returns the array,
fee cap is enforced (revert over cap), `supportsInterface` true for both IDs.

`// GATE 1 // Paste passing test output. Stop.`

---

## PHASE 2 — PaymentSplitter.sol (Pull-Payment Vault)

- `mapping(address => uint256) public balances`.
- `deposit(address[] receivers, uint256[] amounts)` payable — sums must equal
  `msg.value` (revert otherwise); credits balances. Only callable by approved
  depositors (the Marketplace and GachaPack).
- `claim()` — sends caller their balance using CEI: zero the balance *before*
  the external `call`, `nonReentrant` guard, check the call succeeds.
- `claimable(address)` view.
- Events: `Deposited`, `Claimed`.
- **This is the out-of-gas defense**: distribution writes to a mapping (O(1) per
  recipient, no loop sending ETH), recipients withdraw individually.

**Tests (Hardhat):** deposit credits correctly, sum mismatch reverts, claim pays
exact balance and zeroes it, double-claim gets nothing, only approved depositors
can deposit.

**Tests (Foundry fuzz):** fuzz arbitrary receiver/amount arrays — invariant:
`sum(balances) == contract ETH balance - total claimed`. Write a malicious
reentrant receiver contract that calls `claim()` again inside its `receive()`;
assert it **cannot** drain more than its balance.

`// GATE 2 // Paste both Hardhat and Foundry output, including the reentrancy attack test. Stop.`

---

## PHASE 3 — GachaPack.sol (Gacha Engine)

- `packPrice` (e.g. `0.01 ether`), configurable by owner.
- `openPack()` payable — require exact `packPrice`, generate 5 weighted-random
  cards, mint each via `PokemonCardNFT`, route revenue to PaymentSplitter.
- **Randomness (MVP)**: `keccak256(abi.encode(block.prevrandao, msg.sender, nonce++))`,
  take modulo against a cumulative-weight table for rarity. In code comments and
  the report, clearly state this is pseudo-random and document the **Chainlink VRF**
  upgrade path (separate the RNG into an internal function so it can be swapped).
- Each minted card gets a default royalty split (e.g. issuer + original artist).
- Events: `PackOpened(buyer, tokenIds, rarities)`.

**Tests (Hardhat):** wrong payment reverts, openPack mints exactly 5 cards to
buyer, revenue lands in the splitter.

**Tests (Foundry invariant/statistical):** open ~1000 packs; assert the observed
rarity distribution is within tolerance of the configured weights. This is your
**algorithmic anti-clone** evidence — produce numbers for the report.

`// GATE 3 // Paste test output + the rarity distribution numbers. Stop.`

---

## PHASE 4 — Marketplace.sol (Atomic Swap + Security)

- `listCard(tokenId, price)` — seller must own + approve; store listing; event.
- `cancelListing(tokenId)`.
- `buyCard(tokenId)` payable — the **atomic** core:
  1. checks: listing active, exact payment;
  2. effects: delete listing first (CEI);
  3. query `getRoyaltyReceivers(tokenId)`, compute each share + platform fee;
  4. deposit royalty shares + platform fee into PaymentSplitter, credit seller's
     proceeds;
  5. transfer the NFT to the buyer.
  All in one transaction — if any step reverts, the whole thing reverts.
- `nonReentrant` on `buyCard`. Custom errors. Platform fee in bps, owner-set.
- Events: `Listed`, `Purchased`, `ListingCancelled`.

**Tests (Hardhat):** full happy path (list → buy → balances correct for seller +
each royalty receiver + platform), wrong price reverts, buying unlisted reverts,
NFT actually transfers to buyer, atomicity (force a revert mid-flow and assert no
state changed).

**Tests (Foundry fuzz):** fuzz `salePrice` and royalty splits — invariant:
`sellerProceeds + sumRoyalties + platformFee == salePrice` (no wei lost or
created). Reentrancy attack test on `buyCard`.

`// GATE 4 // Paste all test output including the value-conservation invariant. Stop.`

---

## PHASE 5 — Full Local Integration

- One Hardhat test that runs the complete user journey on a local node:
  Wallet A opens a pack → receives cards → lists a card → Wallet B buys it →
  both royalty receivers + seller + platform have correct claimable balances →
  each calls `claim()` → ETH received matches expectations exactly.
- Generate a **gas report** (`hardhat-gas-reporter` or `forge snapshot`). Save it.
- Run **coverage** and report the percentage; aim for high coverage on all four
  contracts.

`// GATE 5 // Paste the end-to-end test result, gas report table, and coverage %. Stop.`

---

## PHASE 6 — Deploy to Sepolia

- Deploy script in correct order: NFT → PaymentSplitter → GachaPack →
  Marketplace, then wire permissions (set GachaPack as NFT minter; approve
  Marketplace + GachaPack as splitter depositors).
- Save deployed addresses to a JSON the frontend reads.
- Verify all four contracts on Etherscan via `hardhat-verify`.
- Confirm on Sepolia: open one real pack, check the tx on Etherscan.

`// GATE 6 // Give me the four verified Etherscan links and the deploy JSON. Stop.`

---

## PHASE 7 — React Frontend (Vite + ethers v6)

Build pages:
- **Connect**: MetaMask connect, enforce Sepolia (prompt network switch).
- **Gacha**: "Open Pack" button → tx → **animated card-flip reveal** of the 5
  cards (CSS 3D flip), rarity-based glow.
- **Inventory**: grid of owned cards read from chain.
- **Marketplace**: list owned card (price input), browse active listings, buy.
- **Royalty Dashboard**: show `claimable()` for the connected address, `claim()`
  button.
- Global tx-status toasts: pending → confirmed → failed.

Keep contract ABIs + addresses in a typed config generated from the deploy step.

`// GATE 7 // Confirm each page works against Sepolia. Stop.`

---

## PHASE 8 — Audit & Documentation

**Self-audit pass** — go through every contract and produce a written report:
- Reentrancy: list each external call, confirm CEI + guard.
- Access control: list every privileged function and its gate.
- Integer/overflow: confirm 0.8+ checked math; note any `unchecked` blocks + why.
- Out-of-gas: confirm no unbounded loops sending ETH (pull-payment proof).
- Run a static analyzer (Slither if available) and triage every finding
  (fixed / false-positive-with-reason).

**Documentation deliverables** (for the 1.5-pt documentation criterion):
- Architecture diagram (contracts + frontend + how a sale flows).
- **Royalty split math proof**: worked example, e.g. 1 ETH sale, 5% total
  royalty, receivers [50/30/20] → exact wei to each + seller + platform, summing
  to 1 ETH.
- Rarity probability table + the empirical distribution from Phase 3.
- Gas optimization table (before/after any optimizations).
- Security analysis section (the self-audit above).
- Setup + run guide (install, test, deploy, run frontend).

**Demo script** (for presentation): the exact click-by-click flow to run live on
Sepolia in under 3 minutes — Wallet A pulls pack → gets a rare card → lists →
Wallet B buys → both claim royalties.

`// GATE 8 // Deliver the audit report, all docs, and the demo script.`

---

## ACCEPTANCE CRITERIA (the build is complete when…)

- All four contracts deployed + verified on Sepolia.
- Hardhat + Foundry test suites pass; reentrancy and value-conservation
  invariants proven; coverage reported.
- Frontend performs the full journey against Sepolia.
- Audit report, math proofs, diagrams, gas table, and demo script delivered.

Begin with **Phase 0** now. Stop at GATE 0.