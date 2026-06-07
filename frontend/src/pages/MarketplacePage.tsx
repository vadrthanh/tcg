// Marketplace — active listings with buy/cancel. Reads /api/listings (one call),
// falls back to scanning getListingWithDetails on-chain. Writes go straight to
// the chain; after each tx confirms we poll the API until the indexer reflects it.

import { useCallback, useEffect, useState } from "react";
import { Contract, parseEther, formatEther } from "ethers";
import type { WalletState } from "../hooks/useWallet";
import type { ListingRow, Rarity } from "../lib/types";
import { ADDRESSES, MARKET_ABI } from "../config/contracts";
import { RARITY_BY_INDEX } from "../lib/tokens";
import { api, ApiUnavailableError, pollUntil } from "../lib/api";
import { assertChain } from "../lib/assertChain";
import { PageHead } from "../components/PageHead";
import { RarityFilter } from "../components/RarityFilter";
import { CreatureCard } from "../components/CreatureCard";
import { Btn } from "../components/ui/Btn";
import { txPending, txSuccess, txError } from "../components/TxToast";

interface Props { wallet: WalletState; }

export function MarketplacePage({ wallet }: Props) {
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [filter, setFilter]     = useState<Rarity | "all">("all");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const rows = await api.listings({ status: "active", rarity: filter === "all" ? undefined : filter }, signal);
      if (!signal?.aborted) setListings(rows);
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof ApiUnavailableError && wallet.provider) {
        try { const rows = await fetchListingsFromChain(wallet, filter); if (!signal?.aborted) setListings(rows); }
        catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : String(e)); }
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

  async function buy(l: ListingRow) {
    if (!wallet.signer) return;
    const market = new Contract(ADDRESSES.Marketplace, MARKET_ABI, wallet.signer);
    const id = txPending("Buying card…");
    try {
      await assertChain(wallet.provider);
      const provider = wallet.signer.provider!;
      const value = parseEther(l.price);

      // Estimate gas up front. When the wallet can't cover value + gas, the wallet's
      // eth_estimateGas fails — and ethers only maps "insufficient funds" for send
      // methods, so for estimateGas it surfaces as the cryptic "could not coalesce
      // error". Swallow that here and let the affordability check below give a clear
      // message; a genuine contract revert (CALL_EXCEPTION) is surfaced as-is.
      let gasLimit = 300_000n;
      try {
        gasLimit = (await market.buyCard.estimateGas(l.tokenId, { value })) * 12n / 10n;
      } catch (est) {
        if ((est as { code?: string })?.code === "CALL_EXCEPTION") throw est;
      }

      // Pre-flight: must cover price + gas, not just price. A wallet holding ~exactly
      // the listing price passes a price-only check, then dies in gas estimation.
      const [bal, fee] = await Promise.all([provider.getBalance(wallet.signer.address), provider.getFeeData()]);
      const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
      const needed = value + gasLimit * gasPrice;
      if (bal < needed) {
        throw new Error(`Need ~${formatEther(needed)} ETH (price + gas) but wallet holds ${formatEther(bal)} ETH. Top up from a Sepolia faucet.`);
      }

      // Pass an explicit gasLimit so the send doesn't re-estimate (another coalesce vector).
      const tx = await market.buyCard(l.tokenId, { value, gasLimit });
      await tx.wait();
      txSuccess(id, "Purchased!");
      try { await pollUntil(() => api.listings({ status: "active" }), rows => !rows.some(r => r.tokenId === l.tokenId), { attempts: 8, intervalMs: 1500 }); } catch { /* indexer lag — UI still refreshes */ }
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
      try { await pollUntil(() => api.listings({ status: "active" }), rows => !rows.some(r => r.tokenId === l.tokenId), { attempts: 8, intervalMs: 1500 }); } catch { /* indexer lag — UI still refreshes */ }
      await load();
    } catch (e) { txError(id, e); }
  }

  return (
    <div className="screen">
      <PageHead title="Marketplace" sub={`${listings.length} active listing${listings.length === 1 ? "" : "s"} · 2.5% royalty to holders on every sale.`}
        right={<Btn kind="ghost" size="sm" icon="refresh" disabled={loading} onClick={() => load()}>{loading ? "Loading…" : "Refresh"}</Btn>} />
      <RarityFilter filter={filter} setFilter={setFilter} />
      {error && <p style={{ color: "#f87171" }}>{error}</p>}

      {loading && listings.length === 0 ? (
        <div className="cgrid">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="panel" style={{ height: 300, opacity: 0.5 }} />)}</div>
      ) : listings.length === 0 ? (
        <div className="empty panel"><p>No active listings. List one from your Inventory!</p></div>
      ) : (
        <div className="cgrid">
          {listings.map(l => {
            const isMine = wallet.address?.toLowerCase() === l.seller.toLowerCase();
            return (
              <CreatureCard key={l.id} card={l.card!} tokenId={l.tokenId}
                footer={<span className="mkt-price mono">◇ {l.price}</span>}>
                <div className="row gap-8" style={{ marginTop: 11, justifyContent: "space-between", alignItems: "center" }}>
                  <span className="faint mono" style={{ fontSize: 11 }}>
                    {l.seller.slice(0, 6)}…{l.seller.slice(-4)}{isMine && " (you)"}
                  </span>
                  {isMine
                    ? <Btn kind="ghost" size="sm" onClick={() => cancel(l)}>Cancel</Btn>
                    : <Btn kind="primary" size="sm" icon="coin" disabled={!wallet.address} onClick={() => buy(l)}>Buy</Btn>}
                </div>
              </CreatureCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

// On-chain fallback — scan the first 200 token IDs for live listings.
async function fetchListingsFromChain(wallet: WalletState, filter: Rarity | "all"): Promise<ListingRow[]> {
  if (!wallet.provider) return [];
  const market = new Contract(ADDRESSES.Marketplace, MARKET_ABI, wallet.provider);
  const out: ListingRow[] = [];
  await Promise.allSettled(Array.from({ length: 200 }, (_, i) => i).map(async (id) => {
    try {
      const d = await market.getListingWithDetails(id);
      if (d.seller === "0x0000000000000000000000000000000000000000" || d.price === 0n) return;
      const rarity = RARITY_BY_INDEX[Number(d.rarity)];
      if (filter !== "all" && rarity !== filter) return;
      out.push({
        id, tokenId: id, cardId: Number(d.cardId), seller: d.seller.toLowerCase(),
        price: formatEther(d.price), status: "active", listedAt: new Date(0).toISOString(),
        soldAt: null, buyer: null, txHash: "",
        card: {
          id: Number(d.cardId), name: d.name, rarity, pokemonType: "", hp: Number(d.hp),
          attack: "", maxSupply: 0, currentSupply: 0, floorPrice: formatEther(d.suggestedPrice),
          imageURI: d.imageURI, createdAt: "",
        },
      });
    } catch { /* token id not listed / not minted */ }
  }));
  out.sort((a, b) => a.tokenId - b.tokenId);
  return out;
}
