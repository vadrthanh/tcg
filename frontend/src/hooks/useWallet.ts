import { useState, useCallback, useEffect, useRef } from "react";
import { BrowserProvider, JsonRpcSigner } from "ethers";
import { CHAIN_ID } from "../config/contracts";
import { discoverWallets, type Eip1193, type DiscoveredWallet } from "../lib/eip6963";

// Remember which wallet the user picked so the next page load reconnects to the
// same one (silently, no popup) instead of guessing.
const LAST_WALLET_KEY = "tcg:wallet-rdns";

export interface WalletState {
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  address: string | null;
  chainOk: boolean;
  error: string | null;
  connect: () => Promise<void>;
  switchToSepolia: () => Promise<void>;
  // ── Multi-wallet picker ──────────────────────────────────────────────────
  wallets: DiscoveredWallet[];   // wallets discovered via EIP-6963
  pickerOpen: boolean;           // true while the user is choosing a wallet
  selectWallet: (w: DiscoveredWallet) => Promise<void>;
  closePicker: () => void;
}

function readLastWallet(): string | null {
  try { return localStorage.getItem(LAST_WALLET_KEY); } catch { return null; }
}

export function useWallet(): WalletState {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner]     = useState<JsonRpcSigner | null>(null);
  const [address, setAddress]   = useState<string | null>(null);
  const [chainOk, setChainOk]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [wallets, setWallets]       = useState<DiscoveredWallet[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  // The raw EIP-1193 provider chosen via EIP-6963 discovery. Held in a ref so
  // refresh() and the event listeners always act on the exact wallet we
  // connected to (not whichever singleton happens to be on window.ethereum).
  const injected  = useRef<Eip1193 | null>(null);
  // The wallet we currently have account/chain listeners on, so we can detach
  // them when switching wallets or unmounting.
  const listeners = useRef<{ eth: Eip1193; handler: () => void } | null>(null);

  // Re-read wallet state from the injected provider and push it into React state.
  // Uses eth_accounts (no popup), so it is safe to call on mount and on every
  // account/network change. Rebuilds BrowserProvider each call so a chain switch
  // can't leave us reading a stale, cached network.
  const refresh = useCallback(async () => {
    const eth = injected.current;
    if (!eth) return;
    const p = new BrowserProvider(eth);
    const accounts = (await p.send("eth_accounts", [])) as string[];
    if (accounts.length === 0) {
      // Wallet locked or disconnected → clear everything.
      setProvider(null); setSigner(null); setAddress(null); setChainOk(false);
      return;
    }
    const s   = await p.getSigner();
    const net = await p.getNetwork();
    setProvider(p);
    setSigner(s);
    setAddress(await s.getAddress());
    setChainOk(Number(net.chainId) === CHAIN_ID);
  }, []);

  // Attach account/chain listeners to a wallet, detaching any previous ones first.
  // Without these, switching account or network in the wallet after connecting
  // would leave the app showing and signing with the OLD account/chain.
  const attachListeners = useCallback((eth: Eip1193) => {
    if (listeners.current) {
      listeners.current.eth.removeListener("accountsChanged", listeners.current.handler);
      listeners.current.eth.removeListener("chainChanged", listeners.current.handler);
    }
    const handler = () => { refresh().catch(() => {}); };
    eth.on("accountsChanged", handler);
    eth.on("chainChanged", handler);
    listeners.current = { eth, handler };
  }, [refresh]);

  // Connect to a specific discovered wallet — opens that wallet's permission popup.
  const connectTo = useCallback(async (w: DiscoveredWallet) => {
    injected.current = w.provider;
    const p = new BrowserProvider(w.provider);
    await p.send("eth_requestAccounts", []); // opens the wallet permission popup
    try { localStorage.setItem(LAST_WALLET_KEY, w.info.rdns); } catch { /* ignore */ }
    attachListeners(w.provider);
    await refresh();
  }, [attachListeners, refresh]);

  const selectWallet = useCallback(async (w: DiscoveredWallet) => {
    setError(null);
    setPickerOpen(false);
    try { await connectTo(w); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)); }
  }, [connectTo]);

  const closePicker = useCallback(() => setPickerOpen(false), []);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const found = await discoverWallets();
      if (found.length === 0) {
        // A wallet only injects in a secure context (HTTPS, or localhost in dev).
        throw new Error(
          window.isSecureContext
            ? "No Ethereum wallet detected. Install MetaMask, Rabby, or OKX Wallet and reload the page."
            : "A wallet can't connect because this page isn't served over HTTPS. " +
              "Open it via its https:// address."
        );
      }
      setWallets(found);
      // One wallet → connect straight away. Several → let the user choose.
      if (found.length === 1) { await connectTo(found[0]); return; }
      setPickerOpen(true);
    } catch (err: unknown) {
      // connect() is wired to onClick with no catch, so an uncaught throw would
      // vanish as an unhandled rejection — surface the real reason instead.
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [connectTo]);

  const switchToSepolia = useCallback(async () => {
    setError(null);
    try {
      const eth = injected.current;
      if (!eth) throw new Error("No wallet connected");
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + CHAIN_ID.toString(16) }],
      });
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [refresh]);

  // Discover wallets (EIP-6963) and silently reconnect to the previously chosen
  // one if it was already approved (eth_accounts → no popup). Listeners are
  // attached so account / network changes keep the app in sync.
  useEffect(() => {
    let cancelled = false;

    discoverWallets().then(found => {
      if (cancelled) return;
      setWallets(found);
      const lastRdns = readLastWallet();
      const remembered = lastRdns ? found.find(w => w.info.rdns === lastRdns) : undefined;
      const target = remembered ?? (found.length === 1 ? found[0] : undefined);
      if (!target) return;
      injected.current = target.provider;
      attachListeners(target.provider);
      refresh().catch(() => {}); // reconnect silently if approved before (no popup)
    });

    return () => {
      cancelled = true;
      if (listeners.current) {
        listeners.current.eth.removeListener("accountsChanged", listeners.current.handler);
        listeners.current.eth.removeListener("chainChanged", listeners.current.handler);
        listeners.current = null;
      }
    };
  }, [attachListeners, refresh]);

  return {
    provider, signer, address, chainOk, error, connect, switchToSepolia,
    wallets, pickerOpen, selectWallet, closePicker,
  };
}
