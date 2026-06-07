# Pokédesk Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the PRISM design prototype pixel-faithfully onto the real `frontend/` app, rebranded **Pokédesk**, across all six screens, preserving every contract/API wiring path and using the real Pokémon artwork already in the codebase.

**Architecture:** Adopt the prototype's CSS-variable token system (oklch tokens, `color-mix`, 3 Google fonts) as the design source of truth; Tailwind v3 utilities stay for incidental layout. Build typed React primitives + shared card components, a new 3-zone shell with a Home screen, and restyle the five existing screens. Presentation swap only — contract/API logic is moved verbatim, never rewritten.

**Tech Stack:** React 19, TypeScript, Vite 8, Tailwind v3, ethers v6, react-hot-toast.

**Verification model:** No frontend test runner exists (eslint only) and this is presentation over unchanged wiring. Per-task gate = `npm run build` (`tsc -b && vite build`) green + `npm run lint` clean. Final gate adds a manual visual pass. Commit after each green task.

**Reference:** prototype extracted at `/tmp/design-bundle/tcg/project/` (`styles.css`, `components.css`, `cards.css`, `screens.css`, `app.css`, `*.jsx`). Spec: `docs/superpowers/specs/2026-06-07-pokedesk-redesign-design.md`.

---

## File Structure

**Create:**
- `frontend/src/styles/components.css`, `cards.css`, `screens.css`, `app.css` — ported component/screen CSS.
- `frontend/src/lib/tokens.ts` — rarity + type token maps and helpers (single source).
- `frontend/src/components/ui/Icon.tsx`, `Btn.tsx`, `RarityBadge.tsx`, `TypeChip.tsx`, `Progress.tsx`, `Stat.tsx`, `CardArt.tsx`.
- `frontend/src/components/CreatureCard.tsx`, `CardModal.tsx`, `NotConnected.tsx`, `PageHead.tsx`, `RarityFilter.tsx`.
- `frontend/src/pages/Home.tsx`.

**Modify:**
- `frontend/index.html` — fonts + title.
- `frontend/src/index.css` — replaced with prototype tokens/base (keep `@tailwind` directives).
- `frontend/src/main.tsx` — import the new CSS files.
- `frontend/src/App.tsx` — new shell.
- `frontend/src/pages/Gacha.tsx`, `Collection.tsx`, `Inventory.tsx`, `MarketplacePage.tsx`, `RoyaltyDashboard.tsx` — restyle, keep wiring.
- `frontend/src/components/TxToast.tsx`, `TxHistory.tsx` — restyle to tokens.

**Delete:**
- `frontend/src/App.css` (Vite starter cruft, unimported).
- `frontend/src/components/CardFlip.tsx` (replaced by Packs reveal card).
- `frontend/src/pages/Connect.tsx` (folded into shell + NotConnected).
- `frontend/src/assets/hero.png`, `react.svg`, `vite.svg` if unreferenced after.

---

## Task 1: Fonts, tokens, base CSS

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Add fonts + title to `index.html`**

In `<head>`, after the viewport meta, add:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
```

Change `<title>frontend</title>` → `<title>Pokédesk — Pokémon TCG on-chain</title>`.

- [ ] **Step 2: Replace `src/index.css`**

Keep the three `@tailwind` directives at the very top (so preflight loads first), then paste the prototype's `styles.css` body (`:root` tokens, `*`, `html/body`, `body::before`, `#root`, headings, `.mono/.tnum`, selection, scrollbar, utilities, keyframes, reduced-motion). Verbatim from `/tmp/design-bundle/tcg/project/styles.css` lines 6–115, with one change: set `body` font to `var(--fb)` (already is) and keep `:root { color-scheme: dark; }` semantics by adding `color-scheme: dark;` inside the prototype `:root`.

Result top of file:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: dark;
  /* surfaces */
  --bg: oklch(0.155 0.018 268);
  ...   /* full prototype :root + base + keyframes */
}
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npm run build`
Expected: PASS (tsc + vite build succeed; fonts are network links, no build impact).

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html frontend/src/index.css
git commit -m "feat(frontend): add Pokédesk design tokens, base styles and fonts"
```

---

## Task 2: Component / cards / screens / app CSS

**Files:**
- Create: `frontend/src/styles/components.css`, `cards.css`, `screens.css`, `app.css`
- Modify: `frontend/src/main.tsx`
- Delete: `frontend/src/App.css`

- [ ] **Step 1: Port the four CSS files verbatim** from `/tmp/design-bundle/tcg/project/{components,cards,screens,app}.css` into `frontend/src/styles/` with these substitutions applied globally:
  - In `cards.css`: the prototype `.art` rules stay (used by `CardArt`); add `.art img { width:100%; height:100%; object-fit:contain; position:relative; z-index:1; padding:10%; }` and hide `.art-sigil`/`.art-tag` when an image is present (handled in component via a `has-img` class — add `.art.has-img .art-sigil, .art.has-img .art-tag { display:none; }`).
  - No "PRISM" strings appear in CSS (brand text lives in JSX), so no rename needed in CSS.

- [ ] **Step 2: Import CSS in `main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/components.css'
import './styles/cards.css'
import './styles/screens.css'
import './styles/app.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 3: Delete `src/App.css`**

```bash
git rm frontend/src/App.css
```

- [ ] **Step 4: Verify build** — `cd frontend && npm run build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles frontend/src/main.tsx
git commit -m "feat(frontend): port component, card, screen and shell styles"
```

---

## Task 3: Token maps — `lib/tokens.ts`

**Files:**
- Create: `frontend/src/lib/tokens.ts`

- [ ] **Step 1: Write `tokens.ts`** — single source for rarity + type design tokens. Real rarities are `Common|Uncommon|Rare|UltraRare|Legendary`.

```ts
import type { Rarity } from "./types";

export interface RarityToken { key: string; label: string; color: string; rank: number; }

// Maps the on-chain rarity string → prototype design key + CSS var color.
export const RARITY: Record<Rarity, RarityToken> = {
  Legendary: { key: "legendary", label: "Legendary",  color: "var(--r-legendary)", rank: 4 },
  UltraRare: { key: "ultra",     label: "Ultra Rare",  color: "var(--r-ultra)",     rank: 3 },
  Rare:      { key: "rare",      label: "Rare",        color: "var(--r-rare)",      rank: 2 },
  Uncommon:  { key: "uncommon",  label: "Uncommon",    color: "var(--r-uncommon)",  rank: 1 },
  Common:    { key: "common",    label: "Common",      color: "var(--r-common)",    rank: 0 },
};

export const RARITY_ORDER: Rarity[] = ["Legendary", "UltraRare", "Rare", "Uncommon", "Common"];

// Index used by the legacy 0..4 numeric rarity (from contract getCard / PackOpened).
export const RARITY_BY_INDEX: Rarity[] = ["Common", "Uncommon", "Rare", "UltraRare", "Legendary"];

// Real contract drop weights (out of 100) — GachaPack.sol / docs/gacha-algorithm.md.
export const DROP_WEIGHTS: Record<Rarity, number> = {
  Common: 60, Uncommon: 25, Rare: 10, UltraRare: 4, Legendary: 1,
};

