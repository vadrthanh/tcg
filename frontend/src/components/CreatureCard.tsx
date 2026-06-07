import type { ReactNode } from "react";
import { RARITY, vars } from "../lib/tokens";
import type { CardRow } from "../lib/types";
import { CardArt } from "./ui/CardArt";
import { TypeChip } from "./ui/TypeChip";
import { RarityBadge } from "./ui/RarityBadge";

interface Props {
  card: CardRow;
  tokenId?: number;            // when present, label uses #tokenId instead of the card #id
  owned?: boolean;
  soldOut?: boolean;
  onClick?: () => void;        // when set, the tile is a button (no nested buttons in children)
  footer?: ReactNode;          // overrides the default floor line
  children?: ReactNode;        // extra body content (e.g. inline list / buy form)
}

export function CreatureCard({ card, tokenId, owned, soldOut, onClick, footer, children }: Props) {
  const r = RARITY[card.rarity];
  const idLabel = tokenId != null ? `#${tokenId}` : `#${String(card.id).padStart(2, "0")}`;
  const cls = `ccard${owned ? " ccard-owned" : ""}${soldOut ? " ccard-soldout" : ""}`;
  const style = vars({ "--rc": r.color });

  const inner = (
    <>
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
    </>
  );

  return onClick
    ? <button className={cls} style={style} onClick={onClick}>{inner}</button>
    : <div className={cls} style={style}>{inner}</div>;
}
