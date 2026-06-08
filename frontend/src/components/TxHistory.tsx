// Transaction history list — last N actions for a given address.
// Sourced from /api/transactions; renders bare (caller provides the panel/heading).
// Silent fallback to empty/offline if the API is down.

import { useEffect, useState } from "react";
import { api, ApiUnavailableError } from "../lib/api";
import type { TransactionRow, TxType } from "../lib/types";

const TYPE_LABEL: Record<TxType, { label: string; color: string; icon: string }> = {
  pack_opened:    { label: "Pack opened", color: "var(--accent-text)",  icon: "⚡" },
  card_listed:    { label: "Listed",      color: "var(--r-legendary)",  icon: "▲" },
  card_bought:    { label: "Bought",      color: "var(--r-uncommon)",   icon: "✓" },
  card_cancelled: { label: "Cancelled",   color: "var(--text-faint)",   icon: "✕" },
};

// Idiomatic "5 minutes ago" / "yesterday" for the recent-activity feed — a bare
// date hid the time, so everything from today looked identical. numeric:"auto"
// gives phrases like "yesterday"; older than a week falls back to an absolute
// date. Computed at render (a snapshot — the list refetches on mount).
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
/**
 * Formats an ISO timestamp as a human-friendly relative time string.
 *
 * @param iso - An ISO 8601 timestamp or other string accepted by `Date` parsing.
 * @returns An empty string if `iso` is invalid; `"just now"` for differences under 60 seconds; a localized relative time for minutes, hours, or days (e.g. `"5 minutes ago"`, `"in 2 hours"`); for differences of seven days or more, an absolute locale date string.
 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const sec = Math.round((then - Date.now()) / 1000); // negative = past
  if (Math.abs(sec) < 60) return "just now";
  const min = Math.round(sec / 60);
  if (Math.abs(min) < 60) return rtf.format(min, "minute");
  const hr = Math.round(min / 60);
  if (Math.abs(hr) < 24) return rtf.format(hr, "hour");
  const day = Math.round(hr / 24);
  if (Math.abs(day) < 7) return rtf.format(day, "day");
  return new Date(iso).toLocaleDateString();
}

/**
 * Render a transaction activity list for a given address.
 *
 * Fetches up to `limit` transactions for `address` and displays each entry with
 * an icon, label, token/token-count, optional ETH value, and a relative timestamp.
 *
 * @param address - The address whose transactions to display; when `null` nothing is rendered.
 * @param limit - Maximum number of transactions to fetch and display (default: 20).
 * @returns A React element containing the transaction list, or `null` if `address` is `null`.
 */
export function TxHistory({ address, limit = 20 }: { address: string | null; limit?: number }) {
  const [rows, setRows]       = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!address) { setRows([]); return; }
    const ctrl = new AbortController();
    setLoading(true); setError(null);
    api.transactions({ address, limit }, ctrl.signal)
      .then(setRows)
      .catch(err => {
        if (ctrl.signal.aborted) return;
        setError(err instanceof ApiUnavailableError ? "Activity feed offline" : String(err.message ?? err));
      })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [address, limit]);

  if (!address) return null;
  if (loading) return <p className="faint" style={{ fontSize: 12 }}>Loading…</p>;
  if (error)   return <p className="faint" style={{ fontSize: 12 }}>{error}</p>;
  if (rows.length === 0) return <p className="faint" style={{ fontSize: 12 }}>No transactions yet.</p>;

  return (
    <ul className="col gap-8" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {rows.map(r => {
        const meta = TYPE_LABEL[r.type];
        const when = relativeTime(r.timestamp);
        return (
          <li key={`${r.txHash}-${r.logIndex}`} className="row gap-8" style={{ fontSize: 12.5 }}>
            <span style={{ color: meta.color }}>{meta.icon}</span>
            <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
            <span className="faint mono" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.tokenIds.length === 1 ? `#${r.tokenIds[0]}` : `${r.tokenIds.length} tokens`}
              {Number(r.value) > 0 && ` · ${r.value} ETH`}
            </span>
            <span className="faint mono spacer" title={new Date(r.timestamp).toLocaleString()}
              style={{ textAlign: "right", fontSize: 11 }}>{when}</span>
          </li>
        );
      })}
    </ul>
  );
}
