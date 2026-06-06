import { useState, useCallback } from "react";
import { BrowserProvider, JsonRpcSigner } from "ethers";
import { CHAIN_ID } from "../config/contracts";

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

  const connect = useCallback(async () => {
    setError(null);
    try {
      if (!window.ethereum) {
        // MetaMask only injects window.ethereum in a secure context (HTTPS, or
        // localhost during dev). A plain-HTTP origin won't have a provider.
        throw new Error(
          window.isSecureContext
            ? "MetaMask not detected. Install the extension and reload the page."
            : "MetaMask can't connect because this page isn't served over HTTPS. " +
              "Open it via its https:// address."
        );
      }
      const p = new BrowserProvider(window.ethereum);
      await p.send("eth_requestAccounts", []);
      const s   = await p.getSigner();
      const net = await p.getNetwork();
      setProvider(p);
      setSigner(s);
      setAddress(await s.getAddress());
      setChainOk(Number(net.chainId) === CHAIN_ID);
    } catch (err: unknown) {
      // Surface the real reason — connect() is wired to onClick with no catch,
      // so an uncaught throw would otherwise vanish as an unhandled rejection.
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const switchToSepolia = useCallback(async () => {
    setError(null);
    try {
      await window.ethereum!.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + CHAIN_ID.toString(16) }],
      });
      if (provider) {
        const net = await provider.getNetwork();
        setChainOk(Number(net.chainId) === CHAIN_ID);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [provider]);

  return { provider, signer, address, chainOk, error, connect, switchToSepolia };
}
