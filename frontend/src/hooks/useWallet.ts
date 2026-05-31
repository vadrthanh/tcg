import { useState, useCallback } from "react";
import { BrowserProvider, JsonRpcSigner } from "ethers";
import { CHAIN_ID } from "../config/contracts";

export interface WalletState {
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  address: string | null;
  chainOk: boolean;
  connect: () => Promise<void>;
  switchToSepolia: () => Promise<void>;
}

export function useWallet(): WalletState {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner]     = useState<JsonRpcSigner | null>(null);
  const [address, setAddress]   = useState<string | null>(null);
  const [chainOk, setChainOk]   = useState(false);

  const connect = useCallback(async () => {
    if (!window.ethereum) throw new Error("MetaMask not detected");
    const p = new BrowserProvider(window.ethereum);
    await p.send("eth_requestAccounts", []);
    const s   = await p.getSigner();
    const net = await p.getNetwork();
    setProvider(p);
    setSigner(s);
    setAddress(await s.getAddress());
    setChainOk(Number(net.chainId) === CHAIN_ID);
  }, []);

  const switchToSepolia = useCallback(async () => {
    await window.ethereum!.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x" + CHAIN_ID.toString(16) }],
    });
    if (provider) {
      const net = await provider.getNetwork();
      setChainOk(Number(net.chainId) === CHAIN_ID);
    }
  }, [provider]);

  return { provider, signer, address, chainOk, connect, switchToSepolia };
}
