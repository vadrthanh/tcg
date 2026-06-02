// Centralised ABI loading. JSON files are written by `npm run copy-abi`.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ABI_DIR   = join(__dirname, "..", "..", "abi");

function load(name: string): any[] {
  return JSON.parse(readFileSync(join(ABI_DIR, `${name}.json`), "utf-8"));
}

export const nftAbi        = load("PokemonCardNFT");
export const gachaAbi      = load("GachaPack");
export const marketplaceAbi = load("Marketplace");
export const splitterAbi   = load("PaymentSplitter");
