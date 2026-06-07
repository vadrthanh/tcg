import { useState } from "react";
import { Toaster } from "react-hot-toast";
import { useWallet } from "./hooks/useWallet";
import { CONFIG_OK, MISSING_ADDRESS_VARS } from "./config/contracts";
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

  // If any contract address in .env is missing or malformed, show a clear setup
  // screen instead of letting the pages crash with a cryptic decode error.
  if (!CONFIG_OK) {
    return <ConfigErrorScreen />;
  }

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

// Shown when a contract address in .env is missing or malformed. Prevents a blank
// screen / cryptic decode error and tells the user exactly what to fill in.
function ConfigErrorScreen() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-4">
      <div className="max-w-lg bg-gray-900 border border-yellow-600/50 rounded-xl p-6">
        <h1 className="text-xl font-bold text-yellow-400 mb-2">⚠ Contract addresses not configured</h1>
        <p className="text-gray-300 text-sm mb-4">
          The following variables in <code className="text-indigo-300">frontend/.env</code> are empty
          or malformed. Fill in the addresses deployed to Sepolia
          (from <code className="text-indigo-300">contracts/deploy/addresses.json</code>), then restart{" "}
          <code className="text-indigo-300">npm run dev</code>.
        </p>
        <ul className="bg-gray-950 rounded-lg p-3 text-sm font-mono text-yellow-300 space-y-1 mb-4">
          {MISSING_ADDRESS_VARS.map(v => (
            <li key={v}>• {v}</li>
          ))}
        </ul>
        <p className="text-gray-500 text-xs">
          This is not a frontend code bug — there is simply no contract address to call yet.
        </p>
      </div>
    </div>
  );
}
