import { useEffect, useState } from "react";
import { Contract, formatEther } from "ethers";
import type { WalletState } from "../hooks/useWallet";
import type { Page } from "../App";
import type { CardRow } from "../lib/types";
import { ADDRESSES, SPLITTER_ABI } from "../config/contracts";
import { RARITY, RARITY_ORDER, vars } from "../lib/tokens";
import { api } from "../lib/api";
import { Btn } from "../components/ui/Btn";
import { Stat } from "../components/ui/Stat";
import { Progress } from "../components/ui/Progress";
import { NotConnected } from "../components/NotConnected";
import { HeroCarousel } from "../components/HeroCarousel";
import { TxHistory } from "../components/TxHistory";

interface Props { wallet: WalletState; go: (p: Page) => void; }

export function Home({ wallet, go }: Props) {
  const [cards, setCards] = useState<CardRow[]>([]);
  const [ownedCardIds, setOwnedCardIds] = useState<number[]>([]);
  const [packsOpened, setPacksOpened] = useState<number | null>(null);
  const [claimable, setClaimable] = useState<string | null>(null);
  const [activeListings, setActiveListings] = useState<number | null>(null);
  const connected = !!wallet.address && wallet.chainOk;

  useEffect(() => {
    let mounted = true;
    api.cards().then(c => { if (mounted) setCards(c); }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    api.listings({ status: "active" })
      .then(rows => { if (mounted) setActiveListings(rows.length); })
      .catch(() => { if (mounted) setActiveListings(null); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!wallet.address) { setOwnedCardIds([]); setPacksOpened(null); return; }
    let mounted = true;
    api.nftsByOwner(wallet.address)
      .then(n => { if (mounted) setOwnedCardIds(n.map(x => x.cardId)); })
      .catch(() => { if (mounted) setOwnedCardIds([]); }); // clear on failure so a switched account never shows stale cards
    api.transactions({ address: wallet.address, type: "pack_opened", limit: 100 })
      .then(tx => { if (mounted) setPacksOpened(tx.length); })
      .catch(() => { if (mounted) setPacksOpened(null); });
    return () => { mounted = false; };
  }, [wallet.address]);

  useEffect(() => {
    if (!wallet.provider || !wallet.address) { setClaimable(null); return; }
    let mounted = true;
    const s = new Contract(ADDRESSES.PaymentSplitter, SPLITTER_ABI, wallet.provider);
    s.claimable(wallet.address)
      .then((b: bigint) => {
        if (!mounted) return;
        // Truncate to 4 dp via string ops — no float round-trip (project keeps ETH as strings).
        const [int, frac = ""] = formatEther(b).split(".");
        setClaimable(`${int}.${frac.padEnd(4, "0").slice(0, 4)}`);
      })
      .catch(() => { if (mounted) setClaimable(null); });
    return () => { mounted = false; };
  }, [wallet.provider, wallet.address]);

  const total = cards.length || 40;
  const ownedSet = new Set(ownedCardIds);
  const ownedCount = cards.filter(c => ownedSet.has(c.id)).length;
  const pct = Math.round((ownedCount / total) * 100);

  return (
    <div className="screen">
      <div className="hero">
        <div className="hero-glow" />
        <div className="hero-l">
          <span className="hero-eyebrow mono">POKÉMON CARD GAME · ON-CHAIN</span>
          <h1 className="hero-title">Pull. Collect.<br />Trade the set.</h1>
          <p className="hero-desc">A 40-card Pokémon set minted on Ethereum Sepolia. Open booster packs, complete your collection, and trade on the open marketplace — every sale pays royalties back to holders.</p>
          <div className="row gap-12 hero-cta">
            <Btn kind="primary" size="lg" icon="bolt" onClick={() => go("gacha")}>Open a pack</Btn>
            <Btn kind="ghost" size="lg" icon="grid" onClick={() => go("collection")}>Browse set</Btn>
          </div>
        </div>
      </div>

      <HeroCarousel cards={cards} onClick={() => go("collection")} />

      {connected ? (
        <>
          <div className="dash-stats">
            <div className="dash-stat panel">
              <div className="row gap-12" style={{ justifyContent: "space-between" }}>
                <Stat label="Collection" value={`${ownedCount} / ${total}`} sub="cards owned" />
                <div className="lvl-ring" style={vars({ "--p": pct })}>
                  <span className="lvl-ring-n mono">{pct}%</span>
                </div>
              </div>
              <div style={{ marginTop: 12 }}><Progress value={ownedCount} max={total} color="var(--r-ultra)" /></div>
              <div className="faint" style={{ fontSize: 11.5, marginTop: 7 }}>{pct}% of the set collected</div>
            </div>

            <div className="dash-stat panel">
              <Stat label="Packs opened" value={packsOpened ?? "—"} sub="all-time" />
            </div>

            <div className="dash-stat panel">
              <Stat label="Claimable" value={claimable != null ? `◇ ${claimable}` : "—"} sub="ETH royalties" accent />
              <div className="row gap-8" style={{ marginTop: 14 }}>
                <Btn kind="ghost" size="sm" icon="coin" onClick={() => go("royalty")}>Royalty dashboard</Btn>
              </div>
            </div>

            <div className="dash-stat panel">
              <Stat label="Marketplace" value={activeListings ?? "—"} sub="active listings" />
              <div className="row gap-8" style={{ marginTop: 14 }}>
                <Btn kind="ghost" size="sm" icon="store" onClick={() => go("marketplace")}>Open market</Btn>
              </div>
            </div>
          </div>

          <div className="dash-2col">
            <div className="panel dash-ach">
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
                <h3 style={{ fontSize: 17 }}>Collection by rarity</h3>
                <span className="faint mono" style={{ fontSize: 12 }}>{ownedCount}/{total}</span>
              </div>
              <div className="col gap-16">
                {RARITY_ORDER.map(rk => {
                  const inSet = cards.filter(c => c.rarity === rk);
                  const own = inSet.filter(c => ownedSet.has(c.id)).length;
                  return (
                    <div key={rk} className="col gap-4">
                      <div className="row gap-8" style={{ justifyContent: "space-between", fontSize: 13 }}>
                        <span style={{ color: RARITY[rk].color }}>{RARITY[rk].label}</span>
                        <span className="faint mono">{own}/{inSet.length}</span>
                      </div>
                      <Progress value={own} max={inSet.length || 1} color={RARITY[rk].color} height={6} />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="panel dash-quests">
              <h3 style={{ fontSize: 17, marginBottom: 12 }}>Recent activity</h3>
              <TxHistory address={wallet.address} limit={8} />
            </div>
          </div>
        </>
      ) : (
        <NotConnected onConnect={wallet.connect} note="Connect your wallet to see your collection progress, packs opened and royalties." />
      )}
    </div>
  );
}
