// Sepolia event indexer.
//
// On startup:
//   1. Load IndexerState.lastBlock (or fall back to addresses.deployBlock / env)
//   2. Catch up via getLogs() in INDEXER_BATCH_BLOCKS chunks
//   3. Switch to either:
//      - WebSocket subscriptions (if SEPOLIA_RPC_WSS set), or
//      - HTTPS polling every INDEXER_POLL_INTERVAL_MS
//
// Events captured:
//   PokemonCardNFT.CardMinted         (only useful for owner-on-mint when card not from gacha)
//   GachaPack.PackOpened              -> insert 5× MintedNFT, bump Card.currentSupply, Transaction(pack_opened)
//   Marketplace.Listed                -> Listing(active), Transaction(card_listed)
//   Marketplace.Purchased             -> Listing.status=sold + buyer + soldAt, MintedNFT.owner=buyer, Transaction(card_bought)
//   Marketplace.ListingCancelled      -> Listing.status=cancelled, Transaction(card_cancelled)
//   PaymentSplitter.Claimed           -> RoyaltyClaim

import "dotenv/config";

import { openSync, closeSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type EventLog, type Log, type Provider } from "ethers";
import { prisma } from "./lib/db.js";
import { addresses } from "./lib/addresses.js";
import { makeProvider, makeContracts } from "./lib/contracts.js";
import { isUniqueConstraintViolation } from "./lib/prisma-errors.js";

const BATCH = parseInt(process.env.INDEXER_BATCH_BLOCKS ?? "2000", 10);
const POLL  = parseInt(process.env.INDEXER_POLL_INTERVAL_MS ?? "15000", 10);
const LOCK_FILE = resolve(process.env.INDEXER_LOCK_FILE ?? ".indexer.lock");

let lockFd: number | undefined;

function acquireIndexerLock() {
  if (existsSync(LOCK_FILE)) {
    const pid = parseInt(readFileSync(LOCK_FILE, "utf-8"), 10);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch (err: any) {
        if (err?.code === "ESRCH") {
          unlinkSync(LOCK_FILE);
        } else {
          throw err;
        }
      }
    } else {
      unlinkSync(LOCK_FILE);
    }
  }

  try {
    lockFd = openSync(LOCK_FILE, "wx");
    writeFileSync(lockFd, `${process.pid}\n`);
  } catch (err: any) {
    if (err?.code === "EEXIST") {
      throw new Error(`indexer lock already held: ${LOCK_FILE}`);
    }
    throw err;
  }
}

function releaseIndexerLock() {
  if (lockFd === undefined) return;
  closeSync(lockFd);
  lockFd = undefined;
  try {
    unlinkSync(LOCK_FILE);
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────────

const lower = (s: string) => s.toLowerCase();
const ethStr = (wei: bigint) => {
  // Light-touch wei->ETH stringifier without losing precision (no float math).
  const s = wei.toString().padStart(19, "0");
  const head = s.slice(0, -18);
  const tail = s.slice(-18).replace(/0+$/, "");
  return tail.length ? `${head}.${tail}` : head;
};

async function getStartBlock(provider: Provider): Promise<number> {
  const state = await prisma.indexerState.findUnique({ where: { id: 1 } });
  if (state && state.lastBlock > 0) return state.lastBlock + 1;

  const env = parseInt(process.env.INDEXER_START_BLOCK ?? "0", 10);
  if (env > 0) return env;

  if (addresses.deployBlock) return addresses.deployBlock;

  // Worst case: start from a recent block to avoid scanning all of Sepolia.
  const latest = await provider.getBlockNumber();
  const fallback = Math.max(latest - 50_000, 0);
  console.warn(
    `[indexer] no lastBlock and no deployBlock — starting from ${fallback} ` +
    `(${latest - fallback} blocks behind tip). Set INDEXER_START_BLOCK in .env to override.`
  );
  return fallback;
}

async function saveLastBlock(block: number) {
  await prisma.indexerState.upsert({
    where:  { id: 1 },
    update: { lastBlock: block },
    create: { id: 1, lastBlock: block },
  });
}

// ─── event handlers ────────────────────────────────────────────────────────────
//
// Each handler is idempotent: it writes the Transaction marker inside the same
// transaction as side effects, and treats @@unique replay failures as no-ops.

interface EvtCtx { txHash: string; blockNumber: number; logIndex: number; }

async function handlePackOpened(args: any, ctx: EvtCtx) {
  const buyer:     string   = lower(args.buyer);
  const tokenIds:  bigint[] = [...args.tokenIds].map(BigInt);
  const cardIds:   bigint[] = [...args.cardIds].map(BigInt);
  // rarities included in event but we derive from Card.rarity in DB

  const ts = await blockTimestamp(ctx.blockNumber);

  // Insert MintedNFT for each token; bump Card.currentSupply.
  // Wrap in a transaction so a half-applied pack can't drift the counters.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.transaction.create({
        data: {
          type:        "pack_opened",
          from:        buyer,
          to:          null,
          tokenIds:    JSON.stringify(tokenIds.map(Number)),
          value:       "0", // pack price isn't in this event — we omit it
          txHash:      ctx.txHash,
          logIndex:    ctx.logIndex,
          blockNumber: ctx.blockNumber,
          timestamp:   ts,
        },
      });

      for (let i = 0; i < tokenIds.length; i++) {
        const tokenId = Number(tokenIds[i]);
        const cardId  = Number(cardIds[i]);

        const existing = await tx.mintedNFT.findUnique({ where: { tokenId } });
        if (existing) continue;

        await tx.mintedNFT.create({
          data: {
            tokenId,
            cardId,
            owner:    buyer,
            mintedTo: buyer,
            mintedAt: ts,
            txHash:   ctx.txHash,
          },
        });
        await tx.card.update({
          where: { id: cardId },
          data:  { currentSupply: { increment: 1 } },
        });
      }
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return;
    throw err;
  }

  console.log(`[indexer] PackOpened ${ctx.txHash.slice(0, 10)} buyer=${buyer} cards=${cardIds.length}`);
}

