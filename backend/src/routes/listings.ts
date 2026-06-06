import { Router } from "express";
import { prisma } from "../lib/db.js";
import { asyncRoute } from "../lib/async-route.js";

const RARITIES = new Set(["Common", "Uncommon", "Rare", "UltraRare", "Legendary"]);

export const listingsRouter = Router();

// GET /api/listings?status=active&rarity=Rare&seller=0x...
listingsRouter.get("/", asyncRoute(async (req, res) => {
  const status  = (req.query.status  as string | undefined) ?? "active";
  const rarity  =  req.query.rarity  as string | undefined;
  const seller  = (req.query.seller  as string | undefined)?.toLowerCase();

  if (rarity && !RARITIES.has(rarity)) {
    return res.status(400).json({ error: `Unknown rarity. One of: ${[...RARITIES].join(", ")}` });
  }

  const where: any = { status };
  if (seller) where.seller = seller;
  if (rarity) where.card   = { rarity };

  const listings = await prisma.listing.findMany({
    where,
    orderBy: { listedAt: "desc" },
    include: { card: true, nft: { select: { owner: true } } },
  });
  res.json({ count: listings.length, listings });
}));

// GET /api/listings/:tokenId — current active listing + history
listingsRouter.get("/:tokenId", asyncRoute(async (req, res) => {
  const tokenId = parseInt(req.params.tokenId, 10);
  if (!Number.isInteger(tokenId)) return res.status(400).json({ error: "tokenId must be int" });

  const listings = await prisma.listing.findMany({
    where:   { tokenId },
    orderBy: { id: "desc" },
    include: { card: true },
  });
  if (listings.length === 0) return res.status(404).json({ error: "no listings for tokenId" });

  const active = listings.find(l => l.status === "active") ?? null;
  res.json({ tokenId, active, history: listings });
}));
