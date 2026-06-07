// Marketplace — active listings + cancel/buy flows.
//
// Reads listings from /api/listings (one HTTP call, no on-chain scan). Falls
// back to scanning the first 200 token IDs via getListingWithDetails if the
// API is unreachable. All writes (buy, cancel) go directly to the chain;
// after each tx confirms we poll the API until the indexer reflects it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Contract, parseEther, formatEther } from "ethers";
import type { WalletState } from "../hooks/useWallet";
import {
  ADDRESSES, MARKET_ABI,
  RARITY_COLORS, RARITY_GLOW,
} from "../config/contracts";
import { api, ApiUnavailableError, apiConfigured, pollUntil } from "../lib/api";
import { assertChain } from "../lib/assertChain";
import { safeImageUrl, PLACEHOLDER_IMG } from "../lib/safeImageUrl";
import type { ListingRow, Rarity } from "../lib/types";
import { txPending, txSuccess, txError } from "../components/TxToast";

interface Props { wallet: WalletState; }

const RARITY_INDEX: Record<Rarity, number> = {
  Common: 0, Uncommon: 1, Rare: 2, UltraRare: 3, Legendary: 4,
};
const RARITY_LABEL: Record<Rarity, string> = {
  Common: "Common", Uncommon: "Uncommon", Rare: "Rare",
  UltraRare: "Ultra Rare", Legendary: "Legendary",
};
const RARITY_FILTERS: (Rarity | "all")[] = ["all", "Legendary", "UltraRare", "Rare", "Uncommon", "Common"];

