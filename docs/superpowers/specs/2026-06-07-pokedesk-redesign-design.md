# Pokédesk Frontend Redesign — Design Spec

_2026-06-07 · branch `feat/pokedesk-redesign`_

## Goal

Port the **PRISM** design prototype (handoff from claude.ai/design) pixel-faithfully
onto the real `frontend/` app, rebranded **Pokédesk**, across all six screens, while
preserving every contract and API wiring path. Cards render real Pokémon artwork
(`card.imageURI`, already in the codebase). The Home dashboard shows **real data only** —
no fabricated gamification numbers.

## Decisions (locked with user)

- **Brand name:** `Pokédesk` (not "PRISM", not "Pokémon TCG"). Applies to header brand mark,
  page title, pack logo text, and the reveal card backs.
- **Gamification:** Real data + honest stats. The prototype's level/XP ring, daily streak,
  achievements, and daily quests have **no on-chain or indexed source** → dropped. The
  dashboard is rebuilt from real sources only.
- **Scope:** Full redesign, all 6 screens, plus a new Home screen.
- **Card art:** Use the real `imageURI` assets already in the codebase (PokeAPI official
  artwork seeded via `contracts/data/pokemon-cards.json`). The prototype's placeholder
  "CREATURE ART" sigil tile becomes a real-image frame that keeps the premium treatment
  (type-colored glow, rarity edge, stripes) and the existing `onError` fallback.
- **Drop rates:** Show the **real contract weights** — Common 60 · Uncommon 25 · Rare 10 ·
  UltraRare 4 · Legendary 1 (out of 100, per `GachaPack.sol` / `docs/gacha-algorithm.md`),
  not the prototype's fabricated 35/33/22/8/2.

## Architecture

The prototype is vanilla React + hand-written CSS driven by CSS custom properties (oklch
tokens, `color-mix`). The real app is React 19 + TS + Tailwind v3 + ethers v6 +
react-hot-toast. We **adopt the prototype's CSS-variable token system as the design source
of truth**; Tailwind utilities remain available for incidental layout. Rationale: the
prototype's look is fundamentally oklch / `color-mix` / `var()`-driven and cannot be
expressed faithfully in Tailwind v3 utilities. Two styling idioms coexist by design.

### Styling

- `src/index.css` — replaced with the prototype's tokens + base (`styles.css`): oklch
  surfaces/text/accent/rarity tokens, radii, shadows, font vars, ambient body glow,
  keyframes, reduced-motion guard. Keep `@tailwind base/components/utilities` **before**
  the tokens so prototype rules win over preflight.
- `src/styles/components.css`, `cards.css`, `screens.css`, `app.css` — ported from the
  prototype, imported in `main.tsx`.
- `index.html` — add Space Grotesk + DM Sans + JetBrains Mono via Google Fonts `<link>`;
  set `<title>Pokédesk — Pokémon TCG on-chain</title>`.
- **Type colors:** extend the prototype's 8-type palette to all 18 Pokémon types
  (Normal, Fire, Water, Grass, Electric, Psychic, Dragon, Ice, Fighting, Poison, Ground,
  Flying, Bug, Rock, Ghost, Steel, Dark, Fairy) with a sensible default fallback.
- **Rarity mapping:** real rarities `Common|Uncommon|Rare|UltraRare|Legendary` (5) map to
  prototype keys `common|uncommon|rare|ultra|legendary`.
- Remove: `src/App.css` (Vite starter cruft), the prototype's `tweaks-panel.jsx`,
  `data.jsx`, `ui.jsx` Tweaks pieces (design-tool-only).

### UI primitives (`src/components/ui/`)

Each small, single-purpose, typed:

- `Icon.tsx` — the minimal stroke icon set (home, bolt, grid, cards, store, coin, wallet,
  flame, spark, check, lock, arrow, refresh, plus, tag, trophy, chart).
- `Btn.tsx` — `kind` (primary/ghost/outline) · `size` (sm/md/lg) · `icon` · `full`.
- `RarityBadge.tsx`, `TypeChip.tsx`, `Progress.tsx`, `Stat.tsx`.
- `CardArt.tsx` — real `<img>` inside the premium frame; type-glow, rarity edge, `onError`
  → existing placeholder.
