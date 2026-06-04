/**
 * seedCards.ts — Person 1 helper script
 *
 * Reads contracts/data/pokemon-cards.json and calls batchAddCards()
 * on the deployed PokemonCardNFT contract.
 *
 * Usage (after full deploy.ts has run):
 *   npx hardhat run scripts/seedCards.ts --network localhost
 *   npx hardhat run scripts/seedCards.ts --network sepolia
 *
 * The script splits the 40-card array into two batches of 20 to stay well
 * under the block gas limit (mitigation for "Gas too high for batchAddCards(40)"
 * risk listed in the plan).
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

interface RawCard {
  cardId: number;
  name: string;
  rarity: "Common" | "Uncommon" | "Rare" | "UltraRare" | "Legendary";
  pokemonType: "Fire" | "Water" | "Grass" | "Lightning" | "Psychic" | "Fighting" | "Colorless";
  hp: number;
  attack: string;
  maxSupply: number;
  floorPrice: string; // ETH string, e.g. "0.001"
  imageURI: string;
}

// ─── Enum mappings (must match Solidity enum order) ──────────────────────────

const RARITY: Record<string, number> = {
  Common:    0,
  Uncommon:  1,
  Rare:      2,
  UltraRare: 3,
  Legendary: 4,
};

const POKEMON_TYPE: Record<string, number> = {
  Fire:      0,
  Water:     1,
  Grass:     2,
  Lightning: 3,
  Psychic:   4,
  Fighting:  5,
  Colorless: 6,
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // ── Load addresses ──────────────────────────────────────────────────────
  const addressesPath = path.join(__dirname, "../deploy/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    throw new Error(
      "addresses.json not found. Run the full deploy script first."
    );
  }
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf-8"));
  const nftAddress: string = addresses.PokemonCardNFT;
  if (!nftAddress) throw new Error("PokemonCardNFT address missing from addresses.json");

  // ── Connect to contract ─────────────────────────────────────────────────
  const [deployer] = await ethers.getSigners();
  console.log(`Seeding cards from: ${deployer.address}`);
  console.log(`PokemonCardNFT at:  ${nftAddress}`);

  const nft = await ethers.getContractAt("PokemonCardNFT", nftAddress, deployer);

  // ── Load card data ──────────────────────────────────────────────────────
  const jsonPath = path.join(__dirname, "../data/pokemon-cards.json");
  const raw: RawCard[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  console.log(`\nLoaded ${raw.length} cards from pokemon-cards.json`);

  // ── Map to on-chain struct format ───────────────────────────────────────
  const templates = raw.map((c) => ({
    cardId:        c.cardId,
    rarity:        RARITY[c.rarity],
    pokemonType:   POKEMON_TYPE[c.pokemonType],
    hp:            c.hp,
    maxSupply:     c.maxSupply,
    currentSupply: 0,
    floorPrice:    ethers.parseEther(c.floorPrice),
    name:          c.name,
    attack:        c.attack,
    imageURI:      c.imageURI,
  }));

  // ── Split into batches of 20 (gas safety) ──────────────────────────────
  const BATCH_SIZE = 20;
  const batches: typeof templates[] = [];
  for (let i = 0; i < templates.length; i += BATCH_SIZE) {
    batches.push(templates.slice(i, i + BATCH_SIZE));
  }

  console.log(`\nSeeding in ${batches.length} batch(es) of ≤${BATCH_SIZE} cards each...\n`);

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const cardNames = batch.map((c) => c.name).join(", ");
    console.log(`Batch ${b + 1}/${batches.length}: [${cardNames}]`);

    const tx = await nft.batchAddCards(batch);
    const receipt = await tx.wait();
    console.log(`  ✓ tx: ${tx.hash}  (gas used: ${receipt?.gasUsed?.toString()})\n`);
  }

  // ── Verify with getPoolStatus ───────────────────────────────────────────
  console.log("Verifying pool status...");
  const [cardIds, remaining] = await nft.getPoolStatus();
  console.log(`\nPool contains ${cardIds.length} card templates.`);

  let totalRemaining = 0n;
  for (let i = 0; i < cardIds.length; i++) {
    totalRemaining += remaining[i];
  }
  console.log(`Total remaining supply across all cards: ${totalRemaining.toString()}`);

  // Print rarity breakdown
  const rarityNames = ["Common", "Uncommon", "Rare", "UltraRare", "Legendary"];
  for (let r = 0; r < 5; r++) {
    const available = await nft.getAvailableCardIds(r);
    const tierSupply = templates
      .filter((t) => t.rarity === r)
      .reduce((sum, t) => sum + t.maxSupply, 0);
    console.log(
      `  ${rarityNames[r].padEnd(10)}: ${available.length} card(s), ` +
      `${tierSupply} total supply`
    );
  }

  console.log("\n✅ Card seeding complete.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
