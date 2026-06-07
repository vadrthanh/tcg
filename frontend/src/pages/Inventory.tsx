// Inventory — cards the connected wallet owns. Reads /api/nfts?owner= (fast),
// falls back to scanning ownerOf() on-chain. Each card has an inline
// "List for sale" flow that approves the marketplace, creates a listing, then
// polls the API until the indexer catches up.

import { useCallback, useEffect, useState } from "react";
import { Contract, parseEther, formatEther } from "ethers";
import type { WalletState } from "../hooks/useWallet";
import type { Page } from "../App";
import type { MintedNFTRow, Rarity } from "../lib/types";
import toast from "react-hot-toast";
import { ADDRESSES, NFT_ABI, MARKET_ABI } from "../config/contracts";
import { api, ApiUnavailableError, pollUntil } from "../lib/api";
import { assertChain } from "../lib/assertChain";
import { RARITY_BY_INDEX } from "../lib/tokens";
import { PageHead } from "../components/PageHead";
import { NotConnected } from "../components/NotConnected";
import { CreatureCard } from "../components/CreatureCard";
import { Btn } from "../components/ui/Btn";
import { Icon } from "../components/ui/Icon";
import { txPending, txSuccess, txError } from "../components/TxToast";

interface Props { wallet: WalletState; go: (p: Page) => void; }

// Validate the user-entered list price before parseEther: non-empty, numeric,
// > 0, and at most 18 decimals (the wei limit). parseEther("-1") silently yields
// a negative bigint, so a bad value must be caught here. Returns an error
// message, or null when the price is valid.
function validatePrice(input: string): string | null {
  const t = input.trim();
  if (!t) return "Enter a price";
  const n = Number(t);
  if (!Number.isFinite(n)) return "Invalid price";
  if (n <= 0) return "Price must be greater than 0";
  const decimals = t.includes(".") ? t.split(".")[1].length : 0;
  if (decimals > 18) return "At most 18 decimal places";
  return null;
}

export function Inventory({ wallet, go }: Props) {
  const [nfts, setNfts]           = useState<MintedNFTRow[]>([]);
  const [activeIds, setActiveIds] = useState<Set<number>>(new Set());
  const [loading, setLoading]     = useState(false);
  const [loaded, setLoaded]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const connected = !!wallet.address && wallet.chainOk;

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!wallet.address || !wallet.provider) return;
    setLoading(true); setError(null);
    try {
      let rows: MintedNFTRow[];
      try {
        rows = await api.nftsByOwner(wallet.address, signal);
      } catch (err) {
        if (!(err instanceof ApiUnavailableError)) throw err;
        rows = await fetchOwnedFromChain(wallet);
      }
      if (signal?.aborted) return;
      setNfts(rows);
      setLoaded(true);

      // Which of these are currently listed — read from chain for freshest state.
      const market = new Contract(ADDRESSES.Marketplace, MARKET_ABI, wallet.provider);
      const flags  = await Promise.all(rows.map(async r => {
        try { const [, price] = await market.listings(r.tokenId); return { tokenId: r.tokenId, listed: price > 0n }; }
        catch { return { tokenId: r.tokenId, listed: false }; }
      }));
      if (!signal?.aborted) setActiveIds(new Set(flags.filter(f => f.listed).map(f => f.tokenId)));
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : String(err));
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
    <div className="screen">
      <PageHead title="My Inventory" sub="Pokémon held in your connected wallet."
        right={connected && <Btn kind="ghost" size="sm" icon="refresh" disabled={loading} onClick={() => load()}>{loading ? "Loading…" : "Refresh"}</Btn>} />

      {!connected ? (
        <NotConnected onConnect={wallet.connect} note="Connect your wallet to view your minted Pokémon." />
      ) : error ? (
        <div className="empty panel"><p style={{ color: "#f87171" }}>{error}</p></div>
      ) : loaded && nfts.length === 0 && !loading ? (
        <div className="empty panel">
          <Icon name="cards" size={26} />
          <p>No cards yet — <a onClick={() => go("gacha")}>open a pack</a> to start your collection.</p>
        </div>
      ) : loading && nfts.length === 0 ? (
        <div className="cgrid">{Array.from({ length: 10 }).map((_, i) => <div key={i} className="panel" style={{ height: 280, opacity: 0.5 }} />)}</div>
      ) : (
        <div className="cgrid">
          {nfts.map(n => (
            <InventoryTile key={n.tokenId} nft={n} isListed={activeIds.has(n.tokenId)} wallet={wallet} onListed={() => load()} />
          ))}
        </div>
      )}
    </div>
  );
}

