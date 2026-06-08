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
import { txPending, txSuccess, txError } from "../components/TxToast";

interface Props { wallet: WalletState; }
type Phase = "idle" | "charging" | "revealing" | "done";
interface Pull { tokenId: number; rarity: Rarity; card: CardRow; }

export function Gacha({ wallet }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [pulls, setPulls] = useState<Pull[]>([]);
  const [shown, setShown] = useState(0);
  const [packPrice, setPackPrice] = useState("0.0005");
  const [note, setNote]   = useState("REVEALING ON-CHAIN…");
  const connected = !!wallet.address && wallet.chainOk;

  // Staged reveal: flip one card every 380ms, then settle into the summary.
  // Cleanup clears timers so StrictMode's double-invoke can't stack them.
  useEffect(() => {
    if (phase !== "revealing") return;
    const timers = pulls.map((_, i) => setTimeout(() => setShown(s => Math.max(s, i + 1)), 380 * (i + 1)));
    const end = setTimeout(() => setPhase("done"), 380 * (pulls.length + 1));
    return () => { timers.forEach(clearTimeout); clearTimeout(end); };
  }, [phase, pulls]);

  // Show the real on-chain pack price in the header from the start — otherwise
  // the idle subtitle displays the "0.0005" default until the first open() runs.
  useEffect(() => {
    if (!wallet.provider) return;
    let alive = true;
    new Contract(ADDRESSES.GachaPack, GACHA_ABI, wallet.provider)
      .packPrice()
      .then((p: bigint) => { if (alive) setPackPrice(formatEther(p)); })
      .catch(() => { /* keep default until a pack is opened */ });
    return () => { alive = false; };
  }, [wallet.provider]);

  async function open() {
    if (!wallet.signer || !wallet.address) return;
    const gacha = new Contract(ADDRESSES.GachaPack, GACHA_ABI, wallet.signer);
    const nft   = new Contract(ADDRESSES.PokemonCardNFT, NFT_ABI, wallet.signer);
    const provider = wallet.signer.provider!;
    const me = wallet.address;

    setPulls([]); setShown(0); setNote("REVEALING ON-CHAIN…"); setPhase("charging");
    const toastId = txPending("Opening pack…");
    try {
      await assertChain(wallet.provider);
      const price = await gacha.packPrice();
      setPackPrice(formatEther(price));

      // The deployed GachaPack uses a two-step commit–reveal so the draw outcome
      // is unknowable at payment time (anti re-roll). Step 1 commitPack() pays and
      // records the block; step 2 revealPack(), in a *later* block, mints the 5
      // cards from blockhash(commitBlock). We recover any pre-existing commit so a
      // half-finished open (e.g. page reload between the two txs) still completes
      // without paying twice.
      const window = Number(await gacha.REVEAL_WINDOW().catch(() => 256n));
      let commitBlock = Number(await gacha.commitBlockOf(me));
      const tip = await provider.getBlockNumber();
      const hasLiveCommit = commitBlock !== 0 && tip <= commitBlock + window;

      if (!hasLiveCommit) {
        // Estimate commit gas; if the wallet is underfunded estimateGas surfaces as
        // ethers' cryptic "could not coalesce error", so fall back to a budget and let
        // the affordability check produce a clear message instead.
        let gasLimit = 200_000n;
        try {
          gasLimit = (await gacha.commitPack.estimateGas({ value: price })) * 12n / 10n;
        } catch (est) {
          if ((est as { code?: string })?.code === "CALL_EXCEPTION") throw est;
        }

        // Pre-flight: must cover packPrice + gas, not just packPrice.
        const [bal, fee] = await Promise.all([provider.getBalance(me), provider.getFeeData()]);
        const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
        const needed = price + gasLimit * gasPrice;
        if (bal < needed) {
          throw new Error(`Need ~${formatEther(needed)} ETH (pack + gas) but wallet holds ${formatEther(bal)} ETH. Top up from a Sepolia faucet.`);
        }

        setNote("CONFIRM PAYMENT IN YOUR WALLET…");
        const cTx    = await gacha.commitPack({ value: price, gasLimit });
        const cRcpt  = await cTx.wait();
        commitBlock  = cRcpt.blockNumber;
      }

      // revealPack() requires block.number > commitBlock — wait for the next block.
      setNote("SECURING YOUR DRAW — WAITING FOR THE NEXT BLOCK…");
      await waitForBlockAfter(provider, commitBlock);

      // Reveal: draws + mints 5 cards and emits PackOpened. Gas varies with the
      // randomized draw, so estimate and add a 50% buffer to avoid out-of-gas;
      // unused gas is refunded.
      setNote("REVEALING YOUR CARDS ON-CHAIN…");
      const gas    = await gacha.revealPack.estimateGas();
      const tx     = await gacha.revealPack({ gasLimit: gas + gas / 2n });
      const receipt = await tx.wait();

      const iface = gacha.interface;
      const log = receipt.logs
        .map((l: Log) => { try { return iface.parseLog(l); } catch { return null; } })
        .find((e: LogDescription | null) => e?.name === "PackOpened");

      if (!log) { txError(toastId, new Error("Pack opened but no event was found")); setPhase("idle"); return; }

      const tokenIds: bigint[] = [...log.args.tokenIds];
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

  // Header copy follows the flow so it stops prompting "Pay …" once a pack is paid for.
  const headSub =
    phase === "charging"                       ? "Opening your booster on-chain — commit pays for the pack, then a reveal in a later block mints your cards."
    : phase === "revealing" || phase === "done" ? "Your 5 Pokémon, minted straight to your wallet. Open another anytime."
    :                                             `Pay ${packPrice} ETH for 5 random Pokémon — a commit–reveal draw (two quick wallet confirmations) keeps the odds fair.`;

  return (
    <div className="screen">
      <PageHead title="Open a Booster" sub={headSub} />

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
                <Icon name="lock" size={13} /> Weighted commit–reveal draw — 5 cards minted straight to your wallet. Two quick wallet confirmations.
              </p>
            </div>
          )}

          {phase === "charging" && (
            <div className="pack-stage">
              <div className="pack3d pack-charging">
                <div className="pack-rays" />
                <div className="pack-shine" />
                <div className="pack-logo mono">POKÉDESK</div>
              </div>
              <div className="charge-text mono">{note}</div>
            </div>
          )}

          {(phase === "revealing" || phase === "done") && (
            <div className="reveal-stage">
              <div className="burst-flash" />
              <div className="reveal-row">
                {pulls.map((p, i) => (
                  <div key={i}
                    className={`reveal-card${i < shown ? " flipped" : ""}${RARITY[p.rarity].rank >= 3 ? " reveal-hot" : ""}`}
                    style={vars({ "--rc": RARITY[p.rarity].color }, { animationDelay: `${i * 80}ms` })}>
                    <div className="reveal-inner">
                      <div className="reveal-back"><span className="reveal-back-gem" /><span className="mono">POKÉDESK</span></div>
                      <div className="reveal-front">
                        <CardArt card={p.card} size="lg" />
                        <div className="reveal-meta">
                          <div className="ccard-name" style={{ fontSize: 14 }}>{p.card.name}</div>
                          <RarityBadge rarity={p.rarity} small />
                        </div>
                      </div>
                    </div>
                    <div className="reveal-ring" />
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

// Poll until the chain advances past `block` (revealPack needs block.number >
// commitBlock). Sepolia blocks are ~12s; we allow ~2 min before giving up so a
// committed-but-unrevealed pack can be retried via Open Booster without paying again.
async function waitForBlockAfter(
  provider: { getBlockNumber: () => Promise<number> },
  block: number,
  timeoutMs = 120_000,
): Promise<number> {
  const start = Date.now();
  for (;;) {
    const n = await provider.getBlockNumber();
    if (n > block) return n;
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for the reveal block. Your payment is safe — press Open Booster again to reveal your pack.");
    }
    await new Promise(r => setTimeout(r, 3000));
  }
}
