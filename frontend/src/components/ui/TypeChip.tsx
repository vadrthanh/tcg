import { typeColor, vars } from "../../lib/tokens";

export function TypeChip({ type }: { type: string }) {
  if (!type) return null;
  return <span className="tchip" style={vars({ "--tc": typeColor(type) })}>{type}</span>;
}
