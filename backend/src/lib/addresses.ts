import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADDR_PATH = join(__dirname, "..", "..", "..", "contracts", "deploy", "addresses.json");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface DeployedAddresses {
  network: string;
  chainId: number;
  deployer: string;
  PokemonCardNFT: string;
  PaymentSplitter: string;
  GachaPack: string;
  Marketplace: string;
  deployedAt: string;
  /** Block at which the contracts were deployed. Optional — derived from `deployedAt` if missing. */
  deployBlock?: number;
}

function envAddress(name: string, viteName: string) {
  return process.env[name]?.trim() || process.env[viteName]?.trim() || ZERO_ADDRESS;
}

function loadAddresses(): DeployedAddresses {
  if (existsSync(ADDR_PATH)) {
    return JSON.parse(readFileSync(ADDR_PATH, "utf-8"));
  }

  const deployBlock = parseInt(process.env.DEPLOY_BLOCK ?? "0", 10);

  return {
    network: process.env.CONTRACT_NETWORK?.trim() || "sepolia",
    chainId: parseInt(process.env.CHAIN_ID ?? process.env.VITE_CHAIN_ID ?? "11155111", 10),
    deployer: process.env.DEPLOYER_ADDRESS?.trim() || ZERO_ADDRESS,
    PokemonCardNFT: envAddress("POKEMON_CARD_NFT_ADDRESS", "VITE_POKEMON_CARD_NFT_ADDRESS"),
    PaymentSplitter: envAddress("PAYMENT_SPLITTER_ADDRESS", "VITE_PAYMENT_SPLITTER_ADDRESS"),
    GachaPack: envAddress("GACHA_PACK_ADDRESS", "VITE_GACHA_PACK_ADDRESS"),
    Marketplace: envAddress("MARKETPLACE_ADDRESS", "VITE_MARKETPLACE_ADDRESS"),
    deployedAt: process.env.DEPLOYED_AT?.trim() || "env",
    ...(deployBlock > 0 ? { deployBlock } : {}),
  };
}

export function assertAddressesConfigured() {
  const missing = [
    ["POKEMON_CARD_NFT_ADDRESS", addresses.PokemonCardNFT],
    ["PAYMENT_SPLITTER_ADDRESS", addresses.PaymentSplitter],
    ["GACHA_PACK_ADDRESS", addresses.GachaPack],
    ["MARKETPLACE_ADDRESS", addresses.Marketplace],
  ].filter(([, value]) => value === ZERO_ADDRESS);

  if (missing.length > 0) {
    throw new Error(
      "Contract addresses are not configured. Run contracts/scripts/deploy.ts to create " +
      "contracts/deploy/addresses.json, or set " +
      missing.map(([name]) => `${name} (or VITE_${name})`).join(", ") +
      " in backend/.env."
    );
  }
}

export const addresses: DeployedAddresses = loadAddresses();
