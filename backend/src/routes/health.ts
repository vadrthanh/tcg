import { Router } from "express";
import { prisma } from "../lib/db.js";
import { addresses } from "../lib/addresses.js";

export const healthRouter = Router();

// GET /api/health — indexer status + last synced block
healthRouter.get("/", async (_req, res) => {
  try {
    const state = await prisma.indexerState.findUnique({ where: { id: 1 } });
    res.json({
      ok:        true,
      chainId:   addresses.chainId,
      network:   addresses.network,
      lastBlock: state?.lastBlock ?? 0,
      contracts: {
        nft:         addresses.PokemonCardNFT,
        gacha:       addresses.GachaPack,
        marketplace: addresses.Marketplace,
        splitter:    addresses.PaymentSplitter,
      },
    });
  } catch (err: any) {
    const message = process.env.NODE_ENV === "production"
      ? "Internal server error"
      : (err.message ?? String(err));
    res.status(500).json({ ok: false, error: message });
  }
});
