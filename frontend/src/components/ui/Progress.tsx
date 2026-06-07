export function Progress({ value, max, color = "var(--accent)", height = 8 }: {
  value: number; max: number; color?: string; height?: number;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="prog" style={{ height }}>
      <div className="prog-fill" style={{ width: pct + "%", background: color }} />
    </div>
  );
}
