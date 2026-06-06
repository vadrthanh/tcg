// Express API server. Reads from SQLite (populated by indexer.ts).
// All writes go directly to the chain via the user's wallet — this is a read replica.

import "dotenv/config";
import express from "express";
import cors    from "cors";
import { rateLimit } from "express-rate-limit";

import { cardsRouter }        from "./routes/cards.js";
import { nftsRouter }         from "./routes/nfts.js";
import { listingsRouter }     from "./routes/listings.js";
import { transactionsRouter } from "./routes/transactions.js";
import { statsRouter }        from "./routes/stats.js";
import { healthRouter }       from "./routes/health.js";

const PORT = parseInt(process.env.PORT ?? "4000", 10);

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(rateLimit({
  windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS ?? "900000", 10),
  limit:    parseInt(process.env.API_RATE_LIMIT_MAX ?? "100", 10),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests" },
}));
app.use(express.json());

// Request log — minimal one-liner.
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

app.use("/api/cards",        cardsRouter);
app.use("/api/nfts",         nftsRouter);
app.use("/api/listings",     listingsRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/stats",        statsRouter);
app.use("/api/health",       healthRouter);

app.get("/", (_req, res) => {
  res.json({
    name: "TCG Backend",
    endpoints: [
      "GET /api/cards",
      "GET /api/cards/:cardId",
      "GET /api/cards/rarity/:rarity",
      "GET /api/nfts?owner=0x...",
      "GET /api/nfts/:tokenId",
      "GET /api/listings?status=active&rarity=Rare&seller=0x...",
      "GET /api/listings/:tokenId",
      "GET /api/transactions?address=0x...&type=card_bought",
      "GET /api/stats",
      "GET /api/stats/rarity",
      "GET /api/health",
    ],
  });
});

// Centralised error handler.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  const status = Number(err.statusCode ?? err.status ?? 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const message = process.env.NODE_ENV === "production"
    ? "Internal server error"
    : (err.message ?? String(err));
  res.status(safeStatus).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});
