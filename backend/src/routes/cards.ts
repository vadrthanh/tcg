import { Router } from "express";
import { prisma } from "../lib/db.js";

const RARITIES = new Set(["Common", "Uncommon", "Rare", "UltraRare", "Legendary"]);

export const cardsRouter = Router();

// GET /api/cards — all cards, sorted by id
cardsRouter.get("/", async (_req, res) => {
  const cards = await prisma.card.findMany({ orderBy: { id: "asc" } });
  res.json({ cards });
});

// GET /api/cards/rarity/:rarity — filtered by rarity
cardsRouter.get("/rarity/:rarity", async (req, res) => {
  const rarity = req.params.rarity;
  if (!RARITIES.has(rarity)) {
    return res.status(400).json({ error: `Unknown rarity. One of: ${[...RARITIES].join(", ")}` });
  }
  const cards = await prisma.card.findMany({
    where:   { rarity },
    orderBy: { id: "asc" },
  });
  res.json({ rarity, cards });
});

// GET /api/cards/:cardId — single card with mint history (last 50)
cardsRouter.get("/:cardId", async (req, res) => {
  const id = parseInt(req.params.cardId, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "cardId must be int" });

  const card = await prisma.card.findUnique({
    where: { id },
    include: {
      mintedNfts: {
        orderBy: { mintedAt: "desc" },
        take:    50,
        select:  { tokenId: true, owner: true, mintedAt: true, txHash: true },
      },
    },
  });
  if (!card) return res.status(404).json({ error: "card not found" });
  res.json({ card });
});
