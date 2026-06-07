// Collection — every card in the pool with remaining supply, sourced from /api/cards.
// Owned cards get a glow border; sold-out cards are grayed out.
//
// Falls back to GachaPack.getPoolStatus() + NFT.balanceOf scan if the API is down.

import { useEffect, useMemo, useState } from "react";
import { Contract, formatEther } from "ethers";
import type { WalletState } from "../hooks/useWallet";
import { ADDRESSES, NFT_ABI, RARITY_COLORS, RARITY_GLOW } from "../config/contracts";
import { api, ApiUnavailableError, apiConfigured } from "../lib/api";
import { safeImageUrl, PLACEHOLDER_IMG } from "../lib/safeImageUrl";
import type { CardRow, Rarity } from "../lib/types";

interface Props { wallet: WalletState; }

const RARITY_ORDER: Rarity[] = ["Legendary", "UltraRare", "Rare", "Uncommon", "Common"];
const RARITY_INDEX: Record<Rarity, number> = {
  Common: 0, Uncommon: 1, Rare: 2, UltraRare: 3, Legendary: 4,
};
const RARITY_LABEL: Record<Rarity, string> = {
  Common: "Common", Uncommon: "Uncommon", Rare: "Rare",
  UltraRare: "Ultra Rare", Legendary: "Legendary",
};

export function Collection({ wallet }: Props) {
  const [cards, setCards]       = useState<CardRow[]>([]);
  const [ownedIds, setOwnedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [filter, setFilter]     = useState<Rarity | "all">("all");
  const [source, setSource]     = useState<"api" | "chain">("api");

  // Fetch the card pool — backend first, on-chain fallback.
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setLoading(true); setError(null);
      try {
        const rows = await api.cards(ctrl.signal);
        if (!ctrl.signal.aborted) { setCards(rows); setSource("api"); }
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof ApiUnavailableError && wallet.provider) {
          // Fallback: read getPoolStatus + each template from chain.
          try {
            const nft = new Contract(ADDRESSES.PokemonCardNFT, NFT_ABI, wallet.provider);
            const status: { cardIds: bigint[]; remaining: bigint[] } = await nft.getPoolStatus();
            const templates = await Promise.all(
              status.cardIds.map(id => nft.getCardTemplate(id)),
            );
            const rows: CardRow[] = templates.map((t: any) => ({
              id:            Number(t.cardId),
              name:          t.name,
              rarity:        (["Common","Uncommon","Rare","UltraRare","Legendary"] as Rarity[])[Number(t.rarity)],
              pokemonType:   t.pokemonType,
              hp:            Number(t.hp),
              attack:        t.attack,
              maxSupply:     Number(t.maxSupply),
              currentSupply: Number(t.currentSupply),
              floorPrice:    formatEther(t.floorPrice),
              imageURI:      t.imageURI,
              createdAt:     "",
            }));
            setCards(rows); setSource("chain");
          } catch (e: any) {
            setError(e.message ?? String(e));
          }
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [wallet.provider]);

  // Owned cardIds (for glow border). API path is fast; chain path is the fallback.
  useEffect(() => {
    if (!wallet.address) { setOwnedIds(new Set()); return; }
    const ctrl = new AbortController();
    (async () => {
      try {
        const nfts = await api.nftsByOwner(wallet.address!, ctrl.signal);
        if (!ctrl.signal.aborted) setOwnedIds(new Set(nfts.map(n => n.cardId)));
      } catch {
        // Silent: glow border is a nice-to-have.
      }
    })();
    return () => ctrl.abort();
  }, [wallet.address]);

  const visible = useMemo(
    () => cards
      .filter(c => filter === "all" || c.rarity === filter)
      .sort((a, b) => RARITY_INDEX[b.rarity] - RARITY_INDEX[a.rarity] || a.id - b.id),
    [cards, filter],
  );

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-white">Card Collection</h2>
        <span className="text-xs text-gray-500">
          {cards.length > 0 && `${cards.length} cards`}
          {source === "chain" && cards.length > 0 && (
            <span className="ml-2 text-yellow-500">(reading from chain — backend unavailable)</span>
          )}
        </span>
      </div>
      <p className="text-gray-400 text-sm mb-6">
        The full 40-card pool. Cards you own glow with a rarity-colored border.
        {!apiConfigured && " (API not configured — reading directly from chain.)"}
      </p>

      {/* Rarity filter chips */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <Chip active={filter === "all"} onClick={() => setFilter("all")} label="All" />
        {RARITY_ORDER.map(r => (
          <Chip
            key={r}
            active={filter === r}
            onClick={() => setFilter(r)}
            label={RARITY_LABEL[r]}
            color={RARITY_COLORS[RARITY_INDEX[r]]}
          />
        ))}
      </div>

      {loading && <SkeletonGrid />}
      {error && <p className="text-red-400">{error}</p>}

      {!loading && !error && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {visible.map(card => (
            <CardTile key={card.id} card={card} owned={ownedIds.has(card.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CardTile({ card, owned }: { card: CardRow; owned: boolean }) {
  const remaining = card.maxSupply - card.currentSupply;
  const soldOut   = remaining === 0;
  const rIdx      = RARITY_INDEX[card.rarity];
  const glow      = owned ? `shadow-lg ${RARITY_GLOW[rIdx]} border-current` : "border-gray-700";
  const opacity   = soldOut ? "opacity-40 grayscale" : "";

  return (
    <div
      className={`relative bg-gray-800 rounded-xl overflow-hidden border-2 transition ${glow} ${opacity}`}
      title={`${card.name} · ${RARITY_LABEL[card.rarity]}`}
    >
      {owned && (
        <span className="absolute top-1 right-1 text-[10px] font-bold bg-emerald-500/90 text-white px-1.5 py-0.5 rounded-full z-10">
          OWNED
        </span>
      )}
      {soldOut && (
        <span className="absolute top-1 left-1 text-[10px] font-bold bg-red-500/90 text-white px-1.5 py-0.5 rounded-full z-10">
          SOLD OUT
        </span>
      )}
      <img
        src={safeImageUrl(card.imageURI)}
        alt={card.name}
        loading="lazy"
        className="w-full h-28 object-contain bg-gray-900 p-1"
        onError={(e) => { (e.target as HTMLImageElement).src = PLACEHOLDER_IMG; }}
      />
      <div className="p-2">
        <p className="text-white text-xs font-bold truncate">{card.name}</p>
        <p className="text-gray-400 text-[11px] truncate">{card.pokemonType} · HP {card.hp}</p>
        <p className={`text-[11px] font-semibold mt-1 ${RARITY_COLORS[rIdx]}`}>
          {RARITY_LABEL[card.rarity]}
        </p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-gray-500">#{card.id}</span>
          <span className="text-[10px] text-gray-400">
            {remaining}/{card.maxSupply}
          </span>
        </div>
        <p className="text-[10px] text-gray-500 mt-0.5">Floor {card.floorPrice} ETH</p>
      </div>
    </div>
  );
}

function Chip(props: { active: boolean; onClick: () => void; label: string; color?: string }) {
  return (
    <button
      onClick={props.onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium transition ${
        props.active
          ? "bg-indigo-600 text-white"
          : `bg-gray-800 ${props.color ?? "text-gray-400"} hover:bg-gray-700`
      }`}
    >
      {props.label}
    </button>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {Array.from({ length: 15 }).map((_, i) => (
        <div key={i} className="bg-gray-800 rounded-xl h-52 animate-pulse" />
      ))}
    </div>
  );
}
