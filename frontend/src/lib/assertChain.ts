// Re-check the wallet is on the correct network (Sepolia) RIGHT BEFORE every
// write tx. The connect-time chain check is not enough: the user can switch
// network in the wallet afterwards, which would otherwise send the write
// (open pack / list / buy / claim) to the wrong chain. Throws a clear message;
// callers already wrap writes in try/catch and surface it as a toast.
//
// Relies on useWallet's chainChanged listener replacing `provider` on a switch,
// so the provider passed here always reflects the current network.

import type { BrowserProvider } from "ethers";
import { CHAIN_ID } from "../config/contracts";

export async function assertChain(provider: BrowserProvider | null): Promise<void> {
  if (!provider) throw new Error("Wallet not connected");
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== CHAIN_ID) {
    throw new Error("Wrong network — switch to Sepolia and try again");
  }
}
