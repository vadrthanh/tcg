import toast from "react-hot-toast";

const base = { background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--line-2)" };

export function txPending(msg = "Transaction pending…") {
  return toast.loading(msg, { style: base });
}

export function txUpdate(id: string, msg: string) {
  toast.loading(msg, { id, style: base });
}

export function txSuccess(id: string, msg = "Transaction confirmed!") {
  toast.success(msg, { id, style: { ...base, color: "var(--accent-text)" } });
}

// Map ethers v6 / wallet errors to a readable, actionable message. Raw ethers
// errors like CALL_EXCEPTION "missing revert data" (e.g. gas estimation failing
// because the account can't cover value + gas) are otherwise dumped verbatim.
function humanizeTxError(err: unknown): string {
  const e = err as { code?: string | number; shortMessage?: string; reason?: string; message?: string };
  if (e?.code === "ACTION_REJECTED" || e?.code === 4001) return "Transaction rejected in your wallet.";
  if (e?.code === "INSUFFICIENT_FUNDS") return "Not enough Sepolia ETH to cover this transaction.";
  if (e?.reason) return e.reason; // decoded contract revert reason
  if (e?.code === "CALL_EXCEPTION") return "Transaction would fail — check your Sepolia ETH balance and network.";
  return String(e?.shortMessage ?? e?.message ?? "Transaction failed").slice(0, 120);
}

export function txError(id: string, err: unknown) {
  toast.error(humanizeTxError(err), { id, style: { ...base, color: "#f87171" } });
}
