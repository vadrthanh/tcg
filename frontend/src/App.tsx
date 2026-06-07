import { useEffect, useState } from "react";
import { formatEther } from "ethers";
import { Toaster } from "react-hot-toast";
import { useWallet } from "./hooks/useWallet";
import { Icon, type IconName } from "./components/ui/Icon";
import { Btn } from "./components/ui/Btn";
import { CardModal } from "./components/CardModal";
import type { CardRow } from "./lib/types";
import { Home } from "./pages/Home";
import { Gacha } from "./pages/Gacha";
import { Collection } from "./pages/Collection";
import { Inventory } from "./pages/Inventory";
import { MarketplacePage } from "./pages/MarketplacePage";
import { RoyaltyDashboard } from "./pages/RoyaltyDashboard";

export type Page = "home" | "gacha" | "collection" | "inventory" | "marketplace" | "royalty";

const NAV: { id: Page; label: string; icon: IconName }[] = [
  { id: "home",        label: "Home",       icon: "home" },
  { id: "gacha",       label: "Packs",      icon: "bolt" },
  { id: "collection",  label: "Collection", icon: "grid" },
  { id: "inventory",   label: "Inventory",  icon: "cards" },
  { id: "marketplace", label: "Market",     icon: "store" },
  { id: "royalty",     label: "Royalties",  icon: "coin" },
];

export default function App() {
  const wallet = useWallet();
  const [page, setPage] = useState<Page>("home");
  const [modal, setModal] = useState<{ card: CardRow; owned: boolean } | null>(null);
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    if (!wallet.provider || !wallet.address) { setBalance(null); return; }
    let live = true;
    wallet.provider.getBalance(wallet.address)
      .then(b => { if (live) setBalance(Number(formatEther(b)).toFixed(3)); })
      .catch(() => { if (live) setBalance(null); });
    return () => { live = false; };
  }, [wallet.provider, wallet.address]);

  function go(p: Page) { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function openModal(card: CardRow, owned = false) { setModal({ card, owned }); }
  const short = wallet.address ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : "";

  return (
    <div className="app">
      <Toaster position="top-right" />

      <header className="topbar">
        <div className="topbar-in">
          <div className="brand" onClick={() => go("home")}>
            <span className="brand-mark"><span className="brand-gem" /></span>
            <span className="brand-name">Poké<span className="faint">desk</span></span>
          </div>

          <nav className="nav">
            {NAV.map(n => (
              <button key={n.id} title={n.label} className={`navi${page === n.id ? " active" : ""}`} onClick={() => go(n.id)}>
                <Icon name={n.icon} size={17} /><span>{n.label}</span>
              </button>
            ))}
          </nav>

          <div className="topbar-r">
            {!wallet.address ? (
              <Btn kind="primary" icon="wallet" onClick={wallet.connect}>Connect</Btn>
            ) : !wallet.chainOk ? (
              <Btn kind="outline" size="sm" onClick={wallet.switchToSepolia}>Switch to Sepolia</Btn>
            ) : (
              <div className="wallet-pill">
                {balance != null && <span className="wallet-bal mono">◇ {balance}</span>}
                <span className="wallet-addr mono">{short}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <nav className="nav-mobile">
        {NAV.map(n => (
          <button key={n.id} className={`navm${page === n.id ? " active" : ""}`} onClick={() => go(n.id)}>
            <Icon name={n.icon} size={19} /><span>{n.label}</span>
          </button>
        ))}
      </nav>

      <main className="content">
        {page === "home"        && <Home wallet={wallet} go={go} />}
        {page === "gacha"       && <Gacha wallet={wallet} />}
        {page === "collection"  && <Collection wallet={wallet} onOpen={openModal} />}
        {page === "inventory"   && <Inventory wallet={wallet} go={go} />}
        {page === "marketplace" && <MarketplacePage wallet={wallet} />}
        {page === "royalty"     && <RoyaltyDashboard wallet={wallet} />}
      </main>

      {modal && (
        <CardModal
          card={modal.card}
          owned={modal.owned}
          onClose={() => setModal(null)}
          onPrimary={() => { setModal(null); go("gacha"); }}
          primaryLabel="Find in packs"
        />
      )}
    </div>
  );
}
