import { useMemo } from "react";
import type { CardRow } from "../lib/types";
import { CardArt } from "./ui/CardArt";

// Decorative fallback so the hero still animates before the backend responds
// (or when it's offline). Real cards replace these as soon as /api/cards loads.
const PLACEHOLDERS: CardRow[] = ["Dragon", "Fire", "Water", "Grass", "Psychic", "Electric"].map((t, i) => ({
  id: -(i + 1), name: "", rarity: i % 2 ? "Rare" : "UltraRare", pokemonType: t, hp: 0,
  attack: "", maxSupply: 0, currentSupply: 0, floorPrice: "0", imageURI: "", createdAt: "",
}));

export function HeroCarousel({ cards, onClick }: { cards: CardRow[]; onClick?: () => void }) {
  const list = cards.length >= 4 ? cards : PLACEHOLDERS;
  // Duplicate the list so the vertical marquee loops seamlessly (track scrolls -50%).
  const loop = useMemo(() => [...list, ...list], [list]);
  return (
    <div className="hero-carousel">
      <div className="hero-carousel-track">
        {loop.map((c, i) => (
          <button key={i} className="hero-carousel-card" onClick={onClick} tabIndex={-1}
            aria-label={c.name || "Pokémon card"}>
            <CardArt card={c} size="lg" />
          </button>
        ))}
      </div>
    </div>
  );
}
