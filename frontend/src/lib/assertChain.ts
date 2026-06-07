// Verify the wallet is on the correct network (Sepolia) RIGHT BEFORE every write tx.
//
// Why: the user can switch network in MetaMask AFTER connecting. Without a
// re-check, a write (buy/list/claim/open pack) would be sent to the wrong
// network. This throws a clear error; callers already wrap writes in try/catch
// and show a toast, so the user sees "Wrong network…" instead of a failed tx.

import type { BrowserProvider } from "ethers";
import { CHAIN_ID } from "../config/contracts";

export async function assertChain(provider: BrowserProvider | null): Promise<void> {
  if (!provider) throw new Error("Wallet not connected");
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== CHAIN_ID) {
    throw new Error("Wrong network — please switch to Sepolia and try again");
  }
}
