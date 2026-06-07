import { RARITY, typeColor, vars } from "../../lib/tokens";
import type { CardRow } from "../../lib/types";

const FALLBACK = "https://via.placeholder.com/150?text=?";

type ArtCard = Pick<CardRow, "name" | "rarity" | "pokemonType" | "imageURI">;

export function CardArt({ card, size = "md", revealing }: { card: ArtCard; size?: "sm" | "md" | "lg"; revealing?: boolean }) {
  return (
    <div className={`art art-${size}${revealing ? " art-reveal" : ""}`}
      style={vars({ "--tc": typeColor(card.pokemonType), "--rc": RARITY[card.rarity].color })}>
      <div className="art-stripes" />
      <div className="art-glow" />
      <img
        src={card.imageURI || FALLBACK}
        alt={card.name}
        loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK; }}
      />
    </div>
  );
}
