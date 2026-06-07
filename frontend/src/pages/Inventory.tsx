// Inventory — the cards the connected wallet currently owns.
//
// Reads from /api/nfts?owner= (fast, indexed). Falls back to scanning ownerOf()
// on-chain if the API is down. Each card has an inline "List for Sale" flow
// that approves the marketplace and creates a listing — then polls the API
// until the indexer catches up.

import { useCallback, useEffect, useState } from "react";
import { Contract, parseEther, formatEther } from "ethers";
import type { WalletState } from "../hooks/useWallet";
import {
  ADDRESSES, NFT_ABI, MARKET_ABI,
  RARITY_COLORS, RARITY_GLOW,
} from "../config/contracts";
import { api, ApiUnavailableError, apiConfigured, pollUntil } from "../lib/api";
import { assertChain } from "../lib/assertChain";
import { safeImageUrl, PLACEHOLDER_IMG } from "../lib/safeImageUrl";
import type { MintedNFTRow, Rarity } from "../lib/types";
import { txPending, txSuccess, txError } from "../components/TxToast";
import toast from "react-hot-toast";

interface Props { wallet: WalletState; }

// Validate the user-entered price before parseEther: non-empty, a number, > 0,
// and no more than 18 decimals (the wei limit). Returns an error message, or
// null when the price is valid.
function validatePrice(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return "Please enter a price";
  const n = Number(trimmed);
  if (Number.isNaN(n)) return "Invalid price";
  if (n <= 0) return "Price must be greater than 0";
  const decimals = trimmed.includes(".") ? trimmed.split(".")[1].length : 0;
  if (decimals > 18) return "At most 18 decimal places";
  return null;
}

const RARITY_INDEX: Record<Rarity, number> = {
  Common: 0, Uncommon: 1, Rare: 2, UltraRare: 3, Legendary: 4,
};
const RARITY_LABEL: Record<Rarity, string> = {
  Common: "Common", Uncommon: "Uncommon", Rare: "Rare",
  UltraRare: "Ultra Rare", Legendary: "Legendary",
};

