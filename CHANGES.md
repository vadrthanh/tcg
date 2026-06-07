# Frontend Optimization & Security — Change Log

Scope: `frontend/` only. Stack: React + Vite + TypeScript + ethers v6 + MetaMask. Target network: Sepolia.
Done by following `CLAUDE_TASK.md` and `frontend-optimization-rubric.md` (priority order P0 security → light cleanup).

---

## 1. Files changed (summary)

| File | Type | What |
|------|------|------|
| `src/lib/assertChain.ts` | **new** | Helper: verify wallet is on Sepolia before every write tx |
| `src/lib/safeImageUrl.ts` | **new** | Helper: allow only safe image URL schemes, else local placeholder |
| `public/placeholder-card.svg` | **new** | Local placeholder image (replaces external `via.placeholder.com`) |
| `src/config/contracts.ts` | edit | Validate env addresses without crashing; export `CONFIG_OK` / `MISSING_ADDRESS_VARS` |
| `src/App.tsx` | edit | Show a friendly "not configured" screen instead of crashing |
| `src/hooks/useWallet.ts` | edit | `accountsChanged` + `chainChanged` listeners, auto-reconnect, `hasProvider` flag |
| `src/env.d.ts` | edit | Add `removeListener` to the `window.ethereum` type (for listener cleanup) |
| `src/pages/Connect.tsx` | edit | Show "Install MetaMask" when no wallet is present (no crash) |
| `src/pages/Gacha.tsx` | edit | `assertChain` before opening a pack |
| `src/pages/Inventory.tsx` | edit | Price validation, `assertChain` before listing, `safeImageUrl`, catch comments |
| `src/pages/MarketplacePage.tsx` | edit | `assertChain` before buy/cancel, `safeImageUrl`, catch comments |
| `src/pages/RoyaltyDashboard.tsx` | edit | `assertChain` before claim |
| `src/pages/Collection.tsx` | edit | `safeImageUrl` for card images |
| `src/components/CardFlip.tsx` | edit | `safeImageUrl` for card image |

---

## 2. Security fixes (rubric IDs) — what, where, why

### S4 — React to account / network changes + auto-reconnect  (`src/hooks/useWallet.ts`)
- **Added** `hasProvider` field/flag — `useWallet.ts:10`, `:21`, `:80`.
- **Changed** `refresh()` to re-read account/signer/network via non-popup `eth_accounts`
  — `useWallet.ts:24–41` (key call at `:30`).
- **Added** a `useEffect` that auto-reconnects on mount and registers
  `accountsChanged` / `chainChanged` listeners, with `removeListener` cleanup —
  `useWallet.ts:59–79`.
- **Added** `removeListener` to the `window.ethereum` type — `env.d.ts:19`.
- **Why:** previously, switching account/network in MetaMask after connecting left the
  app showing & signing with the OLD account → risk of sending a tx from the wrong
  wallet or wrong chain.

### S3 — Verify correct network before every write  (`src/lib/assertChain.ts` + 4 pages)
- **New file** `src/lib/assertChain.ts` — throws "Wrong network…" if `chainId !== Sepolia`.
- **Called** at the start of each write, inside the existing try/catch so the error shows
  as a toast:
  - `Gacha.tsx:39` (open pack)
  - `Inventory.tsx:169` (list card)
  - `MarketplacePage.tsx:77` (buy) and `:98` (cancel)
  - `RoyaltyDashboard.tsx:43` (claim)
- **Why:** the connect-time chain check was not enough — the user can switch network
  afterwards, which would send the tx to the wrong chain.

### S5 / S9 — Sanitize on-chain image URLs + drop external host  (`src/lib/safeImageUrl.ts`)
- **New file** `src/lib/safeImageUrl.ts` — allows only `https:`, `ipfs:`, `data:image/`;
  anything else (e.g. `javascript:`, `file:`) falls back to a local placeholder.
- **New file** `public/placeholder-card.svg` — local gray "No Image" placeholder.
- **Applied** to every `<img>` and replaced every `via.placeholder.com` fallback:
  - `Inventory.tsx:204`, `:208`
  - `MarketplacePage.tsx:169`, `:173`
  - `Collection.tsx:167`, `:171`
  - `CardFlip.tsx:54`, `:57`
- **Why:** `imageURI` comes from contract data; an unsanitized scheme in `<img src>` is a
  small XSS/abuse surface. Also removes a dependency on an external image service.

### S7 — Validate list price before `parseEther`  (`src/pages/Inventory.tsx`)
- **Added** `validatePrice()` — `Inventory.tsx:27–39`.
- **Called** at the top of `listForSale()` before any contract call — `Inventory.tsx:160`.
- Rejects: empty, NaN, ≤ 0, more than 18 decimals; shows a clear toast.
- **Why:** bad input would otherwise reach `parseEther` and either throw cryptically or
  create a malformed listing.

### R5 — Friendly screen when env is not configured  (`src/config/contracts.ts` + `src/App.tsx`)
- **Changed** address handling: no longer `throw` at import time (which blanked the whole
  app). Now exports `CONFIG_OK` + `MISSING_ADDRESS_VARS` — `contracts.ts:14`, `:27`, `:38`.
- **Added** `ConfigErrorScreen` rendered when `!CONFIG_OK` — `App.tsx:29–31`, `:84`.
- **Why:** turns a cryptic crash into a clear "fill in these .env vars" message.

---

## 3. Light cleanup (non-security)
- Added explanatory comments to 5 previously-empty `catch {}` blocks
  (`Inventory.tsx`, `MarketplacePage.tsx`) — removes all `no-empty` lint errors.

---

## 4. Items deliberately NOT done (kept simple, easy to explain)
- C7 — extracting `usePack` / `useMarketplace` / `useSplitter` hooks (large refactor).
- C8 — unit tests; P3 — batching the RPC fallback; Lighthouse tuning.
- The 19 remaining lint errors (`any` on ethers logs, a few `setState`-in-effect) are
  **pre-existing** (present before this work), not introduced here.

---

## 5. Verification

| Check | Command | Result |
|-------|---------|--------|
| Typecheck | `tsc -b` | **0 errors** ✓ |
| Build | `npm run build` | **success**, JS bundle **167 kB gzip** (< 250 kB min, < 180 kB target) ✓ |
| Lint | `npx eslint .` | **19 errors, 0 warnings** — down from 24 baseline, **no new errors** ✓ |
| No external image host | `grep -rn "via.placeholder" src` | empty ✓ |
| No raw HTML injection | `grep -rn "dangerouslySetInnerHTML" src` | empty ✓ |
| No private keys in client | `grep -rnE "new Wallet\|mnemonic\|privateKey" src` | empty ✓ |
| Dependency audit | `npm audit` | 0 high/critical (2 moderate from `ws` via ethers — documented, browser-unreachable) ✓ |
| Comments/UI language | `grep -rnP "<vietnamese>" src` | empty — all English ✓ |

**Security issues fixed in this pass: 5** — S3 (network check before writes), S4
(account/network change + auto-reconnect), S5/S9 (image URL sanitize + drop external
host), S7 (price validation), plus R5 (no-crash config screen). S1, S2, S6, S10, S11
were already satisfied by the existing code.

**Runtime note:** with zero/placeholder addresses in `.env`, the app loads and all
pages render; on-chain reads will still return `0x` (decode error in the console) until
real deployed addresses are filled in — expected, since nothing is deployed there.
