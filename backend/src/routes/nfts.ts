import { Router } from "express";
import { prisma } from "../lib/db.js";
import { asyncRoute } from "../lib/async-route.js";

export const nftsRouter = Router();

// GET /api/nfts?owner=0x...
nftsRouter.get("/", asyncRoute(async (req, res) => {
  const owner = (req.query.owner as string | undefined)?.toLowerCase();
  if (!owner) return res.status(400).json({ error: "owner query param required" });

  const nfts = await prisma.mintedNFT.findMany({
    where:   { owner },
    orderBy: { mintedAt: "desc" },
    include: { card: true },
  });
  res.json({ owner, count: nfts.length, nfts });
}));

// GET /api/nfts/:tokenId
nftsRouter.get("/:tokenId", asyncRoute(async (req, res) => {
  const tokenId = parseInt(req.params.tokenId, 10);
  if (!Number.isInteger(tokenId)) return res.status(400).json({ error: "tokenId must be int" });

  const nft = await prisma.mintedNFT.findUnique({
    where: { tokenId },
    include: {
      card: true,
      listings: {
        orderBy: { id: "desc" },
        take:    10,
      },
    },
  });
  if (!nft) return res.status(404).json({ error: "nft not found" });

  const activeListing = nft.listings.find(l => l.status === "active") ?? null;
  res.json({ nft, activeListing });
}));