// All 18 Pokémon types → a CSS color. Reuses prototype --t-* vars where they exist.
const TYPE_COLORS: Record<string, string> = {
  Fire: "var(--t-fire)", Water: "var(--t-water)", Electric: "var(--t-electric)",
  Grass: "var(--t-grass)", Psychic: "var(--t-psychic)", Dragon: "var(--t-dragon)",
  Ice: "var(--t-ice)", Fighting: "var(--t-fight)",
  Normal: "oklch(0.74 0.02 90)", Poison: "oklch(0.62 0.17 320)",
  Ground: "oklch(0.66 0.10 70)", Flying: "oklch(0.78 0.08 250)",
  Bug: "oklch(0.74 0.16 130)", Rock: "oklch(0.62 0.06 80)",
  Ghost: "oklch(0.58 0.14 300)", Steel: "oklch(0.74 0.03 230)",
  Dark: "oklch(0.50 0.04 300)", Fairy: "oklch(0.80 0.10 350)",
};
export function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? "var(--text-dim)";
}
```

- [ ] **Step 2: Verify build** — `cd frontend && npm run build` → PASS (unused file is fine; consumed next tasks).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/tokens.ts
git commit -m "feat(frontend): add rarity/type design token maps"
```

---

## Task 4: Icon + Btn primitives

**Files:**
- Create: `frontend/src/components/ui/Icon.tsx`, `frontend/src/components/ui/Btn.tsx`

- [ ] **Step 1: `Icon.tsx`** — port the prototype stroke icon set to typed TSX (paths verbatim from `ui.jsx`):

```tsx
type IconName = "home"|"bolt"|"grid"|"cards"|"store"|"coin"|"wallet"|"flame"|"spark"|"check"|"lock"|"arrow"|"refresh"|"plus"|"tag"|"trophy"|"chart";

const PATHS: Record<IconName, React.ReactNode> = {
  home:   <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
  bolt:   <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />,
  grid:   <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  cards:  <><rect x="3" y="6" width="13" height="15" rx="2" /><path d="M8 3h11a2 2 0 0 1 2 2v12" /></>,
  store:  <><path d="M4 9h16l-1-5H5L4 9Z" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></>,
  coin:   <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5h3.2a1.8 1.8 0 0 1 0 3.6H10m-.5 0h3.5a1.8 1.8 0 0 1 0 3.6H9.5" /></>,
  wallet: <><rect x="3" y="6" width="18" height="14" rx="2.5" /><path d="M3 10h18" /><circle cx="17" cy="14" r="1.3" fill="currentColor" stroke="none" /></>,
  flame:  <path d="M12 3c1 3-2 4-2 7a2 2 0 0 0 4 0c0-1 0-1 .5-2 1.5 1.5 2.5 3 2.5 5a5 5 0 0 1-10 0c0-3 3-4 5-10Z" />,
  spark:  <path d="M12 3v4m0 10v4m9-9h-4M7 12H3m13.5-6.5-2.8 2.8M9.3 14.7l-2.8 2.8m11 0-2.8-2.8M9.3 9.3 6.5 6.5" />,
  check:  <path d="M5 12.5 10 17l9-10" />,
  lock:   <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  arrow:  <path d="M5 12h14m-6-6 6 6-6 6" />,
  refresh:<><path d="M21 12a9 9 0 1 1-2.6-6.3" /><path d="M21 3v5h-5" /></>,
  plus:   <path d="M12 5v14M5 12h14" />,
  tag:    <><path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z" /><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" /></>,
  trophy: <><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" /><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M9 18h6M10 21h4M12 13v5" /></>,
  chart:  <><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 16v-4M12 16V8m4 8v-6" /></>,
};

export function Icon({ name, size = 18, stroke = 1.8 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}
export type { IconName };
```

- [ ] **Step 2: `Btn.tsx`** — port the prototype button:

```tsx
import { Icon, type IconName } from "./Icon";

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: "primary" | "ghost" | "outline";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  full?: boolean;
}
export function Btn({ kind = "primary", size = "md", icon, full, children, className = "", ...rest }: BtnProps) {
  return (
    <button className={`btn btn-${kind} btn-${size}${full ? " btn-full" : ""} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === "lg" ? 19 : 16} />}
      {children}
    </button>
  );
}
```

- [ ] **Step 3: Verify build** — `cd frontend && npm run build` → PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/Icon.tsx frontend/src/components/ui/Btn.tsx
git commit -m "feat(frontend): add Icon and Btn UI primitives"
```

---

## Task 5: Badge / chip / progress / stat primitives

**Files:**
- Create: `frontend/src/components/ui/RarityBadge.tsx`, `TypeChip.tsx`, `Progress.tsx`, `Stat.tsx`

- [ ] **Step 1: `RarityBadge.tsx`**

```tsx
import { RARITY } from "../../lib/tokens";
import type { Rarity } from "../../lib/types";

export function RarityBadge({ rarity, small }: { rarity: Rarity; small?: boolean }) {
  const r = RARITY[rarity];
  return (
    <span className={`rbadge${small ? " rbadge-sm" : ""}`} style={{ "--rc": r.color } as React.CSSProperties}>
      <span className="rdot" /> {r.label}
    </span>
  );
}
```

- [ ] **Step 2: `TypeChip.tsx`**

```tsx
import { typeColor } from "../../lib/tokens";
export function TypeChip({ type }: { type: string }) {
  if (!type) return null;
  return <span className="tchip" style={{ "--tc": typeColor(type) } as React.CSSProperties}>{type}</span>;
}
```

- [ ] **Step 3: `Progress.tsx`**

```tsx
export function Progress({ value, max, color = "var(--accent)", height = 8 }: { value: number; max: number; color?: string; height?: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="prog" style={{ height }}>
      <div className="prog-fill" style={{ width: pct + "%", background: color }} />
    </div>
  );
}
```

- [ ] **Step 4: `Stat.tsx`**

```tsx
export function Stat({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: boolean }) {
  return (
    <div className="stat">
      <div className="stat-label mono">{label}</div>
      <div className="stat-value" style={accent ? { color: "var(--accent-text)" } : undefined}>{value}</div>
      {sub && <div className="stat-sub faint">{sub}</div>}
    </div>
  );
}
```

- [ ] **Step 5: Verify build** — PASS.
- [ ] **Step 6: Commit** — `git add frontend/src/components/ui && git commit -m "feat(frontend): add rarity badge, type chip, progress and stat primitives"`

---

## Task 6: CardArt (real image) + CreatureCard

**Files:**
- Create: `frontend/src/components/ui/CardArt.tsx`, `frontend/src/components/CreatureCard.tsx`

- [ ] **Step 1: `CardArt.tsx`** — premium frame with real image and `onError` fallback.

```tsx
import { RARITY, typeColor } from "../../lib/tokens";
import type { CardRow } from "../../lib/types";

const FALLBACK = "https://via.placeholder.com/150?text=?";

export function CardArt({ card, size = "md", revealing }: { card: Pick<CardRow,"name"|"rarity"|"pokemonType"|"imageURI">; size?: "sm"|"md"|"lg"; revealing?: boolean }) {
  return (
    <div className={`art art-${size} has-img${revealing ? " art-reveal" : ""}`}
      style={{ "--tc": typeColor(card.pokemonType), "--rc": RARITY[card.rarity].color } as React.CSSProperties}>
      <div className="art-stripes" />
      <div className="art-glow" />
      <img src={card.imageURI || FALLBACK} alt={card.name} loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK; }} />
    </div>
  );
}
```

