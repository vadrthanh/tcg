import { useEffect, useState } from "react";
import { Contract, formatEther } from "ethers";
import { Toaster } from "react-hot-toast";
import { useWallet } from "./hooks/useWallet";
import { useTheme } from "./hooks/useTheme";
import { ADDRESSES, NFT_ABI } from "./config/contracts";
import { Icon, type IconName } from "./components/ui/Icon";
import { Btn } from "./components/ui/Btn";
import { CardModal } from "./components/CardModal";
import { WalletPicker } from "./components/WalletPicker";
import { WalletMenu } from "./components/WalletMenu";
import type { CardRow } from "./lib/types";
import { Home } from "./pages/Home";
import { Gacha } from "./pages/Gacha";
import { Collection } from "./pages/Collection";
import { Inventory } from "./pages/Inventory";
import { MarketplacePage } from "./pages/MarketplacePage";
import { RoyaltyDashboard } from "./pages/RoyaltyDashboard";
import { AdminAddCard } from "./pages/AdminAddCard";

export type Page = "home" | "gacha" | "collection" | "inventory" | "marketplace" | "royalty" | "admin";

const NAV: { id: Page; label: string; icon: IconName }[] = [
  { id: "home",        label: "Home",       icon: "home" },
  { id: "gacha",       label: "Packs",      icon: "bolt" },
  { id: "collection",  label: "Collection", icon: "grid" },
  { id: "inventory",   label: "Inventory",  icon: "cards" },
  { id: "marketplace", label: "Market",     icon: "store" },
  { id: "royalty",     label: "Royalties",  icon: "coin" },
];

const ADMIN_NAV: { id: Page; label: string; icon: IconName } = { id: "admin", label: "Add Card", icon: "plus" };

export default function App() {
  const wallet = useWallet();
  const { theme, toggle: toggleTheme } = useTheme();
  const [page, setPage] = useState<Page>("home");
  const [modal, setModal] = useState<{ card: CardRow; owned: boolean } | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Reveal the admin "Add Card" tab only for the wallet that holds
  // POOL_MANAGER_ROLE (the deployer). The page re-checks before any write.
  useEffect(() => {
    if (!wallet.provider || !wallet.address || !wallet.chainOk) { setIsAdmin(false); return; }
    let live = true;
    (async () => {
      try {
        const nft  = new Contract(ADDRESSES.PokemonCardNFT, NFT_ABI, wallet.provider!);
        const role = await nft.POOL_MANAGER_ROLE();
        const ok   = await nft.hasRole(role, wallet.address!);
        if (live) setIsAdmin(Boolean(ok));
      } catch { if (live) setIsAdmin(false); }
    })();
    return () => { live = false; };
  }, [wallet.provider, wallet.address, wallet.chainOk]);

  const nav = isAdmin ? [...NAV, ADMIN_NAV] : NAV;

  useEffect(() => {
    if (!wallet.provider || !wallet.address) { setBalance(null); return; }
    let live = true;
    wallet.provider.getBalance(wallet.address)
      .then(b => { if (live) setBalance(Number(formatEther(b)).toFixed(3)); })
      .catch(() => { if (live) setBalance(null); });
    return () => { live = false; };
  }, [wallet.provider, wallet.address]);

  // If the admin tab is open and the wallet loses the role (disconnect / switch
  // account), fall back to Home so the gated page can't linger.
  useEffect(() => { if (page === "admin" && !isAdmin) setPage("home"); }, [page, isAdmin]);

  function go(p: Page) { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function openModal(card: CardRow, owned = false) { setModal({ card, owned }); }

  return (
    <div className="app">
      {/* Offset below the 64px sticky topbar so toasts don't overlap the wallet/nav. */}
      <Toaster position="top-right" containerStyle={{ top: 76 }} />

      <header className="topbar">
        <div className="topbar-in">
          <div className="brand" onClick={() => go("home")}>
            <span className="brand-mark"><span className="brand-gem" /></span>
            <span className="brand-name">Poké<span className="faint">desk</span></span>
          </div>

          <nav className="nav">
            {nav.map(n => (
              <button key={n.id} title={n.label} className={`navi${page === n.id ? " active" : ""}`} onClick={() => go(n.id)}>
                <Icon name={n.icon} size={17} /><span>{n.label}</span>
              </button>
            ))}
          </nav>

          <div className="topbar-r">
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
            </button>
            {!wallet.address ? (
              <Btn kind="primary" icon="wallet" onClick={wallet.connect}>Connect</Btn>
            ) : !wallet.chainOk ? (
              <Btn kind="outline" size="sm" onClick={wallet.switchToSepolia}>Switch to Sepolia</Btn>
            ) : (
              <WalletMenu address={wallet.address} balance={balance} onDisconnect={wallet.disconnect} />
            )}
          </div>
        </div>
      </header>

      <nav className="nav-mobile">
        {nav.map(n => (
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
        {page === "admin"       && <AdminAddCard wallet={wallet} />}
      </main>

      {wallet.pickerOpen && (
        <WalletPicker
          wallets={wallet.wallets}
          onSelect={wallet.selectWallet}
          onClose={wallet.closePicker}
        />
      )}

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
