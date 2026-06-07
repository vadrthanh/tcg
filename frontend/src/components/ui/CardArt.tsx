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
      {card.imageURI && (
        <img
          src={card.imageURI}
          alt={card.name}
          loading="lazy"
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            if (img.src !== FALLBACK) img.src = FALLBACK; // guard: don't re-trigger if FALLBACK itself fails
          }}
        />
      )}
    </div>
  );
}