- [ ] **Step 2: `CreatureCard.tsx`** — the grid tile (Collection/Inventory/Market). `owned` glow, footer slot, optional badge area.

```tsx
import { RARITY } from "../lib/tokens";
import type { CardRow } from "../lib/types";
import { CardArt } from "./ui/CardArt";
import { TypeChip } from "./ui/TypeChip";
import { RarityBadge } from "./ui/RarityBadge";

interface Props {
  card: CardRow;
  tokenId?: number;            // when present, label uses #tokenId instead of card #id
  owned?: boolean;
  soldOut?: boolean;
  onClick?: () => void;
  footer?: React.ReactNode;    // overrides the default floor line
  children?: React.ReactNode;  // extra body content (e.g. inline list form)
}

export function CreatureCard({ card, tokenId, owned, soldOut, onClick, footer, children }: Props) {
  const r = RARITY[card.rarity];
  const idLabel = tokenId != null ? `#${tokenId}` : `#${String(card.id).padStart(2, "0")}`;
  const Wrap: React.ElementType = onClick ? "button" : "div";
  return (
    <Wrap className={`ccard${owned ? " ccard-owned" : ""}${soldOut ? " ccard-soldout" : ""}`}
      style={{ "--rc": r.color } as React.CSSProperties} onClick={onClick}>
      {owned && <span className="ccard-own mono">OWNED</span>}
      {soldOut && <span className="ccard-soldout-tag mono">SOLD OUT</span>}
      <div className="ccard-art"><CardArt card={card} /></div>
      <div className="ccard-body">
        <div className="row gap-8" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div className="ccard-name">{card.name}</div>
          <span className="ccard-id mono faint">{idLabel}</span>
        </div>
        <div className="row gap-8" style={{ marginTop: 6 }}>
          <TypeChip type={card.pokemonType} />
          <span className="ccard-hp mono">HP {card.hp}</span>
        </div>
        <div className="row gap-8" style={{ marginTop: 11, justifyContent: "space-between" }}>
          <RarityBadge rarity={card.rarity} small />
          {footer ?? <span className="ccard-floor mono faint">◇ {card.floorPrice}</span>}
        </div>
        {children}
      </div>
    </Wrap>
  );
}
```

- [ ] **Step 3: Add `.ccard-soldout` styling** to `frontend/src/styles/cards.css`:

```css
.ccard-soldout { opacity: 0.45; filter: grayscale(0.7); }
.ccard-soldout-tag { position: absolute; top: 10px; right: 10px; z-index: 3; font-size: 9px;
  letter-spacing: 0.14em; font-weight: 600; color: var(--r-rare); background: oklch(0.16 0.018 268 / 0.8);
  backdrop-filter: blur(6px); padding: 4px 8px; border-radius: 6px; border: 1px solid var(--line-2); }
