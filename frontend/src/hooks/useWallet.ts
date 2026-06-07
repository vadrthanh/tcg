import { useState, useCallback, useEffect, useRef } from "react";
import { BrowserProvider, JsonRpcSigner } from "ethers";
import { CHAIN_ID } from "../config/contracts";
import { discoverInjectedProvider, type Eip1193 } from "../lib/eip6963";

export interface WalletState {
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  address: string | null;
  chainOk: boolean;
  error: string | null;
  connect: () => Promise<void>;
  switchToSepolia: () => Promise<void>;
}

export function useWallet(): WalletState {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner]     = useState<JsonRpcSigner | null>(null);
  const [address, setAddress]   = useState<string | null>(null);
  const [chainOk, setChainOk]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // The raw EIP-1193 provider chosen via EIP-6963 discovery. Held in a ref so
  // refresh() and the event listeners always act on the exact wallet we
  // connected to (not whichever singleton happens to be on window.ethereum).
  const injected = useRef<Eip1193 | null>(null);

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

  const connect = useCallback(async () => {
    setError(null);
    try {
      const eth = injected.current ?? (await discoverInjectedProvider());
      if (!eth) {
        // A wallet only injects in a secure context (HTTPS, or localhost in dev).
        throw new Error(
          window.isSecureContext
            ? "No Ethereum wallet detected. Install MetaMask and reload the page."
            : "A wallet can't connect because this page isn't served over HTTPS. " +
              "Open it via its https:// address."
        );
      }
      injected.current = eth;
      const p = new BrowserProvider(eth);
      await p.send("eth_requestAccounts", []); // opens the wallet permission popup
      await refresh();
    } catch (err: unknown) {
      // connect() is wired to onClick with no catch, so an uncaught throw would
      // vanish as an unhandled rejection — surface the real reason instead.
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [refresh]);

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

  // Discover the wallet (EIP-6963), silently reconnect if already approved, and
  // react to account / network changes. Without these listeners, switching
  // account or network in the wallet after connecting would leave the app
  // showing and signing with the OLD account/chain — a wrong-wallet / wrong-chain
  // risk. refresh() only sets state asynchronously after the wallet responds:
  // the "subscribe to an external system" pattern.
  useEffect(() => {
    let cancelled = false;
    let eth: Eip1193 | null = null;
    const onChange = () => { refresh().catch(() => {}); };

    discoverInjectedProvider().then(found => {
      if (cancelled || !found) return;
      eth = found;
      injected.current = found;
      refresh().catch(() => {}); // reconnect silently if approved before (no popup)
      found.on("accountsChanged", onChange);
      found.on("chainChanged", onChange);
    });

    return () => {
      cancelled = true;
      eth?.removeListener("accountsChanged", onChange);
      eth?.removeListener("chainChanged", onChange);
    };
  }, [refresh]);

  return { provider, signer, address, chainOk, error, connect, switchToSepolia };
}
