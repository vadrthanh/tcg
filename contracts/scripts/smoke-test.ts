import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// On-chain smoke test for the deployed Sepolia stack.
// Exercises: openPack → assert mints + revenue → listCard → cancelListing → claim.
// Uses the deployer EOA only (no second signer needed) because in the demo
// deploy the deployer is both platformTreasury and issuer for GachaPack.

const addrs = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../deploy/addresses.json"), "utf-8")
);

const RARITY = ["Common", "Uncommon", "Rare", "Ultra Rare", "Legendary"];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Smoke test signer :", signer.address);
  console.log("Starting balance  :", ethers.formatEther(await ethers.provider.getBalance(signer.address)), "ETH\n");

  const nft     = await ethers.getContractAt("PokemonCardNFT",  addrs.PokemonCardNFT);
  const gacha   = await ethers.getContractAt("GachaPack",       addrs.GachaPack);
  const market  = await ethers.getContractAt("Marketplace",     addrs.Marketplace);
  const split   = await ethers.getContractAt("PaymentSplitter", addrs.PaymentSplitter);

  // ── 1. Pre-state ─────────────────────────────────────────────────────────
  const claimableBefore = await split.claimable(signer.address);
  console.log("STEP 1  claimable balance before pack-open :", ethers.formatEther(claimableBefore), "ETH");

  // ── 2. Open one pack ────────────────────────────────────────────────────
  // Lower price first so the smoke test fits in the remaining gas budget.
  const TEST_PRICE = ethers.parseEther("0.0005");
  const currentPrice = await gacha.packPrice();
  if (currentPrice !== TEST_PRICE) {
    console.log("        adjusting packPrice from", ethers.formatEther(currentPrice), "to", ethers.formatEther(TEST_PRICE), "ETH for the smoke test …");
    const txSet = await gacha.setPackPrice(TEST_PRICE);
    await txSet.wait();
  }
  const packPrice = await gacha.packPrice();
  console.log("\nSTEP 2  opening pack for", ethers.formatEther(packPrice), "ETH …");
  const txOpen = await gacha.openPack({ value: packPrice });
  const rcOpen = await txOpen.wait();
  console.log("        tx hash      :", rcOpen?.hash);
  console.log("        gas used     :", rcOpen?.gasUsed.toString());

  const packLog = rcOpen!.logs
    .map((l: any) => { try { return gacha.interface.parseLog(l); } catch { return null; } })
    .find((p: any) => p?.name === "PackOpened");
  if (!packLog) throw new Error("PackOpened event not found");

  const tokenIds = packLog.args.tokenIds as bigint[];
  const cardIds  = packLog.args.cardIds  as bigint[];
  const rarities = packLog.args.rarities as bigint[];

  console.log("        5 cards minted:");
  for (let i = 0; i < 5; i++) {
    const card = await nft.getCard(tokenIds[i]);
    console.log(`          token #${tokenIds[i]}  cardId ${cardIds[i]}  ${RARITY[Number(rarities[i])]}  — ${card.name}`);
  }

  // ── 3. Assert revenue routed to splitter ───────────────────────────────
  const claimableAfter = await split.claimable(signer.address);
  const credited       = claimableAfter - claimableBefore;
  console.log("\nSTEP 3  claimable delta              :", ethers.formatEther(credited), "ETH");
  if (credited !== packPrice) {
    throw new Error(`expected ${packPrice} credited, got ${credited}`);
  }
  console.log("        ✓ full pack price credited to deployer (platform+issuer in demo deploy)");

  // ── 4. List the first card on the marketplace ─────────────────────────
  const tokenToList = tokenIds[0];
  const price       = ethers.parseEther("0.005");
  console.log("\nSTEP 4  approving + listing token", tokenToList.toString(), "at 0.005 ETH …");

  const txApprove = await nft.approve(addrs.Marketplace, tokenToList);
  await txApprove.wait();

  const txList = await market.listCard(tokenToList, price);
  const rcList = await txList.wait();
  console.log("        list tx      :", rcList?.hash);

  const listing = await market.listings(tokenToList);
  console.log("        listing      : seller", listing.seller, " price", ethers.formatEther(listing.price), "ETH");
  if (listing.seller !== signer.address)       throw new Error("listing seller mismatch");
  if (listing.price  !== price)                 throw new Error("listing price mismatch");

  // ── 5. Cancel the listing (skip self-buy to keep test cheap) ──────────
  console.log("\nSTEP 5  cancelling listing …");
  const txCancel = await market.cancelListing(tokenToList);
  await txCancel.wait();
  const after    = await market.listings(tokenToList);
  if (after.price !== 0n) throw new Error("cancel did not clear listing");
  console.log("        ✓ listing cleared");

  // ── 6. Claim the pack revenue from the splitter ───────────────────────
  console.log("\nSTEP 6  claiming", ethers.formatEther(claimableAfter), "ETH from splitter …");
  const txClaim = await split.claim();
  const rcClaim = await txClaim.wait();
  console.log("        claim tx     :", rcClaim?.hash);

  const claimableFinal = await split.claimable(signer.address);
  if (claimableFinal !== 0n) throw new Error(`expected 0 claimable after claim, got ${claimableFinal}`);
  console.log("        ✓ balance zeroed");

  // ── 7. Final state ────────────────────────────────────────────────────
  const balFinal = await ethers.provider.getBalance(signer.address);
  console.log("\nFinal balance  :", ethers.formatEther(balFinal), "ETH");

  console.log("\n" + "─".repeat(60));
  console.log("SMOKE TEST PASSED");
  console.log("─".repeat(60));
  console.log(`Etherscan: https://sepolia.etherscan.io/address/${signer.address}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
