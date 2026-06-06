import { Router } from "express";
import { prisma } from "../lib/db.js";
import { asyncRoute } from "../lib/async-route.js";

export const statsRouter = Router();

// GET /api/stats — high-level totals
statsRouter.get("/", asyncRoute(async (_req, res) => {
  const [totalCards, totalMinted, totalListed, totalSold, claims] = await Promise.all([
    prisma.card.count(),
    prisma.mintedNFT.count(),
    prisma.listing.count(),
    prisma.listing.count({ where: { status: "sold" } }),
    prisma.royaltyClaim.findMany({ select: { amount: true } }),
  ]);

  // Sum ETH amounts as strings (sum of strings — use BigInt via wei = parseEther-ish split).
  // Simpler: sum the numeric value as Number (lossy past 2^53 but fine for capstone scale).
  const totalRoyaltyClaimedEth = claims
    .reduce((acc, c) => acc + Number(c.amount), 0)
    .toFixed(6);

  res.json({
    totalCardTemplates:    totalCards,
    totalNftsMinted:       totalMinted,
    totalListingsAllTime:  totalListed,
    totalListingsSold:     totalSold,
    totalRoyaltyClaimedEth,
  });
}));

// GET /api/stats/rarity — remaining supply per rarity tier
statsRouter.get("/rarity", asyncRoute(async (_req, res) => {
  const cards = await prisma.card.findMany({
    select: { rarity: true, maxSupply: true, currentSupply: true },
  });

  const buckets: Record<string, { max: number; minted: number; remaining: number; cards: number }> = {};
  for (const c of cards) {
    const b = buckets[c.rarity] ??= { max: 0, minted: 0, remaining: 0, cards: 0 };
    b.max       += c.maxSupply;
    b.minted    += c.currentSupply;
    b.remaining += c.maxSupply - c.currentSupply;
    b.cards     += 1;
  }
  res.json({ byRarity: buckets });
}));
