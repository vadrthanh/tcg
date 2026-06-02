// Copies the `abi` array from each Hardhat artifact into backend/abi/<Name>.json.
// Keeps the backend decoupled from the contracts workspace at runtime.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const ARTIFACTS = join(REPO_ROOT, "contracts", "artifacts", "src");
const OUT_DIR   = join(__dirname, "..", "..", "abi");

const CONTRACTS = ["PokemonCardNFT", "GachaPack", "Marketplace", "PaymentSplitter"];

mkdirSync(OUT_DIR, { recursive: true });

for (const name of CONTRACTS) {
  const artifactPath = join(ARTIFACTS, `${name}.sol`, `${name}.json`);
  const artifact     = JSON.parse(readFileSync(artifactPath, "utf-8"));
  const outPath      = join(OUT_DIR, `${name}.json`);
  writeFileSync(outPath, JSON.stringify(artifact.abi, null, 2));
  console.log(`  ${name} -> abi/${name}.json (${artifact.abi.length} entries)`);
}