export function MarketplacePage({ wallet }: Props) {
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [filter, setFilter]     = useState<Rarity | "all">("all");
  const [source, setSource]     = useState<"api" | "chain">("api");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const rows = await api.listings(
        { status: "active", rarity: filter === "all" ? undefined : filter },
        signal,
      );
      if (!signal?.aborted) { setListings(rows); setSource("api"); }
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof ApiUnavailableError && wallet.provider) {
        try {
          const rows = await fetchListingsFromChain(wallet, filter);
          if (!signal?.aborted) { setListings(rows); setSource("chain"); }
        } catch (e: any) {
          if (!signal?.aborted) setError(e.message ?? String(e));
        }
      } else if (!signal?.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [wallet, filter]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const visible = useMemo(() => listings, [listings]);

  async function buy(l: ListingRow) {
    if (!wallet.signer) return;
    const market = new Contract(ADDRESSES.Marketplace, MARKET_ABI, wallet.signer);
    const id = txPending("Buying card…");
    try {
      await assertChain(wallet.provider);
      const tx = await market.buyCard(l.tokenId, { value: parseEther(l.price) });
      await tx.wait();
      txSuccess(id, "Purchased!");
      // Poll until indexer marks the listing sold.
      try {
        await pollUntil(
          () => api.listings({ status: "active" }),
          rows => !rows.some(r => r.tokenId === l.tokenId),
          { attempts: 8, intervalMs: 1500 },
        );
      } catch { /* indexer lag — the load() below still updates the UI */ }
      await load();
    } catch (e) { txError(id, e); }
  }

  async function cancel(l: ListingRow) {
    if (!wallet.signer) return;
    const market = new Contract(ADDRESSES.Marketplace, MARKET_ABI, wallet.signer);
    const id = txPending("Cancelling listing…");
    try {
      await assertChain(wallet.provider);
      const tx = await market.cancelListing(l.tokenId);
      await tx.wait();
      txSuccess(id, "Cancelled");
      try {
        await pollUntil(
          () => api.listings({ status: "active" }),
          rows => !rows.some(r => r.tokenId === l.tokenId),
          { attempts: 8, intervalMs: 1500 },
        );
      } catch { /* indexer lag — the load() below still updates the UI */ }
      await load();
    } catch (e) { txError(id, e); }
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-white">Marketplace</h2>
        <button
          onClick={() => load()}
          disabled={loading}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded-lg text-sm transition"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <p className="text-gray-400 text-sm mb-6">
        {listings.length} active listing{listings.length === 1 ? "" : "s"}
        {source === "chain" && listings.length > 0 && (
          <span className="ml-2 text-yellow-500">(reading from chain — backend unavailable)</span>
        )}
        {!apiConfigured && <span className="ml-2 text-yellow-500">(API not configured)</span>}
      </p>

      <div className="flex gap-2 mb-6 flex-wrap">
        {RARITY_FILTERS.map(r => (
          <button
            key={r}
            onClick={() => setFilter(r)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition ${
              filter === r
                ? "bg-indigo-600 text-white"
                : `bg-gray-800 ${r === "all" ? "text-gray-400" : RARITY_COLORS[RARITY_INDEX[r as Rarity]]} hover:bg-gray-700`
            }`}
          >
            {r === "all" ? "All" : RARITY_LABEL[r as Rarity]}
          </button>
        ))}
      </div>

      {error && <p className="text-red-400">{error}</p>}
      {loading && listings.length === 0 && <SkeletonGrid />}

      {!loading && visible.length === 0 && !error && (
        <p className="text-gray-500">No active listings. List one from your Inventory!</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {visible.map(l => {
          const card = l.card!;
          const rIdx = RARITY_INDEX[card.rarity];
          const isMine = wallet.address?.toLowerCase() === l.seller.toLowerCase();
          return (
            <div
              key={l.id}
              className={`bg-gray-800 rounded-xl overflow-hidden border-2 transition ${
                isMine ? "border-emerald-600/60" : "border-gray-700 hover:border-indigo-500"
              } ${RARITY_GLOW[rIdx] ? `shadow-lg ${RARITY_GLOW[rIdx]}` : ""}`}
            >
              <img
                src={safeImageUrl(card.imageURI)}
                alt={card.name}
                loading="lazy"
                className="w-full h-32 object-contain bg-gray-900 p-2"
                onError={(e) => { (e.target as HTMLImageElement).src = PLACEHOLDER_IMG; }}
              />
              <div className="p-3">
                <div className="flex justify-between items-start mb-1">
                  <p className="text-white font-bold text-sm truncate">{card.name}</p>
                  <p className={`text-[11px] font-semibold ${RARITY_COLORS[rIdx]} shrink-0`}>
                    {RARITY_LABEL[card.rarity]}
                  </p>
                </div>
                <p className="text-gray-400 text-xs">HP {card.hp} · #{l.tokenId}</p>
                <p className="text-gray-500 text-[11px] mt-0.5">Floor {card.floorPrice} ETH</p>
                <p className="text-white font-bold mt-1">{l.price} ETH</p>
                <p className="text-gray-500 text-[11px] mb-3 truncate">
                  by {l.seller.slice(0, 6)}…{l.seller.slice(-4)}
                  {isMine && <span className="ml-1 text-emerald-400">(you)</span>}
                </p>
                {isMine ? (
                  <button
                    onClick={() => cancel(l)}
                    className="w-full py-2 bg-gray-700 hover:bg-red-600 text-white rounded-lg text-sm transition"
                  >
                    Cancel Listing
                  </button>
                ) : (
                  <button
                    onClick={() => buy(l)}
                    disabled={!wallet.address}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm transition"
                  >
                    Buy
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── On-chain fallback ─────────────────────────────────────────────────────────

async function fetchListingsFromChain(wallet: WalletState, filter: Rarity | "all"): Promise<ListingRow[]> {
  if (!wallet.provider) return [];
  const market = new Contract(ADDRESSES.Marketplace, MARKET_ABI, wallet.provider);
  const rarityNames: Rarity[] = ["Common", "Uncommon", "Rare", "UltraRare", "Legendary"];

  const out: ListingRow[] = [];
  await Promise.allSettled(
    Array.from({ length: 200 }, (_, i) => i).map(async (id) => {
      try {
        const d = await market.getListingWithDetails(id);
        if (d.seller === "0x0000000000000000000000000000000000000000" || d.price === 0n) return;
        const rarity = rarityNames[Number(d.rarity)];
        if (filter !== "all" && rarity !== filter) return;
        out.push({
          id,
          tokenId: id,
          cardId:  Number(d.cardId),
          seller:  d.seller.toLowerCase(),
          price:   formatEther(d.price),
          status:  "active",
          listedAt: new Date(0).toISOString(),
          soldAt:  null,
          buyer:   null,
          txHash:  "",
          card: {
            id:            Number(d.cardId),
            name:          d.name,
            rarity,
            pokemonType:   "",
            hp:            Number(d.hp),
            attack:        "",
            maxSupply:     0,
            currentSupply: 0,
            floorPrice:    formatEther(d.suggestedPrice),
            imageURI:      d.imageURI,
            createdAt:     "",
          },
        });
      } catch { /* tokenId not listed / can't be read — skip it */ }
    }),
  );
  out.sort((a, b) => a.tokenId - b.tokenId);
  return out;
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-gray-800 rounded-xl h-64 animate-pulse" />
      ))}
    </div>
  );
}
