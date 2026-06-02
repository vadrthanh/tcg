import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADDR_PATH = join(__dirname, "..", "..", "..", "contracts", "deploy", "addresses.json");

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

export const addresses: DeployedAddresses =
  JSON.parse(readFileSync(ADDR_PATH, "utf-8"));
