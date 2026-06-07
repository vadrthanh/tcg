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

export function txError(id: string, err: unknown) {
  const e = err as { reason?: string; message?: string };
  const msg = e?.reason ?? e?.message ?? "Transaction failed";
  toast.error(String(msg).slice(0, 80), { id, style: { ...base, color: "#f87171" } });
}
