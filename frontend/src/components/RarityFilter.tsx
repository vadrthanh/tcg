import { RARITY, RARITY_ORDER, vars } from "../lib/tokens";
import type { Rarity } from "../lib/types";

export function RarityFilter({ filter, setFilter }: {
  filter: Rarity | "all"; setFilter: (f: Rarity | "all") => void;
}) {
  const opts: [Rarity | "all", string][] = [
    ["all", "All"],
    ...RARITY_ORDER.map(k => [k, RARITY[k].label] as [Rarity, string]),
  ];
  return (
    <div className="rfilter">
      {opts.map(([k, label]) => (
        <button key={k} className={`rfilt${filter === k ? " active" : ""}`}
          style={vars({ "--rc": k === "all" ? "var(--accent)" : RARITY[k as Rarity].color })}
          onClick={() => setFilter(k)}>{label}</button>
      ))}
    </div>
  );
}
