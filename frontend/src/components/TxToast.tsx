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

// Map ethers v6 / wallet errors to a readable, actionable message in plain
// English — every branch says what went wrong AND what to do next. Raw ethers
// errors (e.g. CALL_EXCEPTION "missing revert data" when gas estimation fails
// because the account can't cover value + gas) are otherwise dumped verbatim.
function humanizeTxError(err: unknown): string {
  const e = err as { code?: string | number; shortMessage?: string; reason?: string; message?: string };
  const msg = typeof e?.message === "string" ? e.message : "";
  const text = `${e?.reason ?? ""} ${e?.shortMessage ?? ""} ${msg}`.toLowerCase();

  // ── User actively declined in the wallet popup ──────────────────────────────
  if (e?.code === "ACTION_REJECTED" || e?.code === 4001 || /user (rejected|denied)|rejected the request/.test(text))
    return "You cancelled the request in your wallet. Nothing was sent — press the button again when you're ready.";

  // ── Money / gas problems ────────────────────────────────────────────────────
  if (e?.code === "INSUFFICIENT_FUNDS" || /insufficient funds/.test(text))
    return "Not enough Sepolia ETH for the price plus gas. Top up your wallet from a Sepolia faucet, then try again.";

  // ── Wrong network ───────────────────────────────────────────────────────────
  if (/wrong network|unsupported chain|chain mismatch|network changed|underlying network changed/.test(text))
    return "Your wallet is on the wrong network. Switch it to Sepolia and try again.";

  // ── Pending / stuck / duplicate transactions ────────────────────────────────
  if (e?.code === "REPLACEMENT_UNDERPRICED" || /replacement (transaction )?underpriced|already known/.test(text))
    return "A similar transaction is already pending. Wait for it to finish (or speed it up in your wallet) before retrying.";
  if (e?.code === "NONCE_EXPIRED" || /nonce too low|nonce has already been used/.test(text))
    return "This transaction is out of date — your wallet already moved on. Refresh the page and try again.";

  // ── Connection / RPC issues ─────────────────────────────────────────────────
  if (e?.code === "NETWORK_ERROR" || e?.code === "TIMEOUT" || e?.code === "SERVER_ERROR" || /timeout|failed to fetch|could not detect network/.test(text))
    return "Couldn't reach the network. Check your internet connection or wallet RPC, then try again.";

  // ── Decoded contract revert reason (most specific — surface it, capitalized) ─
  if (e?.reason && !/could not coalesce/i.test(e.reason)) {
    const r = e.reason.trim();
    return r.charAt(0).toUpperCase() + r.slice(1) + (/[.!?]$/.test(r) ? "" : ".");
  }

  // ── Generic contract revert with no reason ──────────────────────────────────
  if (e?.code === "CALL_EXCEPTION")
    return "The transaction would fail on-chain. Check that the item is still available and that you have enough Sepolia ETH, then try again.";

  // ── ethers' opaque fallback wrapper ─────────────────────────────────────────
  // Most often the wallet can't cover value + gas during estimation
  // (insufficient-funds isn't mapped for eth_estimateGas), so it can't be classified.
  if (e?.code === "UNKNOWN_ERROR" || /could not coalesce/.test(text))
    return "Couldn't submit the transaction — usually not enough Sepolia ETH for price + gas. Check your balance and try again.";

  return String(e?.shortMessage ?? e?.message ?? "Transaction failed. Please try again.").slice(0, 140);
}

export function txError(id: string, err: unknown) {
  toast.error(humanizeTxError(err), { id, style: { ...base, color: "#f87171" } });
}
