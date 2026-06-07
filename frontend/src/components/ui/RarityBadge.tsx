import { RARITY, vars } from "../../lib/tokens";
import type { Rarity } from "../../lib/types";

export function RarityBadge({ rarity, small }: { rarity: Rarity; small?: boolean }) {
  const r = RARITY[rarity];
  return (
    <span className={`rbadge${small ? " rbadge-sm" : ""}`} style={vars({ "--rc": r.color })}>
      <span className="rdot" /> {r.label}
    </span>
  );
}
