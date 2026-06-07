// Add new card template(s) to the ALREADY-DEPLOYED PokemonCardNFT pool.
//
// Card templates are write-once on-chain, so this script only adds cards whose
// cardId is not already in the pool — append new entries to
// contracts/data/pokemon-cards.json, then run this. No redeploy needed.
//
//   npx hardhat run scripts/add-card.ts --network sepolia
//
// After it finishes, re-seed the backend DB so the API/Collection page shows the
// new card:  cd ../backend && npm run seed
//
// The signer must hold POOL_MANAGER_ROLE on the NFT (the deployer does by default).

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const RARITY_MAP: Record<string, number> = {
  Common: 0, Uncommon: 1, Rare: 2, UltraRare: 3, Legendary: 4,
};

async function main() {
  const cardsJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../data/pokemon-cards.json"), "utf-8"),
  );
  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../deploy/addresses.json"), "utf-8"),
  );

  const [signer] = await ethers.getSigners();
  const nft = await ethers.getContractAt("PokemonCardNFT", addresses.PokemonCardNFT, signer);
  console.log(`NFT:    ${addresses.PokemonCardNFT}`);
  console.log(`Signer: ${signer.address}`);

  // Royalty split per card — matches the deploy script (platform 3% + artist 2%).
  // Edit these if a card has different receivers.
  const platform = { receiver: signer.address, feeBps: 300 };
  const artist   = { receiver: signer.address, feeBps: 200 };

  let added = 0;
  for (const c of cardsJson.cards) {
    // Skip cards already in the pool (maxSupply != 0 means the slot is occupied).
    const existing = await nft.cardPool(c.cardId);
    if (existing.maxSupply !== 0n) continue;

    const template = {
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
    };

    const tx = await nft.addCardToPool(template, [platform, artist]);
    await tx.wait();
    console.log(`  + #${c.cardId} ${c.name} (${c.rarity}) — added ✓`);
    added++;
  }

  console.log(added ? `\nDone. Added ${added} new card(s).` : "\nNothing to add — pool already matches the JSON.");
}

main().catch((err) => { console.error(err); process.exit(1); });
