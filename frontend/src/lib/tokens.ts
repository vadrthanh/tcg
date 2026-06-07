// Design tokens shared across the Pokédesk UI — single source for rarity and
// type colors plus a small typed helper for CSS custom properties.

import type { CSSProperties } from "react";
import type { Rarity } from "./types";

export interface RarityToken { key: string; label: string; color: string; rank: number; }

// On-chain rarity string → prototype design key + CSS var color + sort rank.
export const RARITY: Record<Rarity, RarityToken> = {
  Legendary: { key: "legendary", label: "Legendary",  color: "var(--r-legendary)", rank: 4 },
  UltraRare: { key: "ultra",     label: "Ultra Rare", color: "var(--r-ultra)",     rank: 3 },
  Rare:      { key: "rare",      label: "Rare",       color: "var(--r-rare)",      rank: 2 },
  Uncommon:  { key: "uncommon",  label: "Uncommon",   color: "var(--r-uncommon)",  rank: 1 },
  Common:    { key: "common",    label: "Common",     color: "var(--r-common)",    rank: 0 },
};

// High → low, for filters and breakdowns.
export const RARITY_ORDER: Rarity[] = ["Legendary", "UltraRare", "Rare", "Uncommon", "Common"];

// Maps the contract's numeric rarity (0..4 from getCard / PackOpened) to the string.
export const RARITY_BY_INDEX: Rarity[] = ["Common", "Uncommon", "Rare", "UltraRare", "Legendary"];

// Real contract drop weights out of 100 — GachaPack.sol / docs/gacha-algorithm.md.
export const DROP_WEIGHTS: Record<Rarity, number> = {
  Common: 60, Uncommon: 25, Rare: 10, UltraRare: 4, Legendary: 1,
};

// All 18 Pokémon types → a color. Reuses the prototype --t-* vars where they match.
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

// Build a style object with CSS custom properties, typed for React's style prop.
export function vars(v: Record<string, string | number>, rest?: CSSProperties): CSSProperties {
  return { ...rest, ...v } as unknown as CSSProperties;
}