function InventoryTile({ nft, isListed, wallet, onListed }: {
  nft: MintedNFTRow; isListed: boolean; wallet: WalletState; onListed: () => void;
}) {
  const [open, setOpen]   = useState(false);
  const [price, setPrice] = useState("");
  const [busy, setBusy]   = useState(false);
  const card    = nft.card!;
  const suggest = card.floorPrice;

  async function listForSale() {
    if (!wallet.signer) return;
    const priceErr = validatePrice(price);
    if (priceErr) { toast.error(priceErr); return; }
    const nftC    = new Contract(ADDRESSES.PokemonCardNFT, NFT_ABI,    wallet.signer);
    const marketC = new Contract(ADDRESSES.Marketplace,    MARKET_ABI, wallet.signer);
    let toastId = txPending("Approving marketplace…");
    setBusy(true);
    try {
      await assertChain(wallet.provider);
      const isApprovedAll = await nftC.isApprovedForAll(wallet.signer.address, ADDRESSES.Marketplace);
      if (!isApprovedAll) { const ap = await nftC.setApprovalForAll(ADDRESSES.Marketplace, true); await ap.wait(); }
      txSuccess(toastId, "Approved");
      toastId = txPending("Listing card…");
      const tx = await marketC.listCard(nft.tokenId, parseEther(price));
      await tx.wait();
      txSuccess(toastId, "Listed!");
      try {
        await pollUntil(() => api.listings({ status: "active" }), rows => rows.some(r => r.tokenId === nft.tokenId), { attempts: 8, intervalMs: 1500 });
      } catch { /* best-effort */ }
      setOpen(false); setPrice("");
      onListed();
    } catch (e) {
      txError(toastId, e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CreatureCard card={card} tokenId={nft.tokenId} owned
      footer={isListed ? <span className="mkt-price mono" style={{ color: "var(--accent-text)" }}>LISTED</span> : undefined}>
      {!isListed && (open ? (
        <div className="col gap-8" style={{ marginTop: 10 }}>
          <input type="number" step="0.0001" min="0" value={price} onChange={e => setPrice(e.target.value)}
            placeholder={`Floor ${suggest}`} className="inv-price-input mono" />
          <div className="row gap-8">
            <Btn kind="primary" size="sm" full disabled={busy || !price} onClick={listForSale}>{busy ? "…" : "List"}</Btn>
            <Btn kind="ghost" size="sm" disabled={busy} onClick={() => { setOpen(false); setPrice(""); }}>✕</Btn>
          </div>
          <span className="faint" style={{ fontSize: 11 }}>Suggested floor: {suggest} ETH</span>
        </div>
      ) : (
        <Btn kind="primary" size="sm" full icon="tag" className="inv-list-btn" onClick={() => setOpen(true)}>List for sale</Btn>
      ))}
    </CreatureCard>
  );
}

// On-chain fallback for owned NFTs — scans a window of tokenIds (no enumerable extension).
async function fetchOwnedFromChain(wallet: WalletState): Promise<MintedNFTRow[]> {
  if (!wallet.provider || !wallet.address) return [];
  const nft = new Contract(ADDRESSES.PokemonCardNFT, NFT_ABI, wallet.provider);
  const bal = Number(await nft.balanceOf(wallet.address));
  if (bal === 0) return [];

  const out: MintedNFTRow[] = [];
  await Promise.allSettled(Array.from({ length: 500 }, (_, i) => i).map(async (id) => {
    try {
      const owner = await nft.ownerOf(id);
      if (owner.toLowerCase() !== wallet.address!.toLowerCase()) return;
      const c      = await nft.getCard(id);
      const cardId = Number(await nft.tokenCardId(id));
      const tpl    = cardId > 0 ? await nft.getCardTemplate(cardId) : null;
      out.push({
        tokenId: id, cardId, owner: wallet.address!, mintedTo: wallet.address!,
        mintedAt: new Date(0).toISOString(), txHash: "",
        card: {
          id: cardId, name: c.name, rarity: RARITY_BY_INDEX[Number(c.rarity)] as Rarity,
          pokemonType: c.pokemonType, hp: Number(c.hp), attack: tpl ? tpl.attack : "",
          maxSupply: tpl ? Number(tpl.maxSupply) : 0, currentSupply: tpl ? Number(tpl.currentSupply) : 0,
          floorPrice: tpl ? formatEther(tpl.floorPrice) : "0", imageURI: c.imageURI, createdAt: "",
        },
      });
    } catch { /* best-effort */ }
  }));
  out.sort((a, b) => a.tokenId - b.tokenId);
  return out.slice(0, bal);
}
