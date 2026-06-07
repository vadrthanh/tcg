import { Icon } from "./ui/Icon";
import { Btn } from "./ui/Btn";

export function NotConnected({ onConnect, note }: { onConnect: () => void; note?: string }) {
  return (
    <div className="notconn panel">
      <div className="notconn-ic"><Icon name="wallet" size={26} /></div>
      <div className="col gap-4">
        <strong style={{ fontFamily: "var(--fs)", fontSize: 15 }}>Wallet not connected</strong>
        <span className="faint" style={{ fontSize: 13 }}>{note || "Connect to load your on-chain data."}</span>
      </div>
      <Btn kind="primary" icon="wallet" onClick={onConnect}>Connect</Btn>
    </div>
  );
}
