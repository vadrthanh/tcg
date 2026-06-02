import { Router } from "express";
import { prisma } from "../lib/db.js";

export const transactionsRouter = Router();

// GET /api/transactions?address=0x...&type=card_bought&limit=50
transactionsRouter.get("/", async (req, res) => {
  const address = (req.query.address as string | undefined)?.toLowerCase();
  const type    =  req.query.type    as string | undefined;
  const limit   = Math.min(parseInt((req.query.limit as string) ?? "100", 10), 500);

  const where: any = {};
  if (type)    where.type = type;
  if (address) where.OR   = [{ from: address }, { to: address }];

  const txs = await prisma.transaction.findMany({
    where,
    orderBy: { blockNumber: "desc" },
    take:    limit,
  });

  res.json({
    count: txs.length,
    transactions: txs.map(t => ({ ...t, tokenIds: JSON.parse(t.tokenIds) })),
  });
});
