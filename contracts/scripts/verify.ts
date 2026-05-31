import { run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const addrPath = path.join(__dirname, "../deploy/addresses.json");
  if (!fs.existsSync(addrPath)) {
    throw new Error("addresses.json not found — run deploy:sepolia first");
  }
  const addrs = JSON.parse(fs.readFileSync(addrPath, "utf-8"));
  const deployer = addrs.deployer;

  console.log("Verifying contracts on Etherscan (Sepolia)...\n");

  const contracts: [string, string, any[]][] = [
    ["PokemonCardNFT",  addrs.PokemonCardNFT,  [deployer]],
    ["PaymentSplitter", addrs.PaymentSplitter, [deployer]],
    ["GachaPack",       addrs.GachaPack,       [
      addrs.PokemonCardNFT, addrs.PaymentSplitter,
      deployer, deployer, 8000,
    ]],
    ["Marketplace",     addrs.Marketplace,     [
      addrs.PokemonCardNFT, addrs.PaymentSplitter,
      deployer, 250,
    ]],
  ];

  for (const [name, address, args] of contracts) {
    console.log(`Verifying ${name} @ ${address}...`);
    try {
      await run("verify:verify", { address, constructorArguments: args });
      console.log(`  ✓ ${name} verified`);
    } catch (e: any) {
      if (e.message?.includes("Already Verified")) {
        console.log(`  ✓ ${name} already verified`);
      } else {
        console.error(`  ✗ ${name} failed:`, e.message);
      }
    }
    console.log();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
