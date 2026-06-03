import { useState } from "react";
import { Toaster } from "react-hot-toast";
import { useWallet } from "./hooks/useWallet";
import { Connect } from "./pages/Connect";
import { Gacha } from "./pages/Gacha";
import { Collection } from "./pages/Collection";
import { Inventory } from "./pages/Inventory";
import { MarketplacePage } from "./pages/MarketplacePage";
import { RoyaltyDashboard } from "./pages/RoyaltyDashboard";

type Page = "connect" | "gacha" | "collection" | "inventory" | "marketplace" | "royalty";

const NAV: { id: Page; label: string }[] = [
  { id: "connect",     label: "🔌 Connect" },
  { id: "gacha",       label: "⚡ Gacha" },
  { id: "collection",  label: "📚 Collection" },
  { id: "inventory",   label: "🃏 Inventory" },
  { id: "marketplace", label: "🏪 Marketplace" },
  { id: "royalty",     label: "💰 Royalties" },
];

export default function App() {
  const wallet = useWallet();
  const [page, setPage] = useState<Page>("connect");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      <Toaster position="top-right" />

      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <span className="text-white font-bold text-lg">🎴 Pokémon TCG NFT</span>
          {wallet.address && (
            <span className="text-xs text-gray-400 font-mono bg-gray-800 px-3 py-1 rounded-full">
              {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
              {wallet.chainOk
                ? <span className="ml-2 text-green-400">Sepolia</span>
                : <span className="ml-2 text-yellow-400">Wrong network</span>}
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="max-w-5xl mx-auto px-4 pb-2 flex gap-1 overflow-x-auto">
          {NAV.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                page === id
                  ? "bg-indigo-600 text-white"
                  : "text-gray-400 hover:text-white hover:bg-gray-800"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {/* Page content */}
      <main className="max-w-5xl mx-auto">
        {page === "connect"     && <Connect    wallet={wallet} />}
        {page === "gacha"       && <Gacha      wallet={wallet} />}
        {page === "collection"  && <Collection wallet={wallet} />}
        {page === "inventory"   && <Inventory  wallet={wallet} />}
        {page === "marketplace" && <MarketplacePage   wallet={wallet} />}
        {page === "royalty"     && <RoyaltyDashboard  wallet={wallet} />}
      </main>
    </div>
  );
}
