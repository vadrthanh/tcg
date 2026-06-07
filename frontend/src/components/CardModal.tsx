import { RARITY, vars } from "../lib/tokens";
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
  onPrimary?: () => void;    // e.g. jump to Packs
  primaryLabel?: string;
}

export function CardModal({ card, owned, onClose, onPrimary, primaryLabel }: Props) {
  if (!card) return null;
  const r = RARITY[card.rarity];
  const remaining = card.maxSupply > 0 ? card.maxSupply - card.currentSupply : null;
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal panel" style={vars({ "--rc": r.color })} onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}>✕</button>
        <div className="modal-grid">
          <div className="modal-art" style={vars({ "--rc": r.color })}>
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
              <Stat label="Supply" value={remaining != null ? `${remaining}/${card.maxSupply}` : "—"} sub="remaining" />
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
