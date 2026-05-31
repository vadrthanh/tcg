import { useState } from "react";
import { RARITY_NAMES, RARITY_COLORS, RARITY_GLOW } from "../config/contracts";

interface CardData {
  tokenId: bigint;
  name: string;
  rarity: number;
  pokemonType: string;
  hp: number;
  imageURI: string;
}

interface CardFlipProps {
  card: CardData;
  revealed: boolean;
}

export function CardFlip({ card, revealed }: CardFlipProps) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div
      className="relative w-40 h-56 cursor-pointer"
      style={{ perspective: "800px" }}
      onClick={() => revealed && setFlipped(true)}
    >
      <div
        className="w-full h-full relative transition-transform duration-700"
        style={{
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* Back */}
        <div
          className="absolute inset-0 rounded-xl bg-gradient-to-br from-indigo-900 to-purple-900 border border-purple-700 flex items-center justify-center"
          style={{ backfaceVisibility: "hidden" }}
        >
          <span className="text-4xl select-none">🎴</span>
          {revealed && !flipped && (
            <div className="absolute inset-0 rounded-xl bg-yellow-400/20 animate-pulse" />
          )}
        </div>

        {/* Front */}
        <div
          className={`absolute inset-0 rounded-xl border-2 overflow-hidden flex flex-col bg-gray-900 shadow-lg ${
            RARITY_GLOW[card.rarity] ? `shadow-xl ${RARITY_GLOW[card.rarity]}` : ""
          }`}
          style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
        >
          <img
            src={card.imageURI}
            alt={card.name}
            className="w-full h-32 object-contain bg-gray-800 p-1"
            onError={(e) => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/150?text=?"; }}
          />
          <div className="p-2 flex-1 flex flex-col justify-between">
            <div>
              <p className="text-white font-bold text-sm truncate">{card.name}</p>
              <p className="text-gray-400 text-xs">{card.pokemonType} · HP {card.hp}</p>
            </div>
            <p className={`text-xs font-semibold ${RARITY_COLORS[card.rarity]}`}>
              {RARITY_NAMES[card.rarity]}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
