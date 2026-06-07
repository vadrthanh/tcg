import type { ReactNode } from "react";

export function PageHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="pagehead">
      <div className="col gap-8" style={{ minWidth: 0 }}>
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub dim">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
