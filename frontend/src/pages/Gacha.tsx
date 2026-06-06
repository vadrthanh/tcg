import { useState } from "react";
import { Contract, formatEther } from "ethers";
import type { WalletState } from "../hooks/useWallet";
import { ADDRESSES, GACHA_ABI, NFT_ABI } from "../config/contracts";
import { api, pollUntil } from "../lib/api";
import { CardFlip } from "../components/CardFlip";
import { txPending, txSuccess, txError } from "../components/TxToast";

interface Props { wallet: WalletState; }

interface CardData {
  tokenId: bigint;
  name: string;
  rarity: number;
  pokemonType: string;
  hp: number;
  imageURI: string;
}

export function Gacha({ wallet }: Props) {
  const [cards, setCards]       = useState<CardData[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [packPrice, setPackPrice] = useState<string>("0.01");

  async function openPack() {
    if (!wallet.signer) return;
    const gacha = new Contract(ADDRESSES.GachaPack, GACHA_ABI, wallet.signer);
    const nft   = new Contract(ADDRESSES.PokemonCardNFT, NFT_ABI, wallet.signer);

    setLoading(true);
    setCards([]);
    setRevealed(false);

    const toastId = txPending("Opening pack…");
    try {
      const price = await gacha.packPrice();
      setPackPrice(formatEther(price));
      const tx = await gacha.openPack({ value: price });
      const receipt = await tx.wait();

      // Parse PackOpened event
      const iface = gacha.interface;
      const log = receipt.logs
        .map((l: any) => { try { return iface.parseLog(l); } catch { return null; } })
        .find((e: any) => e?.name === "PackOpened");

      if (log) {
        const tokenIds: bigint[] = log.args.tokenIds;
        const cardData = await Promise.all(
          tokenIds.map(async (tid) => {
            const c = await nft.getCard(tid);
            return {
              tokenId: tid,
              name: c.name,
              rarity: Number(c.rarity),
              pokemonType: c.pokemonType,
              hp: Number(c.hp),
              imageURI: c.imageURI,
            };
          })
        );
        setCards(cardData);
      }

      txSuccess(toastId, "Pack opened!");
      // Delay reveal for dramatic effect
      setTimeout(() => setRevealed(true), 600);

      // Best-effort: wait for the indexer to see at least one of the new tokenIds
      // so Inventory/Collection immediately reflect the new mint on next visit.
      // Fire-and-forget — UI stays responsive even if the API is unreachable.
      if (wallet.address && log) {
        const newIds = new Set((log.args.tokenIds as bigint[]).map(t => Number(t)));
        pollUntil(
          () => api.nftsByOwner(wallet.address!),
          rows => rows.some(r => newIds.has(r.tokenId)),
          { attempts: 6, intervalMs: 2000 },
        ).catch(() => {});
      }
    } catch (e) {
      txError(toastId, e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <h2 className="text-2xl font-bold text-white mb-2">Open a Pack</h2>
      <p className="text-gray-400 mb-6">Pay {packPrice} ETH · receive 5 random Pokémon cards</p>

      {!wallet.address ? (
        <p className="text-yellow-400">Connect your wallet first.</p>
      ) : (
        <button
          onClick={openPack}
          disabled={loading}
          className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl transition mb-8"
        >
          {loading ? "Opening…" : "⚡ Open Pack"}
        </button>
      )}

      {cards.length > 0 && (
        <>
          <p className="text-gray-400 text-sm mb-4">
            {revealed ? "Click each card to flip!" : "Preparing your cards…"}
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            {cards.map((card, i) => (
              <div key={i} style={{ animationDelay: `${i * 150}ms` }}>
                <CardFlip card={card} revealed={revealed} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