async function handleListed(args: any, ctx: EvtCtx) {
  const tokenId = Number(args.tokenId);
  const seller  = lower(args.seller);
  const price   = BigInt(args.price);
  const cardId  = Number(args.cardId);
  const ts      = await blockTimestamp(ctx.blockNumber);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.transaction.create({
        data: {
          type:        "card_listed",
          from:        seller,
          to:          null,
          tokenIds:    JSON.stringify([tokenId]),
          value:       ethStr(price),
          txHash:      ctx.txHash,
          logIndex:    ctx.logIndex,
          blockNumber: ctx.blockNumber,
          timestamp:   ts,
        },
      });

      // Cancel/Sold listings keep their row; a new "active" listing is a new row.
      await tx.listing.create({
        data: {
          tokenId,
          cardId,
          seller,
          price:    ethStr(price),
          status:   "active",
          listedAt: ts,
          txHash:   ctx.txHash,
        },
      });
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return;
    throw err;
  }

  console.log(`[indexer] Listed token=${tokenId} seller=${seller} price=${ethStr(price)}`);
}

async function handlePurchased(args: any, ctx: EvtCtx) {
  const tokenId = Number(args.tokenId);
  const buyer   = lower(args.buyer);
  const seller  = lower(args.seller);
  const price   = BigInt(args.salePrice);
  const ts      = await blockTimestamp(ctx.blockNumber);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.transaction.create({
        data: {
          type:        "card_bought",
          from:        buyer,
          to:          seller,
          tokenIds:    JSON.stringify([tokenId]),
          value:       ethStr(price),
          txHash:      ctx.txHash,
          logIndex:    ctx.logIndex,
          blockNumber: ctx.blockNumber,
          timestamp:   ts,
        },
      });

      // Mark the most recent active listing for this token as sold.
      const active = await tx.listing.findFirst({
        where:   { tokenId, status: "active" },
        orderBy: { id: "desc" },
      });
      if (active) {
        await tx.listing.update({
          where: { id: active.id },
          data:  {
            status: "sold",
            buyer,
            soldAt: ts,
          },
        });
      }
      // Update current owner. MintedNFT must exist (was inserted on PackOpened).
      await tx.mintedNFT.updateMany({
        where: { tokenId },
        data:  { owner: buyer },
      });
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return;
    throw err;
  }

  console.log(`[indexer] Purchased token=${tokenId} buyer=${buyer} price=${ethStr(price)}`);
}

async function handleListingCancelled(args: any, ctx: EvtCtx) {
  const tokenId = Number(args.tokenId);
  const seller  = lower(args.seller);
  const ts      = await blockTimestamp(ctx.blockNumber);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.transaction.create({
        data: {
          type:        "card_cancelled",
          from:        seller,
          to:          null,
          tokenIds:    JSON.stringify([tokenId]),
          value:       "0",
          txHash:      ctx.txHash,
          logIndex:    ctx.logIndex,
          blockNumber: ctx.blockNumber,
          timestamp:   ts,
        },
      });

      const active = await tx.listing.findFirst({
        where:   { tokenId, status: "active" },
        orderBy: { id: "desc" },
      });
      if (active) {
        await tx.listing.update({
          where: { id: active.id },
          data:  { status: "cancelled" },
        });
      }
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return;
    throw err;
  }

  console.log(`[indexer] ListingCancelled token=${tokenId} seller=${seller}`);
}

async function handleClaimed(args: any, ctx: EvtCtx) {
  const claimant = lower(args.recipient);
  const amount   = BigInt(args.amount);
  const ts       = await blockTimestamp(ctx.blockNumber);

  await prisma.royaltyClaim.upsert({
    where:  { txHash_logIndex: { txHash: ctx.txHash, logIndex: ctx.logIndex } },
    update: {},
    create: {
      claimant,
      amount:    ethStr(amount),
      txHash:    ctx.txHash,
      logIndex:  ctx.logIndex,
      timestamp: ts,
    },
  });

  console.log(`[indexer] Claimed by=${claimant} amount=${ethStr(amount)}`);
}

