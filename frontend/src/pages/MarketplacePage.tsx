import { useState } from "react";
import { Contract, parseEther, formatEther } from "ethers";
import type { WalletState } from "../hooks/useWallet";
import { ADDRESSES, MARKET_ABI, NFT_ABI, RARITY_NAMES, RARITY_COLORS } from "../config/contracts";
import { txPending, txSuccess, txError } from "../components/TxToast";

interface Props { wallet: WalletState; }

interface ListingDetail {
  tokenId: number;
  seller: string;
  price: bigint;
  name: string;
  rarity: number;
  hp: number;
  imageURI: string;
  cardId: number;
  suggestedPrice: bigint;
}

export function MarketplacePage({ wallet }: Props) {
  const [listings, setListings]   = useState<ListingDetail[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listTokenId, setListTokenId] = useState("");
  const [listPrice, setListPrice]   = useState("");

  async function loadListings() {
    if (!wallet.signer) return;
    const market = new Contract(ADDRESSES.Marketplace, MARKET_ABI, wallet.signer);
    setLoadingList(true);
    try {
      const results: ListingDetail[] = [];
      // Scan first 200 token IDs for active listings
      await Promise.allSettled(
        Array.from({ length: 200 }, (_, i) => i).map(async (id) => {
          try {
            const d = await market.getListingWithDetails(id);
            if (d.seller !== "0x0000000000000000000000000000000000000000" && d.price > 0n) {
              results.push({
                tokenId: id,
                seller: d.seller,
                price: d.price,
                name: d.name,
                rarity: Number(d.rarity),
                hp: Number(d.hp),
                imageURI: d.imageURI,
                cardId: Number(d.cardId),
                suggestedPrice: d.suggestedPrice,
              });
            }
          } catch {}
        })
      );
      results.sort((a, b) => a.tokenId - b.tokenId);
      setListings(results);
    } finally {
      setLoadingList(false);
    }
  }

  async function listCard() {
    if (!wallet.signer || !listTokenId || !listPrice) return;
    const nft    = new Contract(ADDRESSES.PokemonCardNFT, NFT_ABI, wallet.signer);
    const market = new Contract(ADDRESSES.Marketplace, MARKET_ABI, wallet.signer);
    const id = txPending("Approving marketplace…");
    try {
      const approveTx = await nft.approve(ADDRESSES.Marketplace, Number(listTokenId));
      await approveTx.wait();
      txSuccess(id, "Approved!");

      const id2 = txPending("Listing card…");
      const listTx = await market.listCard(Number(listTokenId), parseEther(listPrice));
      await listTx.wait();
      txSuccess(id2, "Card listed!");
      setListTokenId(""); setListPrice("");
      loadListings();
    } catch (e) { txError(id, e); }
  }

  async function buyCard(tokenId: number, price: bigint) {
    if (!wallet.signer) return;
    const market = new Contract(ADDRESSES.Marketplace, MARKET_ABI, wallet.signer);
    const id = txPending("Buying card…");
    try {
      const tx = await market.buyCard(tokenId, { value: price });
      await tx.wait();
      txSuccess(id, "Card purchased!");
      loadListings();
    } catch (e) { txError(id, e); }
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Marketplace</h2>
        <button onClick={loadListings} disabled={loadingList}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition">
          {loadingList ? "Loading…" : "Browse Listings"}
        </button>
      </div>

      {/* List a card */}
      {wallet.address && (
        <div className="bg-gray-800 rounded-xl p-4 mb-6 border border-gray-700">
          <h3 className="text-white font-semibold mb-3">List Your Card</h3>
          <div className="flex gap-3 flex-wrap">
            <input value={listTokenId} onChange={e => setListTokenId(e.target.value)}
              placeholder="Token ID" type="number"
              className="px-3 py-2 bg-gray-700 text-white rounded-lg text-sm w-28 border border-gray-600" />
            <input value={listPrice} onChange={e => setListPrice(e.target.value)}
              placeholder="Price (ETH)" type="number" step="0.001"
              className="px-3 py-2 bg-gray-700 text-white rounded-lg text-sm w-36 border border-gray-600" />
            <button onClick={listCard}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm transition">
              List
            </button>
          </div>
        </div>
      )}

      {/* Active listings */}
      {listings.length === 0 && !loadingList && (
        <p className="text-gray-500">No active listings found. Click Browse Listings to load.</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {listings.map((l) => (
          <div key={l.tokenId} className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 hover:border-indigo-500 transition">
            <img src={l.imageURI} alt={l.name}
              className="w-full h-32 object-contain bg-gray-900 p-2"
              onError={(e) => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/120?text=?"; }} />
            <div className="p-3">
              <div className="flex justify-between items-start mb-1">
                <p className="text-white font-bold text-sm">{l.name}</p>
                <p className={`text-xs font-semibold ${RARITY_COLORS[l.rarity]}`}>{RARITY_NAMES[l.rarity]}</p>
              </div>
              <p className="text-gray-400 text-xs mb-2">HP {l.hp} · #{l.tokenId}</p>
              {l.suggestedPrice > 0n && (
                <p className="text-gray-500 text-xs">Floor: {formatEther(l.suggestedPrice)} ETH</p>
              )}
              <p className="text-white font-bold mt-1">{formatEther(l.price)} ETH</p>
              <p className="text-gray-500 text-xs mb-3 truncate">by {l.seller.slice(0,10)}…</p>
              {wallet.address?.toLowerCase() !== l.seller.toLowerCase() ? (
                <button onClick={() => buyCard(l.tokenId, l.price)}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm transition">
                  Buy
                </button>
              ) : (
                <p className="text-gray-500 text-xs">Your listing</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
