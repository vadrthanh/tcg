// Wallet chooser — lists every EIP-6963 wallet the browser injected (MetaMask,
// Rabby, OKX, …) so the user picks which one to connect with. Shown by App when
// useWallet.connect() discovers more than one wallet.

import { useEffect, useRef } from "react";
import type { DiscoveredWallet } from "../lib/eip6963";

interface Props {
  wallets: DiscoveredWallet[];
  onSelect: (w: DiscoveredWallet) => void;
  onClose: () => void;
}

export function WalletPicker({ wallets, onSelect, onClose }: Props) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onCloseRef.current(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal panel wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title"
        onClick={e => e.stopPropagation()}>
        <button className="modal-x" aria-label="Close" onClick={onClose}>✕</button>
        <h2 id="wallet-modal-title" style={{ fontSize: 22, marginBottom: 4 }}>Connect a wallet</h2>
        <p className="faint" style={{ fontSize: 13, marginBottom: 18 }}>
          Choose which browser wallet to connect with.
        </p>
        <div className="wallet-list">
          {wallets.map(w => (
            <button key={w.info.uuid} className="wallet-option" onClick={() => onSelect(w)}>
              {w.info.icon
                ? <img src={w.info.icon} alt="" className="wallet-icon" width={28} height={28} />
                : <span className="wallet-icon wallet-icon-fallback">◇</span>}
              <span className="wallet-option-name">{w.info.name}</span>
              <span className="wallet-option-go" aria-hidden>→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
