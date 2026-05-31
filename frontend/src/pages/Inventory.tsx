import { useState } from "react";
import { Contract } from "ethers";
import type { WalletState } from "../hooks/useWallet";
import { ADDRESSES, NFT_ABI, RARITY_NAMES, RARITY_COLORS } from "../config/contracts";

interface Props { wallet: WalletState; }

interface Card {
  tokenId: bigint;
  name: string;
  rarity: number;
  pokemonType: string;
  hp: number;
  imageURI: string;
}

export function Inventory({ wallet }: Props) {
  const [cards, setCards]   = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded]   = useState(false);

  async function load() {
    if (!wallet.signer || !wallet.address) return;
    const nft = new Contract(ADDRESSES.PokemonCardNFT, NFT_ABI, wallet.signer);
    setLoading(true);
    try {
      const bal = Number(await nft.balanceOf(wallet.address));
      // Read token IDs sequentially (simple approach — production would use events)
      const totalSupply = await wallet.provider!.getStorage(ADDRESSES.PokemonCardNFT, 0)
        .catch(() => null);
      void totalSupply; // not used directly

      const results: Card[] = [];
      // Scan token IDs 0..1000 to find owned tokens
      const checks = Array.from({ length: Math.min(bal * 5 + 50, 500) }, (_, i) => i);
      await Promise.allSettled(
        checks.map(async (id) => {
          try {
            const owner = await nft.ownerOf(id);
            if (owner.toLowerCase() === wallet.address!.toLowerCase()) {
              const c = await nft.getCard(id);
              results.push({
                tokenId: BigInt(id),
                name: c.name,
                rarity: Number(c.rarity),
                pokemonType: c.pokemonType,
                hp: Number(c.hp),
                imageURI: c.imageURI,
              });
            }
          } catch {}
        })
      );
      results.sort((a, b) => Number(a.tokenId - b.tokenId));
      setCards(results.slice(0, bal));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">My Inventory</h2>
        {wallet.address && (
          <button
            onClick={load}
            disabled={loading}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition"
          >
            {loading ? "Loading…" : "Load Cards"}
          </button>
        )}
      </div>

      {!wallet.address && <p className="text-yellow-400">Connect your wallet first.</p>}
      {loaded && cards.length === 0 && <p className="text-gray-500">No cards found. Open a pack!</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {cards.map((card) => (
          <div key={String(card.tokenId)} className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 hover:border-indigo-500 transition">
            <img
              src={card.imageURI}
              alt={card.name}
              className="w-full h-28 object-contain bg-gray-900 p-1"
              onError={(e) => { (e.target as HTMLImageElement).src = "https://via.placeholder.com/120?text=?"; }}
            />
            <div className="p-2">
              <p className="text-white text-xs font-bold truncate">{card.name}</p>
              <p className="text-gray-400 text-xs">{card.pokemonType} · HP {card.hp}</p>
              <p className={`text-xs font-semibold mt-1 ${RARITY_COLORS[card.rarity]}`}>
                {RARITY_NAMES[card.rarity]}
              </p>
              <p className="text-gray-600 text-xs mt-1">#{String(card.tokenId)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
