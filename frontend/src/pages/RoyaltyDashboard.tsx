// Royalty dashboard — claimable balance (read directly from chain for real-time
// accuracy), a one-click claim, and recent activity from /api/transactions.

import { useCallback, useEffect, useState } from "react";
import { Contract, formatEther } from "ethers";
import type { WalletState } from "../hooks/useWallet";
import { ADDRESSES, SPLITTER_ABI } from "../config/contracts";
import { assertChain } from "../lib/assertChain";
import { PageHead } from "../components/PageHead";
import { NotConnected } from "../components/NotConnected";
import { Btn } from "../components/ui/Btn";
import { TxHistory } from "../components/TxHistory";
import { txPending, txSuccess, txError } from "../components/TxToast";

interface Props { wallet: WalletState; }

export function RoyaltyDashboard({ wallet }: Props) {
  const [claimable, setClaimable]   = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const connected = !!wallet.address && wallet.chainOk;

  const loadClaimable = useCallback(async () => {
    if (!wallet.provider || !wallet.address) return;
    const splitter = new Contract(ADDRESSES.PaymentSplitter, SPLITTER_ABI, wallet.provider);
    try { const bal = await splitter.claimable(wallet.address); setClaimable(formatEther(bal)); }
    catch (err: unknown) { console.error("Failed to read claimable balance:", err); setClaimable(null); }
  }, [wallet.provider, wallet.address]);

  useEffect(() => { loadClaimable(); }, [loadClaimable]);

  async function claim() {
    if (!wallet.signer) return;
    const splitter = new Contract(ADDRESSES.PaymentSplitter, SPLITTER_ABI, wallet.signer);
    setLoading(true);
    const id = txPending("Claiming balance…");
    try {
      await assertChain(wallet.provider);
      const tx = await splitter.claim();
      await tx.wait();
      txSuccess(id, "Claimed!");
      setClaimable("0.0");
      setRefreshKey(k => k + 1);
    } catch (e) {
      txError(id, e);
    } finally {
      setLoading(false);
    }
  }

  const hasBalance = claimable !== null && Number(claimable) > 0;

  return (
    <div className="screen">
      <PageHead title="Royalty Dashboard" sub="Your share of pack revenue and marketplace royalties accrues here — claim anytime." />

      {!connected ? (
        <NotConnected onConnect={wallet.connect} note="Connect your wallet to view and claim your royalty balance." />
      ) : (
        <div className="roy-grid">
          <div className="panel roy-claim">
            <div className="stat-label mono">CLAIMABLE BALANCE</div>
            <div className="roy-big mono">◇ {claimable ?? "—"} <span>ETH</span></div>
            <div className="faint" style={{ fontSize: 12.5 }}>Withdrawn to your wallet in a single transaction.</div>
            <Btn kind="primary" size="lg" icon="coin" full disabled={loading || !hasBalance} onClick={claim}>
              {loading ? "Claiming…" : "Claim ETH"}
            </Btn>
          </div>

          <div className="panel roy-how">
            <h3 style={{ fontSize: 15, marginBottom: 14 }}>How royalties work</h3>
            <ol className="roy-steps">
              <li>Every pack sale deposits revenue into the splitter contract.</li>
              <li>Every secondary sale queries EIP-2981 and deposits royalties atomically.</li>
              <li>Your address accrues a balance — nothing is pushed automatically.</li>
              <li>Claim withdraws your full balance in a single transaction.</li>
            </ol>
          </div>

          <div className="panel roy-break">
            <h3 style={{ fontSize: 15, marginBottom: 12 }}>Recent activity</h3>
            <TxHistory key={refreshKey} address={wallet.address} limit={10} />
          </div>
        </div>
      )}
    </div>
  );
}