// Block timestamp lookup with a tiny in-memory cache (catch-up scans the same blocks repeatedly).
const blockTsCache = new Map<number, Date>();
let _provider: Provider;
async function blockTimestamp(blockNumber: number): Promise<Date> {
  const hit = blockTsCache.get(blockNumber);
  if (hit) return hit;
  const block = await _provider.getBlock(blockNumber);
  const ts = new Date((block?.timestamp ?? 0) * 1000);
  blockTsCache.set(blockNumber, ts);
  return ts;
}

// ─── catch-up + live loop ──────────────────────────────────────────────────────

interface EventDef { name: string; contract: any; handler: (a: any, c: EvtCtx) => Promise<void>; }

function eventDefs(c: ReturnType<typeof makeContracts>): EventDef[] {
  return [
    { name: "PackOpened",       contract: c.gacha,       handler: handlePackOpened },
    { name: "Listed",           contract: c.marketplace, handler: handleListed },
    { name: "Purchased",        contract: c.marketplace, handler: handlePurchased },
    { name: "ListingCancelled", contract: c.marketplace, handler: handleListingCancelled },
    { name: "Claimed",          contract: c.splitter,    handler: handleClaimed },
  ];
}

// Some RPC tiers (e.g. Alchemy free) cap eth_getLogs to a small block range.
// On range errors, recursively bisect the window until it fits.
async function queryWithBisect(contract: any, name: string, from: number, to: number): Promise<Log[]> {
  try {
    return await contract.queryFilter(contract.filters[name](), from, to);
  } catch (err: any) {
    const msg = (err?.error?.message ?? err?.shortMessage ?? err?.message ?? "").toLowerCase();
    const isRange = msg.includes("block range") || msg.includes("10 block range") || msg.includes("limit exceeded");
    if (!isRange || to <= from) throw err;
    const mid = Math.floor((from + to) / 2);
    const a = await queryWithBisect(contract, name, from, mid);
    const b = await queryWithBisect(contract, name, mid + 1, to);
    return [...a, ...b];
  }
}

async function processLogs(defs: EventDef[], fromBlock: number, toBlock: number) {
  for (const { name, contract, handler } of defs) {
    const logs = await queryWithBisect(contract, name, fromBlock, toBlock);
    for (const log of logs) {
      const ev = log as EventLog;
      try {
        await handler(ev.args, {
          txHash:      ev.transactionHash,
          blockNumber: ev.blockNumber,
          logIndex:    ev.index,
        });
      } catch (err: any) {
        console.error(`[indexer] ${name} handler error tx=${ev.transactionHash}`, err.message ?? err);
      }
    }
  }
}

async function catchUp(provider: Provider, defs: EventDef[]) {
  const tip   = await provider.getBlockNumber();
  let cursor  = await getStartBlock(provider);

  console.log(`[indexer] catching up from block ${cursor} to ${tip}`);

  while (cursor <= tip) {
    const end = Math.min(cursor + BATCH - 1, tip);
    await processLogs(defs, cursor, end);
    await saveLastBlock(end);
    if (end - cursor > 50 || end === tip) {
      console.log(`[indexer]   scanned ${cursor} -> ${end}`);
    }
    cursor = end + 1;
  }
}

async function poll(provider: Provider, defs: EventDef[]) {
  console.log(`[indexer] polling every ${POLL}ms`);
  while (true) {
    try {
      const tip = await provider.getBlockNumber();
      const state = await prisma.indexerState.findUnique({ where: { id: 1 } });
      const from = (state?.lastBlock ?? 0) + 1;
      if (from <= tip) {
        await processLogs(defs, from, tip);
        await saveLastBlock(tip);
      }
    } catch (err: any) {
      console.error(`[indexer] poll error:`, err.message ?? err);
    }
    await new Promise(r => setTimeout(r, POLL));
  }
}

async function main() {
  acquireIndexerLock();
  console.log(`[indexer] starting…`);
  console.log(`[indexer] addresses:`, {
    nft:         addresses.PokemonCardNFT,
    gacha:       addresses.GachaPack,
    marketplace: addresses.Marketplace,
    splitter:    addresses.PaymentSplitter,
    chainId:     addresses.chainId,
  });

  _provider = makeProvider();
  const contracts = makeContracts(_provider);
  const defs      = eventDefs(contracts);

  await catchUp(_provider, defs);
  await poll(_provider, defs); // never returns
}

main().catch(async (err) => {
  console.error("[indexer] fatal:", err);
  try {
    await prisma.$disconnect();
  } finally {
    releaseIndexerLock();
  }
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    console.log(`[indexer] received ${signal}, shutting down`);
    try {
      await prisma.$disconnect();
    } finally {
      releaseIndexerLock();
    }
    process.exit(0);
  });
}