- `tokens.ts` — `RARITY_KEY`/label/color maps and `typeColorVar(type)` helper shared by
  components (single source; avoids per-file rarity index maps currently duplicated across
  pages).

### Shared card components

- `CreatureCard.tsx` — the grid tile used by Collection, Inventory, Market (owned glow,
  rarity edge, type chip, HP, id, footer slot for floor/price/list).
- `CardModal.tsx` — detail modal (Collection click → info + context CTA; reused by Market
  for buy). Lean: stats + one primary action routed to the correct flow.

### Shell — `App.tsx`

- Sticky 3-zone topbar grid (`1fr · auto · 1fr`): brand (Pokédesk gem mark) · centered
  icon+label nav (collapses to icon-only with `title` tooltips ≤1080px) · wallet
  pill / Connect button. Wallet pill: balance · divider · address · status dot, one line.
- Mobile bottom nav ≤760px.
- Nav items: Home · Packs · Collection · Inventory · Market · Royalties. **Home is default.**
- Wrong-network state surfaced in the wallet zone (Switch to Sepolia).
- `CardModal` mounted at app level; `react-hot-toast` Toaster retained, styled to tokens.

### Screens (presentation swap; wiring preserved)

| Screen | Wiring kept | Presentation |
|--------|-------------|--------------|
| **Home** (new) | `api.nftsByOwner`, `api.transactions`, `splitter.claimable`, `provider.getBalance` | Hero + pack-mini + honest dashboard: collection ring, packs opened, claimable, balance; "Collection by rarity" + Recent activity. Not-connected → `NotConnected` panel. |
| **Packs** | `commitPack`→`revealPack` 2-tx flow, `PackOpened` parse, `pollUntil` indexer | Pedestal pack → charging → flip-reveal row → best-pull summary. Drop-rate distribution bar + stat chips (real weights). |
| **Collection** | `api.cards` + chain fallback, owned set | `CreatureCard` grid, `RarityFilter`, set-progress header, click → `CardModal`. |
| **Inventory** | API/chain owned fetch, inline approve+`listCard`, `pollUntil` | Restyled grid; inline list-for-sale kept inside the new card. |
| **Market** | `api.listings` + chain fallback, `buyCard`/`cancelListing`, `pollUntil` | Restyled grid; buy/cancel kept. |
| **Royalties** | `splitter.claimable`/`claim`, `TxHistory` | `roy-grid` claim card + how-it-works + real activity. Prototype's fabricated "where it comes from" breakdown dropped (no source). |

The standalone `Connect.tsx` route is removed; connect lives in the topbar + per-screen
`NotConnected` panels (matching the prototype). `CardFlip.tsx` is replaced by the reveal
flip card inside the Packs experience.

## Honest-data dashboard detail

- **Collection ring** — `ownedCount / 40` from `api.nftsByOwner` (cardIds) vs `api.cards`.
- **Packs opened** — count of `pack_opened` transactions for the address (`api.transactions`).
- **Claimable** — `splitter.claimable(address)` (real-time chain read).
- **Wallet balance** — `provider.getBalance(address)`.
- **Collection by rarity** — owned vs total per rarity, derived from cards + owned set.
- **Recent activity** — existing `TxHistory` component, restyled.
- All values degrade gracefully (skeleton / "—") when API or chain is unavailable.

## Pitfalls

- Tailwind preflight overriding prototype base → load tokens after `@tailwind`.
- StrictMode double-invoking reveal `setTimeout` chain → guard with phase state / cleanup.
- Remote PokeAPI images → keep `onError` fallback.
- Must not regress: two-tx commit/reveal, API→chain fallbacks, list/buy/cancel/claim,
  post-write `pollUntil`. This is a presentation swap, not a logic rewrite.
- Keep files within repo limits (UI/services < 300 lines); split components accordingly.

## Testing / verification

No frontend test runner exists (eslint only); this is a presentation change over unchanged
wiring. Gate:

- `npm run build` (`tsc -b && vite build`) passes.
- `npm run lint` clean.
- Manual visual pass of all six screens in connected + disconnected states; verify pack
  open, list, buy, cancel, claim still function against the existing flows.

Consult current ethers v6 / Tailwind docs via context7 where an API is uncertain.

## Out of scope

- Backend / contract changes. Frontend-only.
- Real XP/level/streak/quest systems (no data source).
- Adding a test framework.
- The prototype's live "Tweaks" panel.
