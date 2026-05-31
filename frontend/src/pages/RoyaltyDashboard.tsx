import { useState } from "react";
import { Contract, formatEther } from "ethers";
import type { WalletState } from "../hooks/useWallet";
import { ADDRESSES, SPLITTER_ABI } from "../config/contracts";
import { txPending, txSuccess, txError } from "../components/TxToast";

interface Props { wallet: WalletState; }

export function RoyaltyDashboard({ wallet }: Props) {
  const [claimable, setClaimable] = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);

  async function loadClaimable() {
    if (!wallet.signer || !wallet.address) return;
    const splitter = new Contract(ADDRESSES.PaymentSplitter, SPLITTER_ABI, wallet.signer);
    const bal = await splitter.claimable(wallet.address);
    setClaimable(formatEther(bal));
  }

  async function claim() {
    if (!wallet.signer) return;
    const splitter = new Contract(ADDRESSES.PaymentSplitter, SPLITTER_ABI, wallet.signer);
    setLoading(true);
    const id = txPending("Claiming balance…");
    try {
      const tx = await splitter.claim();
      await tx.wait();
      txSuccess(id, "Claimed!");
      setClaimable("0.0");
    } catch (e) {
      txError(id, e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto py-8 px-4">
      <h2 className="text-2xl font-bold text-white mb-2">Royalty Dashboard</h2>
      <p className="text-gray-400 mb-6">
        Claim your share of pack revenue and marketplace royalties. Balances accrue
        in the PaymentSplitter contract — withdraw at any time.
      </p>

      {!wallet.address ? (
        <p className="text-yellow-400">Connect your wallet first.</p>
      ) : (
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="flex justify-between items-center mb-4">
            <p className="text-gray-400 text-sm">Connected wallet</p>
            <p className="text-white text-sm font-mono">{wallet.address.slice(0, 10)}…</p>
          </div>

          <div className="bg-gray-900 rounded-lg p-4 mb-4 flex justify-between items-center">
            <span className="text-gray-400">Claimable balance</span>
            <span className="text-green-400 font-bold text-lg">
              {claimable !== null ? `${claimable} ETH` : "—"}
            </span>
          </div>

          <div className="flex gap-3">
            <button onClick={loadClaimable}
              className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition">
              Refresh Balance
            </button>
            <button
              onClick={claim}
              disabled={loading || !claimable || claimable === "0.0"}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition">
              {loading ? "Claiming…" : "Claim ETH"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
        <h3 className="text-white font-semibold mb-2 text-sm">How royalties work</h3>
        <ol className="text-gray-400 text-xs space-y-1 list-decimal list-inside">
          <li>Every pack sale deposits revenue into the splitter.</li>
          <li>Every NFT sale queries EIP-2981 and deposits royalties atomically.</li>
          <li>Your address accrues a balance — no ETH is pushed to you automatically.</li>
          <li>Click Claim ETH to withdraw your entire balance in one transaction.</li>
        </ol>
      </div>
    </div>
  );
}
