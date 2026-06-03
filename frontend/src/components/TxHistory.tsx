// Transaction history panel — last N actions for a given address.
// Sourced from /api/transactions; silent fallback to empty list if the API is down.

import { useEffect, useState } from "react";
import { api, ApiUnavailableError } from "../lib/api";
import type { TransactionRow, TxType } from "../lib/types";

const TYPE_LABEL: Record<TxType, { label: string; color: string; icon: string }> = {
  pack_opened:    { label: "Pack opened", color: "text-indigo-400",  icon: "⚡" },
  card_listed:    { label: "Listed",      color: "text-yellow-400",  icon: "🏷️" },
  card_bought:    { label: "Bought",      color: "text-emerald-400", icon: "🛒" },
  card_cancelled: { label: "Cancelled",   color: "text-gray-400",    icon: "✕"  },
};

export function TxHistory({ address, limit = 20 }: { address: string | null; limit?: number }) {
  const [rows, setRows]     = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!address) { setRows([]); return; }
    const ctrl = new AbortController();
    setLoading(true); setError(null);
    api.transactions({ address, limit }, ctrl.signal)
      .then(setRows)
      .catch(err => {
        if (ctrl.signal.aborted) return;
        setError(err instanceof ApiUnavailableError ? "API offline" : String(err.message ?? err));
      })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [address, limit]);

  if (!address) return null;

  return (
    <div className="mt-6 bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
      <h3 className="text-white font-semibold mb-3 text-sm">Recent activity</h3>
      {loading && <p className="text-gray-500 text-xs">Loading…</p>}
      {error && <p className="text-yellow-500 text-xs">{error}</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="text-gray-500 text-xs">No transactions yet.</p>
      )}
      <ul className="space-y-1.5">
        {rows.map(r => {
          const meta = TYPE_LABEL[r.type];
          const when = new Date(r.timestamp).toLocaleString();
          return (
            <li key={`${r.txHash}-${r.logIndex}`} className="text-xs flex items-center gap-2">
              <span>{meta.icon}</span>
              <span className={`font-medium ${meta.color}`}>{meta.label}</span>
              <span className="text-gray-400 truncate">
                {r.tokenIds.length === 1 ? `#${r.tokenIds[0]}` : `${r.tokenIds.length} tokens`}
                {Number(r.value) > 0 && <> · {r.value} ETH</>}
              </span>
              <span className="ml-auto text-gray-600 text-[10px]">{when}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
