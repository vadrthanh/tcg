import { useEffect, useState } from "react";
import { Contract, formatEther, type Log, type LogDescription } from "ethers";
import type { WalletState } from "../hooks/useWallet";
import { ADDRESSES, GACHA_ABI, NFT_ABI } from "../config/contracts";
import { RARITY, RARITY_BY_INDEX, RARITY_ORDER, DROP_WEIGHTS, vars } from "../lib/tokens";
import { api, pollUntil } from "../lib/api";
import { assertChain } from "../lib/assertChain";
import type { CardRow, Rarity } from "../lib/types";
import { CardArt } from "../components/ui/CardArt";
import { RarityBadge } from "../components/ui/RarityBadge";
import { Btn } from "../components/ui/Btn";
import { Icon } from "../components/ui/Icon";
import { PageHead } from "../components/PageHead";
import { NotConnected } from "../components/NotConnected";
import { txPending, txUpdate, txSuccess, txError } from "../components/TxToast";

interface Props { wallet: WalletState; }
type Phase = "idle" | "charging" | "revealing" | "done";
interface Pull { tokenId: number; rarity: Rarity; card: CardRow; }

export function Gacha({ wallet }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [pulls, setPulls] = useState<Pull[]>([]);
  const [shown, setShown] = useState(0);
  const [packPrice, setPackPrice] = useState("0.01");
  const connected = !!wallet.address && wallet.chainOk;

  // Staged reveal: flip one card every 380ms, then settle into the summary.
  // Cleanup clears timers so StrictMode's double-invoke can't stack them.
  useEffect(() => {
    if (phase !== "revealing") return;
    const timers = pulls.map((_, i) => setTimeout(() => setShown(s => Math.max(s, i + 1)), 380 * (i + 1)));
    const end = setTimeout(() => setPhase("done"), 380 * (pulls.length + 1));
    return () => { timers.forEach(clearTimeout); clearTimeout(end); };
  }, [phase, pulls]);

  async function open() {
    if (!wallet.signer || !wallet.address) return;
    const gacha = new Contract(ADDRESSES.GachaPack, GACHA_ABI, wallet.signer);
    const nft   = new Contract(ADDRESSES.PokemonCardNFT, NFT_ABI, wallet.signer);
    const provider = wallet.signer.provider!;

    setPulls([]); setShown(0); setPhase("charging");
    const toastId = txPending("Step 1/2 — confirm payment…");
    try {
      await assertChain(wallet.provider);
      const price = await gacha.packPrice();
      setPackPrice(formatEther(price));

      // A pack opens in two transactions. Pay in commitPack(); the draw is
      // derived from the commit block's hash in revealPack() a block later, so
      // the outcome is unknowable when you pay. Reuse a still-valid commit if one
      // is already on-chain (e.g. an abandoned reveal) instead of paying again.
      const existing = await gacha.commitBlockOf(wallet.address) as bigint;
      const window   = await gacha.REVEAL_WINDOW() as bigint;
      const current  = BigInt(await provider.getBlockNumber());
      const hasLiveCommit = existing !== 0n && current <= existing + window;
      if (!hasLiveCommit) {
        // Pre-flight: a wallet that can't cover packPrice + gas makes commitPack's
        // gas estimation fail with a cryptic ethers "missing revert data" error.
        // Check first and give a clear, actionable message instead.
        const bal = await provider.getBalance(wallet.address);
        if (bal < price) {
          throw new Error(`Need ~${formatEther(price)} ETH + gas on Sepolia — fund this wallet from a faucet.`);
        }
        const commitTx = await gacha.commitPack({ value: price });
        await commitTx.wait();
      }

      txUpdate(toastId, "Step 2/2 — confirm reveal…");
      const tx = await gacha.revealPack();
      const receipt = await tx.wait();

      const iface = gacha.interface;
      const log = receipt.logs
        .map((l: Log) => { try { return iface.parseLog(l); } catch { return null; } })
        .find((e: LogDescription | null) => e?.name === "PackOpened");

      if (!log) { txError(toastId, new Error("Pack opened but no event was found")); setPhase("idle"); return; }

      const tokenIds: bigint[] = log.args.tokenIds;
      const result: Pull[] = await Promise.all(tokenIds.map(async (tid) => {
        const c = await nft.getCard(tid);
        const rarity = RARITY_BY_INDEX[Number(c.rarity)];
        const card: CardRow = {
          id: 0, name: c.name, rarity, pokemonType: c.pokemonType, hp: Number(c.hp),
          attack: "", maxSupply: 0, currentSupply: 0, floorPrice: "0", imageURI: c.imageURI, createdAt: "",
        };
        return { tokenId: Number(tid), rarity, card };
      }));
      setPulls(result);
      txSuccess(toastId, "Pack opened!");
      setTimeout(() => setPhase("revealing"), 300);

      // Best-effort: let the indexer catch the new tokenIds so Inventory/Collection
      // reflect them on next visit. Fire-and-forget.
      const newIds = new Set(tokenIds.map(t => Number(t)));
      pollUntil(
        () => api.nftsByOwner(wallet.address!),
        rows => rows.some(r => newIds.has(r.tokenId)),
        { attempts: 6, intervalMs: 2000 },
      ).catch(() => {});
    } catch (e) {
      txError(toastId, e);
      setPhase("idle");
    }
  }

  function reset() { setPhase("idle"); setPulls([]); setShown(0); }
  const best = pulls.reduce<Pull | null>((a, p) => (!a || RARITY[p.rarity].rank > RARITY[a.rarity].rank ? p : a), null);

  return (
    <div className="screen">
      <PageHead title="Open a Booster"
        sub={`Pay ${packPrice} ETH for 5 random Pokémon — a payment, then a reveal a block later, so the draw is provably fair.`} />

      {!connected ? (
        <NotConnected onConnect={wallet.connect} note="Connect your wallet to open a pack." />
      ) : (
        <div className="panel gacha-panel">
          {phase === "idle" && (
            <div className="pack-stage">
              <div className="pack-pedestal">
                <div className="pack3d" onClick={open}>
                  <div className="pack-shine" />
                  <div className="pack-logo mono">POKÉDESK</div>
                  <div className="pack-sub mono">GENESIS BOOSTER</div>
                  <div className="pack-bolt"><Icon name="bolt" size={24} /></div>
                </div>
              </div>
              <div className="pack-cta">
                <Btn kind="primary" size="lg" icon="bolt" onClick={open}>Open Booster</Btn>
                <span className="pack-price mono">{packPrice} ETH · 5 cards</span>
              </div>
              <p className="pack-note faint">
                <Icon name="lock" size={13} /> Provably fair — you pay first, cards reveal a block later, so the draw can't be known at purchase.
              </p>
            </div>
          )}

          {phase === "charging" && (
            <div className="pack-stage">
              <div className="pack3d pack-charging">
                <div className="pack-rays" />
                <div className="pack-shine" />
                <div className="pack-logo mono">POKÉDESK</div>
                <div className="pack-bolt charging"><Icon name="bolt" size={26} /></div>
              </div>
              <div className="charge-text mono">REVEALING ON-CHAIN…</div>
            </div>
          )}

          {(phase === "revealing" || phase === "done") && (
            <div className="reveal-stage">
              <div className="reveal-row">
                {pulls.map((p, i) => (
                  <div key={i} className={`reveal-card${i < shown ? " flipped" : ""}`} style={vars({ "--rc": RARITY[p.rarity].color })}>
                    <div className="reveal-inner">
                      <div className="reveal-back"><span className="mono">POKÉDESK</span></div>
                      <div className="reveal-front">
                        <CardArt card={p.card} size="lg" />
                        <div className="reveal-meta">
                          <div className="ccard-name" style={{ fontSize: 14 }}>{p.card.name}</div>
                          <RarityBadge rarity={p.rarity} small />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {phase === "done" && best && (
                <div className="reveal-actions" style={{ animation: "floatUp .5s both" }}>
                  <div className="reveal-summary" style={vars({ "--rc": RARITY[best.rarity].color })}>
                    <span className="rs-label mono">BEST PULL</span>
                    <span className="rs-name">{best.card.name}</span>
                    <RarityBadge rarity={best.rarity} />
                  </div>
                  <div className="row gap-12">
                    <Btn kind="ghost" onClick={reset}>Open another</Btn>
                    <Btn kind="primary" icon="check" onClick={reset}>Done</Btn>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="odds panel">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ fontSize: 15 }}>Drop rates</h3>
          <span className="faint mono" style={{ fontSize: 11 }}>PER CARD</span>
        </div>
        <div className="odds-bar">
          {RARITY_ORDER.map(rk => (
            <span key={rk} className="odds-seg" title={`${RARITY[rk].label} ${DROP_WEIGHTS[rk]}%`}
              style={{ width: DROP_WEIGHTS[rk] + "%", background: RARITY[rk].color, color: RARITY[rk].color }} />
          ))}
        </div>
        <div className="odds-legend">
          {RARITY_ORDER.map(rk => (
            <div key={rk} className="odds-item" style={vars({ "--rc": RARITY[rk].color })}>
              <span className="odds-pct mono">{DROP_WEIGHTS[rk]}%</span>
              <span className="odds-name"><span className="rdot" />{RARITY[rk].label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
