import toast from "react-hot-toast";

export function txPending(msg = "Transaction pending…") {
  return toast.loading(msg, { style: { background: "#1e1b2e", color: "#e2e8f0" } });
}

export function txUpdate(id: string, msg: string) {
  toast.loading(msg, { id, style: { background: "#1e1b2e", color: "#e2e8f0" } });
}

export function txSuccess(id: string, msg = "Transaction confirmed!") {
  toast.success(msg, { id, style: { background: "#1e1b2e", color: "#86efac" } });
}

export function txError(id: string, err: unknown) {
  const msg = (err as any)?.reason ?? (err as any)?.message ?? "Transaction failed";
  toast.error(msg.slice(0, 80), { id, style: { background: "#1e1b2e", color: "#f87171" } });
}