export function Inventory({ wallet }: Props) {
  const [nfts, setNfts]           = useState<MintedNFTRow[]>([]);
  const [activeIds, setActiveIds] = useState<Set<number>>(new Set());
  const [loading, setLoading]     = useState(false);
  const [loaded, setLoaded]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [source, setSource]       = useState<"api" | "chain">("api");

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!wallet.address || !wallet.provider) return;
    setLoading(true); setError(null);
    try {
      // 1) Owned NFTs — API first
      let rows: MintedNFTRow[];
      try {
        rows = await api.nftsByOwner(wallet.address, signal);
        setSource("api");
      } catch (err) {
        if (!(err instanceof ApiUnavailableError)) throw err;
        rows = await fetchOwnedFromChain(wallet);
        setSource("chain");
      }
      if (signal?.aborted) return;
      setNfts(rows);
      setLoaded(true);

      // 2) Which of these are currently listed — read from chain so we always
      //    show the freshest state (listings change second-by-second).
      const market = new Contract(ADDRESSES.Marketplace, MARKET_ABI, wallet.provider);
      const flags  = await Promise.all(
        rows.map(async r => {
          try {
            const [, price] = await market.listings(r.tokenId);
            return { tokenId: r.tokenId, listed: price > 0n };
          } catch { return { tokenId: r.tokenId, listed: false }; }
        }),
      );
      if (!signal?.aborted) setActiveIds(new Set(flags.filter(f => f.listed).map(f => f.tokenId)));
    } catch (err: any) {
      if (!signal?.aborted) setError(err.message ?? String(err));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    const ctrl = new AbortController();
    if (wallet.address) load(ctrl.signal);
    return () => ctrl.abort();
  }, [wallet.address, load]);

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-white">My Inventory</h2>
        <button
          onClick={() => load()}
          disabled={loading || !wallet.address}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded-lg text-sm transition"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <p className="text-gray-400 text-sm mb-6">
        {nfts.length > 0 ? `${nfts.length} cards owned` : "Your minted NFTs appear here."}
        {source === "chain" && nfts.length > 0 && (
          <span className="ml-2 text-yellow-500">(reading from chain — backend unavailable)</span>
        )}
        {!apiConfigured && <span className="ml-2 text-yellow-500">(API not configured)</span>}
      </p>

      {!wallet.address && <p className="text-yellow-400">Connect your wallet first.</p>}
      {error && <p className="text-red-400">{error}</p>}
      {loading && nfts.length === 0 && <SkeletonGrid />}
      {loaded && nfts.length === 0 && !loading && (
        <p className="text-gray-500">No cards yet. Open a pack on the Gacha page!</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {nfts.map(n => (
          <InventoryTile
            key={n.tokenId}
            nft={n}
            isListed={activeIds.has(n.tokenId)}
            wallet={wallet}
            onListed={() => load()}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Card tile with inline list-for-sale flow ──────────────────────────────────

function InventoryTile({
  nft, isListed, wallet, onListed,
}: {
  nft: MintedNFTRow;
  isListed: boolean;
  wallet: WalletState;
  onListed: () => void;
}) {
  const [open, setOpen]       = useState(false);
  const [price, setPrice]     = useState("");
  const [busy, setBusy]       = useState(false);
  const card    = nft.card!;
  const rIdx    = RARITY_INDEX[card.rarity];
  const suggest = card.floorPrice;

  async function listForSale() {
    if (!wallet.signer) return;

    // Validate the price BEFORE touching parseEther / the contract.
    const priceErr = validatePrice(price);
    if (priceErr) { toast.error(priceErr); return; }

    const nftC    = new Contract(ADDRESSES.PokemonCardNFT, NFT_ABI,    wallet.signer);
    const marketC = new Contract(ADDRESSES.Marketplace,    MARKET_ABI, wallet.signer);

    let toastId = txPending("Approving marketplace…");
    setBusy(true);
    try {
      await assertChain(wallet.provider);
      // approval might be unnecessary if setApprovalForAll was used previously
      const isApprovedAll = await nftC.isApprovedForAll(wallet.signer.address, ADDRESSES.Marketplace);
      if (!isApprovedAll) {
        const ap = await nftC.approve(ADDRESSES.Marketplace, nft.tokenId);
        await ap.wait();
      }
      txSuccess(toastId, "Approved");
      toastId = txPending("Listing card…");

      const tx = await marketC.listCard(nft.tokenId, parseEther(price));
      await tx.wait();
      txSuccess(toastId, "Listed!");

      // Wait for indexer to catch up so the marketplace page sees it.
      try {
        await pollUntil(
          () => api.listings({ status: "active" }),
          rows => rows.some(r => r.tokenId === nft.tokenId),
          { attempts: 8, intervalMs: 1500 },
        );
      } catch { /* indexer lag — fine, the UI still refreshes below */ }

      setOpen(false); setPrice("");
      onListed();
    } catch (e) {
      txError(toastId, e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`bg-gray-800 rounded-xl overflow-hidden border-2 ${RARITY_GLOW[rIdx] ? `shadow-lg ${RARITY_GLOW[rIdx]} border-current` : "border-gray-700"} transition`}>
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
        <p className={`text-[11px] font-semibold ${RARITY_COLORS[rIdx]}`}>
          {RARITY_LABEL[card.rarity]}
        </p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-gray-500">#{nft.tokenId}</span>
          {isListed && (
            <span className="text-[10px] text-emerald-400 font-semibold">LISTED</span>
          )}
        </div>

        {!open && !isListed && (
          <button
            onClick={() => setOpen(true)}
            className="w-full mt-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-md transition"
          >
            List for Sale
          </button>
        )}
        {isListed && (
          <p className="text-[10px] text-gray-500 mt-2">Manage on Marketplace.</p>
        )}

        {open && (
          <div className="mt-2 space-y-1.5">
            <input
              type="number"
              step="0.0001"
              min="0"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder={`Floor ${suggest}`}
              className="w-full px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700"
            />
            <div className="flex gap-1">
              <button
                onClick={listForSale}
                disabled={busy || !price}
                className="flex-1 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs rounded transition"
              >
                {busy ? "…" : "List"}
              </button>
              <button
                onClick={() => { setOpen(false); setPrice(""); }}
                disabled={busy}
                className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded transition"
              >
                ✕
              </button>
            </div>
            <p className="text-[10px] text-gray-500">Suggested floor: {suggest} ETH</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── On-chain fallback for owned NFTs ──────────────────────────────────────────

async function fetchOwnedFromChain(wallet: WalletState): Promise<MintedNFTRow[]> {
  if (!wallet.provider || !wallet.address) return [];
  const nft = new Contract(ADDRESSES.PokemonCardNFT, NFT_ABI, wallet.provider);
  const bal = Number(await nft.balanceOf(wallet.address));
  if (bal === 0) return [];

  // No enumerable extension on the NFT — scan a window of tokenIds.
  // 500 tokens is plenty for the demo pool (max ≈ 80 mints across all demos).
  const out: MintedNFTRow[] = [];
  const checks = Array.from({ length: 500 }, (_, i) => i);
  await Promise.allSettled(
    checks.map(async (id) => {
      try {
        const owner = await nft.ownerOf(id);
        if (owner.toLowerCase() !== wallet.address!.toLowerCase()) return;
        const c       = await nft.getCard(id);
        const cardId  = Number(await nft.tokenCardId(id));
        const tpl     = cardId > 0 ? await nft.getCardTemplate(cardId) : null;
        out.push({
          tokenId:  id,
          cardId,
          owner:    wallet.address!,
          mintedTo: wallet.address!,
          mintedAt: new Date(0).toISOString(),
          txHash:   "",
          card: {
            id:            cardId,
            name:          c.name,
            rarity:        (["Common","Uncommon","Rare","UltraRare","Legendary"] as Rarity[])[Number(c.rarity)],
            pokemonType:   c.pokemonType,
            hp:            Number(c.hp),
            attack:        tpl ? tpl.attack       : "",
            maxSupply:     tpl ? Number(tpl.maxSupply)     : 0,
            currentSupply: tpl ? Number(tpl.currentSupply) : 0,
            floorPrice:    tpl ? formatEther(tpl.floorPrice) : "0",
            imageURI:      c.imageURI,
            createdAt:     "",
          },
        });
      } catch { /* tokenId doesn't exist / can't be read — skip it */ }
    }),
  );
  out.sort((a, b) => a.tokenId - b.tokenId);
  return out.slice(0, bal);
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="bg-gray-800 rounded-xl h-52 animate-pulse" />
      ))}
    </div>
  );
}
