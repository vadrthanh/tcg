import { useState, useCallback, useEffect } from "react";
import { BrowserProvider, JsonRpcSigner } from "ethers";
import { CHAIN_ID } from "../config/contracts";

export interface WalletState {
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  address: string | null;
  chainOk: boolean;
  hasProvider: boolean;          // true when the browser has MetaMask (window.ethereum)
  connect: () => Promise<void>;
  switchToSepolia: () => Promise<void>;
}

export function useWallet(): WalletState {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner]     = useState<JsonRpcSigner | null>(null);
  const [address, setAddress]   = useState<string | null>(null);
  const [chainOk, setChainOk]   = useState(false);

  const hasProvider = typeof window !== "undefined" && !!window.ethereum;

  // Re-read the wallet state from MetaMask and push it into React state. Shared by:
  // connect (after the permission prompt), auto-reconnect on mount, and whenever
  // the user switches account / network in MetaMask.
  const refresh = useCallback(async () => {
    if (!window.ethereum) return;
    const p = new BrowserProvider(window.ethereum);
    // eth_accounts does NOT open a popup — it only returns previously approved accounts.
    const accounts: string[] = await p.send("eth_accounts", []);
    if (accounts.length === 0) {
      // Wallet locked or disconnected → clear all state.
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
    if (!window.ethereum) throw new Error("MetaMask not detected");
    const p = new BrowserProvider(window.ethereum);
    await p.send("eth_requestAccounts", []);   // opens the permission popup
    await refresh();
  }, [refresh]);

  const switchToSepolia = useCallback(async () => {
    await window.ethereum!.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x" + CHAIN_ID.toString(16) }],
    });
    await refresh();
  }, [refresh]);

  // Auto-reconnect on mount + react to MetaMask account / network changes.
  // Without these listeners, switching account in MetaMask would leave the app
  // showing and signing with the OLD account → risk of using the wrong wallet.
  useEffect(() => {
    if (!window.ethereum) return;
    // Reconnect silently if the wallet was approved before (no popup).
    // refresh() only sets state ASYNCHRONOUSLY after MetaMask responds — this is
    // the "subscribe to an external system" pattern the rule allows, so disable it here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh().catch(() => { /* never connected yet — ignore */ });

    const onAccountsChanged = () => { refresh().catch(() => {}); };
    const onChainChanged    = () => { refresh().catch(() => {}); };
    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    return () => {
      window.ethereum?.removeListener("accountsChanged", onAccountsChanged);
      window.ethereum?.removeListener("chainChanged", onChainChanged);
    };
  }, [refresh]);

  return { provider, signer, address, chainOk, hasProvider, connect, switchToSepolia };
}
