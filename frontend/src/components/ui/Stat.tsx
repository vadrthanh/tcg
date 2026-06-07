import type { ReactNode } from "react";

export function Stat({ label, value, sub, accent }: {
  label: string; value: ReactNode; sub?: ReactNode; accent?: boolean;
}) {
  return (
    <div className="stat">
      <div className="stat-label mono">{label}</div>
      <div className="stat-value" style={accent ? { color: "var(--accent-text)" } : undefined}>{value}</div>
      {sub && <div className="stat-sub faint">{sub}</div>}
    </div>
  );
}
