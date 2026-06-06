import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ─── Load card data ──────────────────────────────────────────────────────────
const CARDS_JSON = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../data/pokemon-cards.json"), "utf-8")
);

const RARITY_MAP: Record<string, number> = {
  Common: 0, Uncommon: 1, Rare: 2, UltraRare: 3, Legendary: 4,
};

/// Merge the given key=value pairs into frontend/.env, preserving any other
/// lines (e.g. VITE_API_BASE_URL) and comments. Seeds from frontend/.env.example
/// when no .env exists yet. The frontend reads addresses from VITE_* env vars
/// (not deploy/addresses.json), so this is what makes the UI target the live
/// contracts after a deploy — see CLAUDE.md.
function upsertFrontendEnv(vars: Record<string, string>) {
  const envPath     = path.join(__dirname, "../../frontend/.env");
  const examplePath = path.join(__dirname, "../../frontend/.env.example");

  let lines: string[] = [];
  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, "utf-8").split("\n");
  } else if (fs.existsSync(examplePath)) {
    lines = fs.readFileSync(examplePath, "utf-8").split("\n");
  }

  const remaining = new Set(Object.keys(vars));
  const updated = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && vars[m[1]] !== undefined) {
      remaining.delete(m[1]);
      return `${m[1]}=${vars[m[1]]}`;
    }
    return line;
  });
  for (const key of remaining) updated.push(`${key}=${vars[key]}`);

  fs.writeFileSync(envPath, updated.join("\n"));
}

// Royalty receivers: platform gets 300 bps (3%), artist gets 200 bps (2%)
// In production replace these with real addresses.
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying from:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  // ── 1. PokemonCardNFT ──────────────────────────────────────────────────────
  console.log("1. Deploying PokemonCardNFT...");
  const NFT = await ethers.getContractFactory("PokemonCardNFT");
  const nft = await NFT.deploy(deployer.address);
  await nft.waitForDeployment();
  const nftAddr = await nft.getAddress();
  console.log("   PokemonCardNFT:", nftAddr);

  // ── 2. PaymentSplitter ────────────────────────────────────────────────────
  console.log("2. Deploying PaymentSplitter...");
  const Splitter = await ethers.getContractFactory("PaymentSplitter");
  const splitter = await Splitter.deploy(deployer.address);
  await splitter.waitForDeployment();
  const splitterAddr = await splitter.getAddress();
  console.log("   PaymentSplitter:", splitterAddr);

  // ── 3. GachaPack ──────────────────────────────────────────────────────────
  console.log("3. Deploying GachaPack...");
  // Platform treasury = deployer for demo; issuer = deployer for demo
  const Gacha = await ethers.getContractFactory("GachaPack");
  const gacha = await Gacha.deploy(
    nftAddr, splitterAddr,
    deployer.address, // platformTreasury
    deployer.address, // issuer
    8000              // 80% platform fee on pack revenue
  );
  await gacha.waitForDeployment();
  const gachaAddr = await gacha.getAddress();
  console.log("   GachaPack:", gachaAddr);

  // ── 4. Marketplace ────────────────────────────────────────────────────────
  console.log("4. Deploying Marketplace...");
  const Market = await ethers.getContractFactory("Marketplace");
  const market = await Market.deploy(
    nftAddr, splitterAddr,
    deployer.address, // platformTreasury
    250               // 2.5% platform fee
  );
  await market.waitForDeployment();
  const marketAddr = await market.getAddress();
  console.log("   Marketplace:", marketAddr);

  // ── 5. Wire permissions ───────────────────────────────────────────────────
  console.log("\n5. Wiring permissions...");
  const MINTER_ROLE    = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const DEPOSITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DEPOSITOR_ROLE"));

  await (await nft.grantRole(MINTER_ROLE, gachaAddr)).wait();
  console.log("   MINTER_ROLE → GachaPack ✓");

  await (await splitter.grantRole(DEPOSITOR_ROLE, gachaAddr)).wait();
  console.log("   DEPOSITOR_ROLE → GachaPack ✓");

  await (await splitter.grantRole(DEPOSITOR_ROLE, marketAddr)).wait();
  console.log("   DEPOSITOR_ROLE → Marketplace ✓");

  // ── 6. Seed card pool ─────────────────────────────────────────────────────
  console.log("\n6. Seeding 40-card pool from pokemon-cards.json...");

  const templates = CARDS_JSON.cards.map((c: any) => ({
    cardId:        c.cardId,
    name:          c.name,
    rarity:        RARITY_MAP[c.rarity],
    pokemonType:   c.pokemonType,
    hp:            c.hp,
    attack:        c.attack,
    maxSupply:     c.maxSupply,
    currentSupply: 0,
    floorPrice:    ethers.parseEther(c.floorPrice),
    imageURI:      c.imageURI,
  }));

  // Seed in batches of 10 to stay under gas limits
  const BATCH = 10;
  for (let i = 0; i < templates.length; i += BATCH) {
    const batch = templates.slice(i, i + BATCH);
    await (await nft.batchAddCards(
      batch,
      deployer.address, 300, // platform 3%
      deployer.address, 200  // artist 2%
    )).wait();
    console.log(`   Seeded cards ${i + 1}–${Math.min(i + BATCH, templates.length)} ✓`);
  }

  // ── 7. Save addresses ─────────────────────────────────────────────────────
  const addresses = {
    network:        (await ethers.provider.getNetwork()).name,
    chainId:        Number((await ethers.provider.getNetwork()).chainId),
    deployer:       deployer.address,
    PokemonCardNFT: nftAddr,
    PaymentSplitter: splitterAddr,
    GachaPack:      gachaAddr,
    Marketplace:    marketAddr,
    deployedAt:     new Date().toISOString(),
  };

  const outDir = path.join(__dirname, "../deploy");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const outPath = path.join(outDir, "addresses.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log("\n7. Addresses saved to deploy/addresses.json (backend read replica)");

  // Mirror addresses into frontend/.env so the UI targets the live contracts
  // immediately (L-07): without this the frontend keeps all-zero VITE_* vars
  // and every call silently targets the zero address.
  upsertFrontendEnv({
    VITE_CHAIN_ID:                 String(addresses.chainId),
    VITE_POKEMON_CARD_NFT_ADDRESS: nftAddr,
    VITE_PAYMENT_SPLITTER_ADDRESS: splitterAddr,
    VITE_GACHA_PACK_ADDRESS:       gachaAddr,
    VITE_MARKETPLACE_ADDRESS:      marketAddr,
  });
  console.log("   Frontend VITE_* addresses synced to frontend/.env");

  // ── 8. Summary ────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("DEPLOYMENT COMPLETE");
  console.log("─".repeat(60));
  console.log("PokemonCardNFT :", nftAddr);
  console.log("PaymentSplitter:", splitterAddr);
  console.log("GachaPack      :", gachaAddr);
  console.log("Marketplace    :", marketAddr);
  console.log("─".repeat(60));
  console.log("Card pool seeded: 40 cards");
  console.log("\nNext: npm run verify:sepolia");
}

main().catch((err) => { console.error(err); process.exit(1); });
