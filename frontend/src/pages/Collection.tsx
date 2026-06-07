// Collection — every card in the pool, sourced from /api/cards with an on-chain
// fallback (GachaPack pool status + templates). Owned cards glow by rarity;
// sold-out cards gray out. Clicking a card opens the detail modal.

import { useEffect, useMemo, useState } from "react";
import { Contract, formatEther } from "ethers";
import type { WalletState } from "../hooks/useWallet";
import type { CardRow, Rarity } from "../lib/types";
import { ADDRESSES, NFT_ABI } from "../config/contracts";
import { RARITY, RARITY_BY_INDEX } from "../lib/tokens";
import { api, ApiUnavailableError } from "../lib/api";
import { PageHead } from "../components/PageHead";
import { RarityFilter } from "../components/RarityFilter";
import { CreatureCard } from "../components/CreatureCard";
import { Progress } from "../components/ui/Progress";

interface Props { wallet: WalletState; onOpen: (card: CardRow, owned?: boolean) => void; }

export function Collection({ wallet, onOpen }: Props) {
  const [cards, setCards]     = useState<CardRow[]>([]);
  const [ownedIds, setOwned]  = useState<Set<number>>(new Set());
  const [filter, setFilter]   = useState<Rarity | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Card pool — backend first, on-chain fallback.
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setLoading(true); setError(null);
      try {
        const rows = await api.cards(ctrl.signal);
        if (!ctrl.signal.aborted) setCards(rows);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof ApiUnavailableError && wallet.provider) {
          try {
            const nft = new Contract(ADDRESSES.PokemonCardNFT, NFT_ABI, wallet.provider);
            const status: { cardIds: bigint[]; remaining: bigint[] } = await nft.getPoolStatus();
            const tpls = await Promise.all(status.cardIds.map(id => nft.getCardTemplate(id)));
            setCards(tpls.map((t) => ({
              id: Number(t.cardId), name: t.name, rarity: RARITY_BY_INDEX[Number(t.rarity)],
              pokemonType: t.pokemonType, hp: Number(t.hp), attack: t.attack,
              maxSupply: Number(t.maxSupply), currentSupply: Number(t.currentSupply),
              floorPrice: formatEther(t.floorPrice), imageURI: t.imageURI, createdAt: "",
            })));
          } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally { if (!ctrl.signal.aborted) setLoading(false); }
    })();
    return () => ctrl.abort();
  }, [wallet.provider]);

  // Owned cardIds for the glow border.
  useEffect(() => {
    if (!wallet.address) { setOwned(new Set()); return; }
    const ctrl = new AbortController();
    api.nftsByOwner(wallet.address, ctrl.signal)
      .then(n => { if (!ctrl.signal.aborted) setOwned(new Set(n.map(x => x.cardId))); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [wallet.address]);

  const visible = useMemo(() => cards
    .filter(c => filter === "all" || c.rarity === filter)
    .sort((a, b) => RARITY[b.rarity].rank - RARITY[a.rarity].rank || a.id - b.id), [cards, filter]);
  const total = cards.length || 40;
  const ownedCount = cards.filter(c => ownedIds.has(c.id)).length;

  return (
    <div className="screen">
      <PageHead title="The Pokémon Set" sub="The full pool. Cards you own glow with a rarity-colored edge — click any card for detail."
        right={
          <div className="setprog">
            <div className="setprog-val mono">{ownedCount}<span className="faint">/{total}</span></div>
            <Progress value={ownedCount} max={total} color="var(--r-ultra)" />
          </div>
        } />
      <RarityFilter filter={filter} setFilter={setFilter} />
      {error && <p style={{ color: "#f87171" }}>{error}</p>}
      {loading ? (
        <div className="cgrid">
          {Array.from({ length: 10 }).map((_, i) => <div key={i} className="panel" style={{ height: 280, opacity: 0.5 }} />)}
        </div>
      ) : (
        <div className="cgrid">
          {visible.map(c => (
            <CreatureCard key={c.id} card={c} owned={ownedIds.has(c.id)}
              soldOut={c.maxSupply > 0 && c.currentSupply >= c.maxSupply}
              onClick={() => onOpen(c, ownedIds.has(c.id))} />
          ))}
        </div>
      )}
    </div>
  );
}
