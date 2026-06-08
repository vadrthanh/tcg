// Connected-wallet pill that opens a dropdown: copy address, view on the block
// explorer, and disconnect. Replaces the static pill in the topbar.

import { useState, useRef, useEffect } from "react";
import { Icon } from "./ui/Icon";

// App is Sepolia-only (CHAIN_ID 11155111), so the explorer is fixed.
const EXPLORER = "https://sepolia.etherscan.io";

interface Props {
  address: string;
  balance: string | null;
  onDisconnect: () => void;
}

export function WalletMenu({ address, balance, onDisconnect }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  // Close on outside click or Escape while the menu is open.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard unavailable — no-op */ }
  }

  return (
    <div className="wallet-menu-wrap" ref={wrapRef}>
      <button type="button" className="wallet-trigger" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(o => !o)}>
        {balance != null && <span className="wallet-bal mono">◇ {balance}</span>}
        <span className="wallet-addr mono">{short}</span>
        <span className={`wallet-caret${open ? " up" : ""}`} aria-hidden>
          <Icon name="chevron" size={15} />
        </span>
      </button>

      {open && (
        <div className="wallet-menu" role="menu">
          <div className="wallet-menu-addr">
            <span className="mono">{short}</span>
            <button type="button" className="wallet-menu-mini"
              onClick={copy} aria-label={copied ? "Copied" : "Copy address"}>
              <Icon name={copied ? "check" : "copy"} size={15} />
            </button>
          </div>
          <a className="wallet-menu-item" role="menuitem"
            href={`${EXPLORER}/address/${address}`} target="_blank" rel="noopener noreferrer"
            onClick={() => setOpen(false)}>
            <Icon name="external" size={16} /><span>View on Etherscan</span>
          </a>
          <div className="wallet-menu-sep" />
          <button type="button" className="wallet-menu-item wallet-menu-danger" role="menuitem"
            onClick={() => { setOpen(false); onDisconnect(); }}>
            <Icon name="power" size={16} /><span>Disconnect</span>
          </button>
        </div>
      )}
    </div>
  );
}
