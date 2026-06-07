import { RARITY, typeColor, vars } from "../../lib/tokens";
import { safeImageUrl, PLACEHOLDER_IMG } from "../../lib/safeImageUrl";
import type { CardRow } from "../../lib/types";

type ArtCard = Pick<CardRow, "name" | "rarity" | "pokemonType" | "imageURI">;

export function CardArt({ card, size = "md", revealing }: { card: ArtCard; size?: "sm" | "md" | "lg"; revealing?: boolean }) {
  return (
    <div className={`art art-${size}${revealing ? " art-reveal" : ""}`}
      style={vars({ "--tc": typeColor(card.pokemonType), "--rc": RARITY[card.rarity].color })}>
      <div className="art-stripes" />
      <div className="art-glow" />
      {card.imageURI && (
        <img
          src={safeImageUrl(card.imageURI)}
          alt={card.name}
          loading="lazy"
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            // guard: don't re-trigger onError once we're already on the placeholder
            if (!img.src.endsWith(PLACEHOLDER_IMG)) img.src = PLACEHOLDER_IMG;
          }}
        />
      )}
    </div>
  );
}
