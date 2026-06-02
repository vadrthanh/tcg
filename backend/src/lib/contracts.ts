// Ethers v6 contract instances bound to a provider — used by the indexer.

import { Contract, JsonRpcProvider, WebSocketProvider, type Provider } from "ethers";
import { addresses } from "./addresses.js";
import { nftAbi, gachaAbi, marketplaceAbi, splitterAbi } from "./abis.js";

export function makeProvider(): Provider {
  const wss = process.env.SEPOLIA_RPC_WSS?.trim();
  if (wss) {
    console.log(`[indexer] using WSS provider`);
    return new WebSocketProvider(wss);
  }
  const http = process.env.SEPOLIA_RPC_URL?.trim();
  if (!http) throw new Error("Set SEPOLIA_RPC_URL (or SEPOLIA_RPC_WSS) in .env");
  console.log(`[indexer] using HTTPS polling provider`);
  return new JsonRpcProvider(http);
}

export function makeContracts(provider: Provider) {
  return {
    nft:         new Contract(addresses.PokemonCardNFT,  nftAbi,         provider),
    gacha:       new Contract(addresses.GachaPack,       gachaAbi,       provider),
    marketplace: new Contract(addresses.Marketplace,     marketplaceAbi, provider),
    splitter:    new Contract(addresses.PaymentSplitter, splitterAbi,    provider),
  };
}
