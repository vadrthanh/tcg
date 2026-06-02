// Seeds the Card table from contracts/data/pokemon-cards.json.
// Run with: npm run seed

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POOL_PATH = join(
  __dirname, "..", "..", "..", "contracts", "data", "pokemon-cards.json"
);

interface SourceCard {
  cardId:       number;
  name:         string;
  rarity:       "Common" | "Uncommon" | "Rare" | "UltraRare" | "Legendary";
  pokemonType:  string;
  hp:           number;
  attack:       string;
  maxSupply:    number;
  floorPrice:   string;
  imageURI:     string;
}

interface PoolFile {
  cards: SourceCard[];
}

async function main() {
  const raw  = readFileSync(POOL_PATH, "utf-8");
  const data: PoolFile = JSON.parse(raw);

  console.log(`Seeding ${data.cards.length} cards from ${POOL_PATH}`);

  for (const card of data.cards) {
    await prisma.card.upsert({
      where:  { id: card.cardId },
      update: {
        name:        card.name,
        rarity:      card.rarity,
        pokemonType: card.pokemonType,
        hp:          card.hp,
        attack:      card.attack,
        maxSupply:   card.maxSupply,
        floorPrice:  card.floorPrice,
        imageURI:    card.imageURI,
      },
      create: {
        id:            card.cardId,
        name:          card.name,
        rarity:        card.rarity,
        pokemonType:   card.pokemonType,
        hp:            card.hp,
        attack:        card.attack,
        maxSupply:     card.maxSupply,
        currentSupply: 0,
        floorPrice:    card.floorPrice,
        imageURI:      card.imageURI,
      },
    });
  }

  // Initialise indexer state if it's missing.
  await prisma.indexerState.upsert({
    where:  { id: 1 },
    update: {},
    create: { id: 1, lastBlock: 0 },
  });

  const count = await prisma.card.count();
  console.log(`Done. Card table now has ${count} rows.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