```

- [ ] **Step 4: Verify build** — PASS.
- [ ] **Step 5: Commit** — `git add frontend/src/components/ui/CardArt.tsx frontend/src/components/CreatureCard.tsx frontend/src/styles/cards.css && git commit -m "feat(frontend): add CardArt (real image) and CreatureCard"`

---

## Task 7: Shared screen helpers — PageHead, NotConnected, RarityFilter

**Files:**
- Create: `frontend/src/components/PageHead.tsx`, `NotConnected.tsx`, `RarityFilter.tsx`

- [ ] **Step 1: `PageHead.tsx`**

```tsx
export function PageHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="pagehead">
      <div className="col gap-8" style={{ minWidth: 0 }}>
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub dim">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
```

- [ ] **Step 2: `NotConnected.tsx`**

```tsx
import { Icon } from "./ui/Icon";
import { Btn } from "./ui/Btn";
export function NotConnected({ onConnect, note }: { onConnect: () => void; note?: string }) {
  return (
    <div className="notconn panel">
      <div className="notconn-ic"><Icon name="wallet" size={26} /></div>
      <div className="col gap-4">
        <strong style={{ fontFamily: "var(--fs)", fontSize: 15 }}>Wallet not connected</strong>
        <span className="faint" style={{ fontSize: 13 }}>{note || "Connect to load your on-chain data."}</span>
      </div>
      <Btn kind="primary" icon="wallet" onClick={onConnect}>Connect</Btn>
    </div>
  );
}
```

- [ ] **Step 3: `RarityFilter.tsx`** — "all" + the 5 rarities, ordered high→low.

```tsx
import { RARITY, RARITY_ORDER } from "../lib/tokens";
import type { Rarity } from "../lib/types";
export function RarityFilter({ filter, setFilter }: { filter: Rarity | "all"; setFilter: (f: Rarity | "all") => void }) {
  const opts: ([Rarity, string] | ["all", "All"])[] = [["all", "All"], ...RARITY_ORDER.map(k => [k, RARITY[k].label] as [Rarity, string])];
  return (
    <div className="rfilter">
      {opts.map(([k, label]) => (
        <button key={k} className={`rfilt${filter === k ? " active" : ""}`}
          style={{ "--rc": k === "all" ? "var(--accent)" : RARITY[k as Rarity].color } as React.CSSProperties}
          onClick={() => setFilter(k as Rarity | "all")}>{label}</button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Verify build** — PASS.
- [ ] **Step 5: Commit** — `git add frontend/src/components/PageHead.tsx frontend/src/components/NotConnected.tsx frontend/src/components/RarityFilter.tsx && git commit -m "feat(frontend): add PageHead, NotConnected and RarityFilter helpers"`

---

## Task 8: CardModal

**Files:**
- Create: `frontend/src/components/CardModal.tsx`

- [ ] **Step 1: `CardModal.tsx`** — detail modal. Props carry an optional primary action so callers route it correctly (Collection: "Find in packs"/owned note; Market handled in its own page, not here).

```tsx
import { RARITY } from "../lib/tokens";
import type { CardRow } from "../lib/types";
import { CardArt } from "./ui/CardArt";
import { TypeChip } from "./ui/TypeChip";
import { RarityBadge } from "./ui/RarityBadge";
import { Stat } from "./ui/Stat";
import { Btn } from "./ui/Btn";

interface Props {
  card: CardRow | null;
  owned?: boolean;
  onClose: () => void;
  onPrimary?: () => void;       // e.g. go to Packs
  primaryLabel?: string;
}
export function CardModal({ card, owned, onClose, onPrimary, primaryLabel }: Props) {
  if (!card) return null;
  const r = RARITY[card.rarity];
  const remaining = card.maxSupply - card.currentSupply;
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal panel" style={{ "--rc": r.color } as React.CSSProperties} onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}>✕</button>
        <div className="modal-grid">
          <div className="modal-art" style={{ "--rc": r.color } as React.CSSProperties}>
            <CardArt card={card} size="lg" />
          </div>
          <div className="col gap-16" style={{ minWidth: 0 }}>
            <div>
              <div className="row gap-8" style={{ marginBottom: 8 }}>
                <RarityBadge rarity={card.rarity} />
                {owned && <span className="ccard-own mono" style={{ position: "static" }}>OWNED</span>}
              </div>
              <h2 style={{ fontSize: 34 }}>{card.name}</h2>
              <div className="row gap-8" style={{ marginTop: 10 }}>
                <TypeChip type={card.pokemonType} />
                <span className="ccard-hp mono">HP {card.hp}</span>
                <span className="ccard-id mono faint">#{String(card.id).padStart(2, "0")}</span>
              </div>
            </div>
            <div className="modal-stats">
              <Stat label="Floor" value={<span>◇ {card.floorPrice}</span>} sub="ETH" />
              <Stat label="Supply" value={`${remaining}/${card.maxSupply}`} sub="remaining" />
              <Stat label="Rarity" value={r.label} accent />
            </div>
            {card.attack && <div className="faint" style={{ fontSize: 13 }}>Attack · {card.attack}</div>}
            <div className="row gap-12" style={{ marginTop: "auto" }}>
              {owned
                ? <span className="faint" style={{ fontSize: 13 }}>In your inventory — list it from the Inventory tab.</span>
                : onPrimary && <Btn kind="primary" icon="bolt" full onClick={onPrimary}>{primaryLabel ?? "Find in packs"}</Btn>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build** — PASS.
- [ ] **Step 3: Commit** — `git add frontend/src/components/CardModal.tsx && git commit -m "feat(frontend): add card detail modal"`

---

## Task 9: App shell

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/TxToast.tsx` (toast colors to tokens — optional cosmetic)

- [ ] **Step 1: Rewrite `App.tsx`** — 3-zone topbar, centered nav, wallet pill/connect, mobile bottom nav, Home default. Wallet balance read via `provider.getBalance` for the pill. Shared `modal`/`go` state lifted here; pages receive `wallet`, `go`, and `onOpen` (modal setter) as needed.

```tsx
import { useEffect, useState } from "react";
import { formatEther } from "ethers";
import { Toaster } from "react-hot-toast";
import { useWallet } from "./hooks/useWallet";
import { Icon, type IconName } from "./components/ui/Icon";
import { Btn } from "./components/ui/Btn";
import { CardModal } from "./components/CardModal";
import type { CardRow } from "./lib/types";
import { Home } from "./pages/Home";
import { Gacha } from "./pages/Gacha";
import { Collection } from "./pages/Collection";
import { Inventory } from "./pages/Inventory";
import { MarketplacePage } from "./pages/MarketplacePage";
import { RoyaltyDashboard } from "./pages/RoyaltyDashboard";

export type Page = "home" | "gacha" | "collection" | "inventory" | "marketplace" | "royalty";
const NAV: { id: Page; label: string; icon: IconName }[] = [
  { id: "home",        label: "Home",       icon: "home" },
  { id: "gacha",       label: "Packs",      icon: "bolt" },
  { id: "collection",  label: "Collection", icon: "grid" },
  { id: "inventory",   label: "Inventory",  icon: "cards" },
  { id: "marketplace", label: "Market",     icon: "store" },
  { id: "royalty",     label: "Royalties",  icon: "coin" },
];

export default function App() {
  const wallet = useWallet();
  const [page, setPage] = useState<Page>("home");
  const [modal, setModal] = useState<{ card: CardRow; owned: boolean } | null>(null);
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    if (!wallet.provider || !wallet.address) { setBalance(null); return; }
    let live = true;
    wallet.provider.getBalance(wallet.address)
      .then(b => { if (live) setBalance(Number(formatEther(b)).toFixed(3)); })
      .catch(() => { if (live) setBalance(null); });
    return () => { live = false; };
  }, [wallet.provider, wallet.address]);

  function go(p: Page) { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }
  const short = wallet.address ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : "";
  const common = { wallet, go, onOpen: (card: CardRow, owned = false) => setModal({ card, owned }) };

  return (
    <div className="app">
      <Toaster position="top-right" />
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand" onClick={() => go("home")}>
            <span className="brand-mark"><span className="brand-gem" /></span>
            <span className="brand-name">Poké<span className="faint">desk</span></span>
          </div>
          <nav className="nav">
            {NAV.map(n => (
              <button key={n.id} title={n.label} className={`navi${page === n.id ? " active" : ""}`} onClick={() => go(n.id)}>
                <Icon name={n.icon} size={17} /><span>{n.label}</span>
              </button>
            ))}
          </nav>
          <div className="topbar-r">
            {wallet.address ? (
              !wallet.chainOk ? (
                <Btn kind="outline" size="sm" onClick={wallet.switchToSepolia}>Switch to Sepolia</Btn>
              ) : (
                <div className="wallet-pill">
                  {balance != null && <span className="wallet-bal mono">◇ {balance}</span>}
                  <span className="wallet-addr mono">{short}</span>
                </div>
              )
            ) : (
              <Btn kind="primary" icon="wallet" onClick={wallet.connect}>Connect</Btn>
            )}
          </div>
        </div>
      </header>

      <nav className="nav-mobile">
        {NAV.map(n => (
          <button key={n.id} className={`navm${page === n.id ? " active" : ""}`} onClick={() => go(n.id)}>
            <Icon name={n.icon} size={19} /><span>{n.label}</span>
          </button>
        ))}
      </nav>

      <main className="content">
        {page === "home"        && <Home {...common} />}
        {page === "gacha"       && <Gacha {...common} />}
        {page === "collection"  && <Collection {...common} />}
        {page === "inventory"   && <Inventory {...common} />}
        {page === "marketplace" && <MarketplacePage {...common} />}
        {page === "royalty"     && <RoyaltyDashboard {...common} />}
      </main>

      {modal && <CardModal card={modal.card} owned={modal.owned} onClose={() => setModal(null)}
        onPrimary={() => { setModal(null); go("gacha"); }} primaryLabel="Find in packs" />}
    </div>
  );
}
```

Note: `wallet.error` (connect failures) is surfaced via the existing toast path in Home/NotConnected; if `wallet.error` is set, Home shows it (Step in Task 10). Each page's `Props` is widened to accept `{ wallet; go: (p: Page) => void; onOpen: (card: CardRow, owned?: boolean) => void }` — pages ignore props they don't use.

- [ ] **Step 2: Restyle `TxToast.tsx`** backgrounds to `var(--surface-2)` / token text colors (cosmetic). Keep the function signatures unchanged.

```tsx
import toast from "react-hot-toast";
const base = { background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--line-2)" };
export function txPending(msg = "Transaction pending…") { return toast.loading(msg, { style: base }); }
export function txUpdate(id: string, msg: string) { toast.loading(msg, { id, style: base }); }
export function txSuccess(id: string, msg = "Transaction confirmed!") { toast.success(msg, { id, style: { ...base, color: "var(--accent-text)" } }); }
export function txError(id: string, err: unknown) {
  const m = (err as any)?.reason ?? (err as any)?.message ?? "Transaction failed";
  toast.error(String(m).slice(0, 80), { id, style: { ...base, color: "var(--r-fire, #f87171)" } });
}
```

- [ ] **Step 3: Verify build** — will FAIL until pages accept new props / `Home` exists. That's expected; pages are updated in Tasks 10–14. To keep the build green per-task, implement Task 10 (`Home`) and the page prop-signature changes in the SAME commit window as this shell, OR temporarily stub. **Execution note:** treat Tasks 9–14 as one build-green unit — commit Task 9 only after Tasks 10–14 pages compile. (Pragmatic deviation from per-task green because the shell and pages are mutually dependent.)

- [ ] **Step 4: Commit** (after Tasks 10–14 compile) — `git add frontend/src/App.tsx frontend/src/components/TxToast.tsx && git commit -m "feat(frontend): new Pokédesk app shell with Home, nav and wallet pill"`

---

## Task 10: Home screen (honest dashboard)

**Files:**
- Create: `frontend/src/pages/Home.tsx`

- [ ] **Step 1: `Home.tsx`** — hero + real-data dashboard. Sources: `api.cards` (total set), `api.nftsByOwner` (owned), `api.transactions` (packs opened), `splitter.claimable`, wallet balance (from shell, re-read here for the card). Degrade to "—"/skeleton when unavailable.

```tsx
import { useEffect, useState } from "react";
import { Contract, formatEther } from "ethers";
import type { WalletState } from "../hooks/useWallet";
import type { Page } from "../App";
import type { CardRow } from "../lib/types";
import { ADDRESSES, SPLITTER_ABI } from "../config/contracts";
import { RARITY, RARITY_ORDER } from "../lib/tokens";
import { api } from "../lib/api";
import { Btn } from "../components/ui/Btn";
import { Stat } from "../components/ui/Stat";
import { Progress } from "../components/ui/Progress";
import { NotConnected } from "../components/NotConnected";
import { TxHistory } from "../components/TxHistory";

interface Props { wallet: WalletState; go: (p: Page) => void; }

export function Home({ wallet, go }: Props) {
  const [cards, setCards] = useState<CardRow[]>([]);
  const [ownedCardIds, setOwnedCardIds] = useState<number[]>([]);
  const [packsOpened, setPacksOpened] = useState<number | null>(null);
  const [claimable, setClaimable] = useState<string | null>(null);
  const connected = !!wallet.address && wallet.chainOk;

  useEffect(() => { api.cards().then(setCards).catch(() => {}); }, []);

  useEffect(() => {
    if (!wallet.address) { setOwnedCardIds([]); setPacksOpened(null); return; }
    api.nftsByOwner(wallet.address).then(n => setOwnedCardIds(n.map(x => x.cardId))).catch(() => {});
    api.transactions({ address: wallet.address, type: "pack_opened", limit: 100 })
      .then(tx => setPacksOpened(tx.reduce((sum, t) => sum + Math.max(1, t.tokenIds.length / 5 | 0), 0)))
      .catch(() => setPacksOpened(null));
  }, [wallet.address]);

  useEffect(() => {
    if (!wallet.provider || !wallet.address) { setClaimable(null); return; }
    const s = new Contract(ADDRESSES.PaymentSplitter, SPLITTER_ABI, wallet.provider);
    s.claimable(wallet.address).then((b: bigint) => setClaimable(Number(formatEther(b)).toFixed(4))).catch(() => setClaimable(null));
  }, [wallet.provider, wallet.address]);

  const total = cards.length || 40;
  const ownedSet = new Set(ownedCardIds);
  const ownedCount = cards.filter(c => ownedSet.has(c.id)).length;
  const pct = Math.round((ownedCount / total) * 100);

  return (
    <div className="screen">
      <div className="hero">
        <div className="hero-glow" />
        <div className="hero-l">
          <span className="hero-eyebrow mono">POKÉMON CARD GAME · ON-CHAIN</span>
          <h1 className="hero-title">Pull. Collect.<br />Trade the set.</h1>
          <p className="hero-desc">A 40-card Pokémon set minted on Ethereum Sepolia. Open booster packs, complete your collection, and trade on the open marketplace — every sale pays royalties back to holders.</p>
          <div className="row gap-12 hero-cta">
            <Btn kind="primary" size="lg" icon="bolt" onClick={() => go("gacha")}>Open a pack</Btn>
            <Btn kind="ghost" size="lg" icon="grid" onClick={() => go("collection")}>Browse set</Btn>
          </div>
          {wallet.error && <p className="faint" style={{ color: "#f87171", marginTop: 14, fontSize: 13 }}>{wallet.error}</p>}
        </div>
        <div className="hero-r">
          <div className="pack3d pack-mini" onClick={() => go("gacha")}>
            <div className="pack-shine" />
            <div className="pack-logo mono" style={{ fontSize: 26 }}>POKÉDESK</div>
            <div className="pack-sub mono">BOOSTER · 5 CARDS</div>
          </div>
        </div>
      </div>

      {connected ? (
        <>
          <div className="dash-stats">
            <div className="dash-stat panel">
              <div className="row gap-12" style={{ justifyContent: "space-between" }}>
                <Stat label="Collection" value={`${ownedCount} / ${total}`} sub="cards owned" />
                <div className="lvl-ring" style={{ "--p": pct } as React.CSSProperties}>
                  <span className="lvl-ring-n mono">{pct}%</span>
                </div>
              </div>
              <div style={{ marginTop: 12 }}><Progress value={ownedCount} max={total} color="var(--r-ultra)" /></div>
              <div className="faint" style={{ fontSize: 11.5, marginTop: 7 }}>{pct}% of the set collected</div>
            </div>
            <div className="dash-stat panel">
              <Stat label="Packs opened" value={packsOpened ?? "—"} sub="all-time" />
            </div>
            <div className="dash-stat panel">
              <Stat label="Claimable" value={claimable != null ? `◇ ${claimable}` : "—"} sub="ETH royalties" accent />
              <div className="row gap-8" style={{ marginTop: 14 }}>
                <Btn kind="ghost" size="sm" icon="coin" onClick={() => go("royalty")}>Royalty dashboard</Btn>
              </div>
            </div>
            <div className="dash-stat panel">
              <Stat label="Marketplace" value="Trade" sub="buy & sell listings" />
              <div className="row gap-8" style={{ marginTop: 14 }}>
                <Btn kind="ghost" size="sm" icon="store" onClick={() => go("marketplace")}>Open market</Btn>
              </div>
            </div>
          </div>

          <div className="dash-2col">
            <div className="panel dash-ach">
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
                <h3 style={{ fontSize: 17 }}>Collection by rarity</h3>
                <span className="faint mono" style={{ fontSize: 12 }}>{ownedCount}/{total}</span>
              </div>
              <div className="col gap-16">
                {RARITY_ORDER.map(rk => {
                  const inSet = cards.filter(c => c.rarity === rk);
                  const own = inSet.filter(c => ownedSet.has(c.id)).length;
                  return (
                    <div key={rk} className="col gap-4">
                      <div className="row gap-8" style={{ justifyContent: "space-between", fontSize: 13 }}>
                        <span style={{ color: RARITY[rk].color }}>{RARITY[rk].label}</span>
                        <span className="faint mono">{own}/{inSet.length}</span>
                      </div>
                      <Progress value={own} max={inSet.length || 1} color={RARITY[rk].color} height={6} />
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="panel dash-quests">
              <h3 style={{ fontSize: 17, marginBottom: 4 }}>Recent activity</h3>
              <TxHistory address={wallet.address} limit={8} />
            </div>
          </div>
        </>
      ) : (
        <NotConnected onConnect={wallet.connect} note="Connect your wallet to see your collection progress, packs opened and royalties." />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build verified at Task 14** (mutual dependency with shell).

---

## Task 11: Packs screen

**Files:**
- Modify: `frontend/src/pages/Gacha.tsx`

- [ ] **Step 1: Rewrite `Gacha.tsx`** — keep the exact commit→reveal flow + `PackOpened` parse + `pollUntil` from the current file (lines 26–106). Replace the JSX with the prototype's `PackOpen` phases (idle pedestal → charging → reveal flip row → best-pull summary) + the drop-rate distribution bar using **real `DROP_WEIGHTS`**. Reveal cards use real `CardRow`-shaped data built from the on-chain `getCard` + tokenId.

Key structure (full component):

```tsx
import { useEffect, useState } from "react";
import { Contract, formatEther } from "ethers";
import type { WalletState } from "../hooks/useWallet";
import { ADDRESSES, GACHA_ABI, NFT_ABI } from "../config/contracts";
import { RARITY, RARITY_BY_INDEX, RARITY_ORDER, DROP_WEIGHTS } from "../lib/tokens";
import { api, pollUntil } from "../lib/api";
import { CardArt } from "../components/ui/CardArt";
import { RarityBadge } from "../components/ui/RarityBadge";
import { Btn } from "../components/ui/Btn";
import { Icon } from "../components/ui/Icon";
import { PageHead } from "../components/PageHead";
import { NotConnected } from "../components/NotConnected";
import { txPending, txUpdate, txSuccess, txError } from "../components/TxToast";
import type { CardRow, Rarity } from "../lib/types";

interface Props { wallet: WalletState; }
type Phase = "idle" | "charging" | "revealing" | "done";
type Pull = { tokenId: number; card: CardRow; rarity: Rarity };

export function Gacha({ wallet }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [pulls, setPulls] = useState<Pull[]>([]);
  const [shown, setShown] = useState(0);
  const [packPrice, setPackPrice] = useState("0.01");
  const connected = !!wallet.address && wallet.chainOk;

  // staged reveal timers (guarded against StrictMode double-run via phase state)
  useEffect(() => {
    if (phase !== "revealing") return;
    const timers = pulls.map((_, i) => setTimeout(() => setShown(s => Math.max(s, i + 1)), 380 * (i + 1)));
    const end = setTimeout(() => setPhase("done"), 380 * (pulls.length + 1));
    return () => { timers.forEach(clearTimeout); clearTimeout(end); };
  }, [phase, pulls]);

  async function open() {
    if (!wallet.signer || !wallet.address) return;
    const gacha = new Contract(ADDRESSES.GachaPack, GACHA_ABI, wallet.signer);
    const nft   = new Contract(ADDRESSES.PokemonCardNFT, NFT_ABI, wallet.signer);
    const provider = wallet.signer.provider!;
    setPulls([]); setShown(0); setPhase("charging");
    const toastId = txPending("Step 1/2 — confirm payment…");
    try {
      const price = await gacha.packPrice(); setPackPrice(formatEther(price));
      const existing = await gacha.commitBlockOf(wallet.address) as bigint;
      const window   = await gacha.REVEAL_WINDOW() as bigint;
      const current  = BigInt(await provider.getBlockNumber());
      const hasLiveCommit = existing !== 0n && current <= existing + window;
      if (!hasLiveCommit) { const c = await gacha.commitPack({ value: price }); await c.wait(); }
      txUpdate(toastId, "Step 2/2 — confirm reveal…");
      const tx = await gacha.revealPack(); const receipt = await tx.wait();
      const iface = gacha.interface;
      const log = receipt.logs.map((l: any) => { try { return iface.parseLog(l); } catch { return null; } })
        .find((e: any) => e?.name === "PackOpened");
      if (log) {
        const tokenIds: bigint[] = log.args.tokenIds;
        const result: Pull[] = await Promise.all(tokenIds.map(async (tid) => {
          const c = await nft.getCard(tid);
          const rarity = RARITY_BY_INDEX[Number(c.rarity)];
          return { tokenId: Number(tid), rarity, card: {
            id: 0, name: c.name, rarity, pokemonType: c.pokemonType, hp: Number(c.hp),
            attack: "", maxSupply: 0, currentSupply: 0, floorPrice: "0", imageURI: c.imageURI, createdAt: "",
          } };
        }));
        setPulls(result);
        txSuccess(toastId, "Pack opened!");
        setTimeout(() => setPhase("revealing"), 300);
        const newIds = new Set(tokenIds.map(t => Number(t)));
        pollUntil(() => api.nftsByOwner(wallet.address!), rows => rows.some(r => newIds.has(r.tokenId)),
          { attempts: 6, intervalMs: 2000 }).catch(() => {});
      } else { txError(toastId, new Error("Pack opened but no event found")); setPhase("idle"); }
    } catch (e) { txError(toastId, e); setPhase("idle"); }
  }

  function reset() { setPhase("idle"); setPulls([]); setShown(0); }
  const best = pulls.reduce<Pull | null>((a, p) => (!a || RARITY[p.rarity].rank > RARITY[a.rarity].rank ? p : a), null);

  return (
    <div className="screen">
      <PageHead title="Open a Booster" sub={`Pay ${packPrice} ETH · receive 5 random Pokémon — a payment, then a reveal a block later, so the draw is provably fair.`} />
      {!connected ? (
        <NotConnected onConnect={wallet.connect} note="Connect your wallet to open a pack." />
      ) : (
        <div className="panel gacha-panel">
          {phase === "idle" && (
            <div className="pack-stage">
              <div className="pack-pedestal">
                <div className="pack3d" onClick={open}>
                  <div className="pack-shine" />
                  <div className="pack-logo mono">POKÉDESK</div>
                  <div className="pack-sub mono">GENESIS BOOSTER</div>
                  <div className="pack-bolt"><Icon name="bolt" size={24} /></div>
                </div>
              </div>
              <div className="pack-cta">
                <Btn kind="primary" size="lg" icon="bolt" onClick={open}>Open Booster</Btn>
                <span className="pack-price mono">{packPrice} ETH · 5 cards</span>
              </div>
              <p className="pack-note faint"><Icon name="lock" size={13} /> Provably fair — you pay first, cards reveal a block later, so the draw can't be known at purchase.</p>
            </div>
          )}
          {phase === "charging" && (
            <div className="pack-stage">
              <div className="pack3d pack-charging">
                <div className="pack-rays" /><div className="pack-shine" />
                <div className="pack-logo mono">POKÉDESK</div>
                <div className="pack-bolt charging"><Icon name="bolt" size={26} /></div>
              </div>
              <div className="charge-text mono">REVEALING ON-CHAIN…</div>
            </div>
          )}
          {(phase === "revealing" || phase === "done") && (
            <div className="reveal-stage">
              <div className="reveal-row">
                {pulls.map((p, i) => (
                  <div key={i} className={`reveal-card${i < shown ? " flipped" : ""}`} style={{ "--rc": RARITY[p.rarity].color } as React.CSSProperties}>
                    <div className="reveal-inner">
                      <div className="reveal-back"><span className="mono">POKÉDESK</span></div>
                      <div className="reveal-front">
                        <CardArt card={p.card} size="lg" />
                        <div className="reveal-meta">
                          <div className="ccard-name" style={{ fontSize: 14 }}>{p.card.name}</div>
                          <RarityBadge rarity={p.rarity} small />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {phase === "done" && best && (
                <div className="reveal-actions" style={{ animation: "floatUp .5s both" }}>
                  <div className="reveal-summary" style={{ "--rc": RARITY[best.rarity].color } as React.CSSProperties}>
                    <span className="rs-label mono">BEST PULL</span>
                    <span className="rs-name">{best.card.name}</span>
                    <RarityBadge rarity={best.rarity} />
                  </div>
                  <div className="row gap-12">
                    <Btn kind="ghost" onClick={reset}>Open another</Btn>
                    <Btn kind="primary" icon="check" onClick={reset}>Done</Btn>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="odds panel">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ fontSize: 15 }}>Drop rates</h3><span className="faint mono" style={{ fontSize: 11 }}>PER CARD</span>
        </div>
        <div className="odds-bar">
          {RARITY_ORDER.slice().reverse().map(rk => (
            <span key={rk} className="odds-seg" title={`${RARITY[rk].label} ${DROP_WEIGHTS[rk]}%`}
              style={{ width: DROP_WEIGHTS[rk] + "%", background: RARITY[rk].color, color: RARITY[rk].color }} />
          ))}
        </div>
        <div className="odds-legend">
          {RARITY_ORDER.map(rk => (
            <div key={rk} className="odds-item" style={{ "--rc": RARITY[rk].color } as React.CSSProperties}>
              <span className="odds-pct mono">{DROP_WEIGHTS[rk]}%</span>
              <span className="odds-name"><span className="rdot" />{RARITY[rk].label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

Note: the prototype's "+120 XP" line in the summary is dropped (no XP system — honest data).

- [ ] **Step 2: Build verified at Task 14.**

---

## Task 12: Collection screen

**Files:**
- Modify: `frontend/src/pages/Collection.tsx`

- [ ] **Step 1: Rewrite `Collection.tsx`** — keep the exact API-first + chain-fallback fetch and owned-set logic (current lines 33–90). Replace the render with `PageHead` (+ set-progress), `RarityFilter`, and a `.cgrid` of `CreatureCard` opening `CardModal` via `onOpen`. Props: `{ wallet; onOpen: (card, owned?) => void }`.

```tsx
import { useEffect, useMemo, useState } from "react";
import { Contract, formatEther } from "ethers";
import type { WalletState } from "../hooks/useWallet";
import type { CardRow } from "../lib/types";
import { ADDRESSES, NFT_ABI } from "../config/contracts";
import { RARITY_BY_INDEX, RARITY } from "../lib/tokens";
import { api, ApiUnavailableError } from "../lib/api";
import type { Rarity } from "../lib/types";
import { PageHead } from "../components/PageHead";
import { RarityFilter } from "../components/RarityFilter";
import { CreatureCard } from "../components/CreatureCard";
import { Progress } from "../components/ui/Progress";

interface Props { wallet: WalletState; onOpen: (card: CardRow, owned?: boolean) => void; }

export function Collection({ wallet, onOpen }: Props) {
  const [cards, setCards]   = useState<CardRow[]>([]);
  const [ownedIds, setOwned] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<Rarity | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {  // keep current fetch + chain fallback verbatim (see existing file lines 33-75)
    const ctrl = new AbortController();
    (async () => {
      setLoading(true); setError(null);
      try { const rows = await api.cards(ctrl.signal); if (!ctrl.signal.aborted) setCards(rows); }
      catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof ApiUnavailableError && wallet.provider) {
          try {
            const nft = new Contract(ADDRESSES.PokemonCardNFT, NFT_ABI, wallet.provider);
            const status: { cardIds: bigint[]; remaining: bigint[] } = await nft.getPoolStatus();
            const tpls = await Promise.all(status.cardIds.map(id => nft.getCardTemplate(id)));
            setCards(tpls.map((t: any) => ({ id: Number(t.cardId), name: t.name, rarity: RARITY_BY_INDEX[Number(t.rarity)],
              pokemonType: t.pokemonType, hp: Number(t.hp), attack: t.attack, maxSupply: Number(t.maxSupply),
              currentSupply: Number(t.currentSupply), floorPrice: formatEther(t.floorPrice), imageURI: t.imageURI, createdAt: "" })));
          } catch (e: any) { setError(e.message ?? String(e)); }
        } else setError(err instanceof Error ? err.message : String(err));
      } finally { if (!ctrl.signal.aborted) setLoading(false); }
    })();
    return () => ctrl.abort();
  }, [wallet.provider]);

  useEffect(() => {
    if (!wallet.address) { setOwned(new Set()); return; }
    const ctrl = new AbortController();
    api.nftsByOwner(wallet.address, ctrl.signal).then(n => { if (!ctrl.signal.aborted) setOwned(new Set(n.map(x => x.cardId))); }).catch(() => {});
    return () => ctrl.abort();
  }, [wallet.address]);

  const visible = useMemo(() => cards
    .filter(c => filter === "all" || c.rarity === filter)
    .sort((a, b) => RARITY[b.rarity].rank - RARITY[a.rarity].rank || a.id - b.id), [cards, filter]);
  const ownedCount = cards.filter(c => ownedIds.has(c.id)).length;

  return (
    <div className="screen">
      <PageHead title="The Pokémon Set" sub="All 40 cards. The ones you own glow with a rarity-colored edge."
        right={<div className="setprog"><div className="setprog-val mono">{ownedCount}<span className="faint">/{cards.length || 40}</span></div>
          <Progress value={ownedCount} max={cards.length || 40} color="var(--r-ultra)" /></div>} />
      <RarityFilter filter={filter} setFilter={setFilter} />
      {error && <p style={{ color: "#f87171" }}>{error}</p>}
      {loading ? <div className="cgrid">{Array.from({ length: 10 }).map((_, i) => <div key={i} className="panel" style={{ height: 280, animation: "pulseGlow 1.4s ease-in-out infinite" }} />)}</div>
        : <div className="cgrid">{visible.map(c => (
            <CreatureCard key={c.id} card={c} owned={ownedIds.has(c.id)} soldOut={c.maxSupply > 0 && c.currentSupply >= c.maxSupply}
              onClick={() => onOpen(c, ownedIds.has(c.id))} />
          ))}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Build verified at Task 14.**

---

## Task 13: Inventory + Marketplace screens

**Files:**
- Modify: `frontend/src/pages/Inventory.tsx`, `frontend/src/pages/MarketplacePage.tsx`

- [ ] **Step 1: `Inventory.tsx`** — keep ALL wiring verbatim (`load`, `fetchOwnedFromChain`, `listForSale` with approve+`listCard`+`pollUntil`). Replace tiles with `CreatureCard` (tokenId-labelled, `owned`), inline list form rendered as `children`. Props gain `onOpen` (unused-ok). Header uses `PageHead` with a Refresh `Btn`. Empty/not-connected use `NotConnected`.

The inline list form moves into `CreatureCard`'s `children` slot:
```tsx
// inside InventoryTile render, pass to CreatureCard:
<CreatureCard card={card} tokenId={nft.tokenId} owned
  footer={isListed ? <span className="mkt-price mono" style={{ color: "var(--accent-text)" }}>LISTED</span> : undefined}>
  {!isListed && (open ? (
    <div className="col gap-8" style={{ marginTop: 10 }}>
      <input type="number" step="0.0001" min="0" value={price} onChange={e => setPrice(e.target.value)}
        placeholder={`Floor ${suggest}`} className="inv-price-input mono" />
      <div className="row gap-8">
        <Btn kind="primary" size="sm" full disabled={busy || !price} onClick={listForSale}>{busy ? "…" : "List"}</Btn>
        <Btn kind="ghost" size="sm" disabled={busy} onClick={() => { setOpen(false); setPrice(""); }}>✕</Btn>
      </div>
    </div>
  ) : (
    <Btn kind="primary" size="sm" full icon="tag" onClick={() => setOpen(true)} className="inv-list-btn">List for sale</Btn>
  ))}
</CreatureCard>
```
Add to `frontend/src/styles/cards.css`:
```css
.inv-price-input { width: 100%; padding: 8px 11px; border-radius: var(--r-sm); background: var(--bg-2);
  border: 1px solid var(--line-2); color: var(--text); font-size: 13px; }
.inv-list-btn { margin-top: 10px; }
```

- [ ] **Step 2: `MarketplacePage.tsx`** — keep ALL wiring (`load`, `fetchListingsFromChain`, `buy`, `cancel`, `pollUntil`). Replace render: `PageHead` + Refresh, `RarityFilter`, `.cgrid` of `CreatureCard` with a price footer and a buy/cancel `Btn` in `children`. "(you)" marker preserved.

```tsx
<CreatureCard card={l.card!} tokenId={l.tokenId} onClick={() => onOpen(l.card!)}
  footer={<span className="mkt-price mono">◇ {l.price}</span>}>
  <div className="row gap-8" style={{ marginTop: 10, justifyContent: "space-between", alignItems: "center" }}>
    <span className="faint mono" style={{ fontSize: 11 }}>{l.seller.slice(0,6)}…{l.seller.slice(-4)}{isMine && " (you)"}</span>
    {isMine
      ? <Btn kind="ghost" size="sm" onClick={(e) => { e.stopPropagation(); cancel(l); }}>Cancel</Btn>
      : <Btn kind="primary" size="sm" icon="coin" disabled={!wallet.address} onClick={(e) => { e.stopPropagation(); buy(l); }}>Buy</Btn>}
  </div>
</CreatureCard>
```
Props gain `onOpen`. Since `CreatureCard` with `onClick` renders a `<button>`, the inner buy/cancel buttons call `e.stopPropagation()` (shown above) to avoid double-trigger; build verifies nesting is via `children` inside the button — acceptable for the demo, but to avoid invalid nested-button HTML, render the Market `CreatureCard` WITHOUT `onClick` (no modal on market tiles) so the inner buttons are the only buttons. **Decision: Market tiles have no modal; only buy/cancel buttons.** Drop `onClick`/`onOpen` use on Market.

- [ ] **Step 3: Build verified at Task 14.**

---

## Task 14: Royalties + cleanup + final verification

**Files:**
- Modify: `frontend/src/pages/RoyaltyDashboard.tsx`, `frontend/src/components/TxHistory.tsx`
- Delete: `frontend/src/pages/Connect.tsx`, `frontend/src/components/CardFlip.tsx`

- [ ] **Step 1: `RoyaltyDashboard.tsx`** — keep `loadClaimable`/`claim`/`TxHistory` wiring. Replace render with `roy-grid`: claim card (big claimable + Claim `Btn`), how-it-works panel (the prototype's 4 steps, kept — they're accurate to the contracts), and `TxHistory`. Drop the fabricated "where it comes from" breakdown. Props gain `wallet` only.

```tsx
return (
  <div className="screen">
    <PageHead title="Royalty Dashboard" sub="Your share of pack revenue and marketplace royalties accrues here — claim anytime." />
    {!connected ? <NotConnected onConnect={wallet.connect} note="Connect your wallet to view and claim your royalty balance." /> : (
      <div className="roy-grid">
        <div className="panel roy-claim">
          <div className="stat-label mono">CLAIMABLE BALANCE</div>
          <div className="roy-big mono">◇ {claimable ?? "—"} <span>ETH</span></div>
          <div className="faint" style={{ fontSize: 12.5 }}>Withdrawn in a single transaction.</div>
          <Btn kind="primary" size="lg" icon="coin" full disabled={loading || !hasBalance} onClick={claim}>{loading ? "Claiming…" : "Claim ETH"}</Btn>
        </div>
        <div className="panel roy-how">
          <h3 style={{ fontSize: 15, marginBottom: 14 }}>How royalties work</h3>
          <ol className="roy-steps">
            <li>Every pack sale deposits revenue into the splitter contract.</li>
            <li>Every secondary sale queries EIP-2981 and deposits royalties atomically.</li>
            <li>Your address accrues a balance — nothing is pushed automatically.</li>
            <li>Claim withdraws your full balance in a single transaction.</li>
          </ol>
        </div>
        <div className="panel roy-break"><h3 style={{ fontSize: 15, marginBottom: 8 }}>Recent activity</h3><TxHistory address={wallet.address} limit={10} /></div>
      </div>
    )}
  </div>
);
```
(Add `import` for `PageHead`, `NotConnected`, `Btn`; compute `connected = !!wallet.address && wallet.chainOk`.)

- [ ] **Step 2: Restyle `TxHistory.tsx`** — remove the `bg-gray-*` wrapper (it now lives inside panels); keep the list markup, swap Tailwind text colors for token classes (`faint`, `mono`, `var(--accent-text)`). Keep the API fetch verbatim.

- [ ] **Step 3: Delete dead files**

```bash
git rm frontend/src/pages/Connect.tsx frontend/src/components/CardFlip.tsx
```
Grep to confirm no imports remain: `grep -rn "Connect\|CardFlip" frontend/src` → only `wallet.connect` / topbar refs, no module imports.

- [ ] **Step 4: Remove unused starter assets** if unreferenced: `grep -rn "hero.png\|react.svg\|vite.svg" frontend/src`. If clean, `git rm frontend/src/assets/hero.png frontend/src/assets/react.svg frontend/src/assets/vite.svg`.

- [ ] **Step 5: Full build + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: build PASS, lint clean (fix any unused-import / `any` lint errors surfaced).

- [ ] **Step 6: Manual visual pass** — `npm run dev`, verify each screen connected + disconnected; confirm pack open, list, buy, cancel, claim still function. (Requires a configured `.env` with deployed addresses; if absent, verify render + graceful errors only.)

- [ ] **Step 7: Commit the shell+pages unit (Tasks 9–14)**

```bash
git add -A
git commit -m "feat(frontend): rebuild all screens on Pokédesk design system"
```

---

## Self-Review

- **Spec coverage:** tokens/base (T1–2), primitives (T3–8), shell+Home (T9–10), Packs real drop rates + 2-tx flow (T11), Collection/Inventory/Market (T12–13), Royalties honest (T14), brand=Pokédesk (T9/T10/T11), real images (T6), honest dashboard (T10), cleanup (T14). All spec sections mapped. ✓
- **Placeholders:** none — every code step is complete. CSS port steps name the exact source file + the exact additions. ✓
- **Type consistency:** `CardRow` shape reused everywhere; `Rarity` union consistent; `RARITY`/`RARITY_BY_INDEX`/`RARITY_ORDER`/`DROP_WEIGHTS` defined in T3 and consumed thereafter; page `Props` widened consistently (`wallet`, `go`, `onOpen`) with Market opting out of `onOpen`. ✓
- **Known deviation:** Tasks 9–14 commit as one build-green unit (shell↔pages mutual dependency) instead of per-task green — called out in T9 Step 3.
