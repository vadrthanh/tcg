// Backend API client.
//
// The backend is a read replica — every endpoint here is a GET. All writes go
// directly to the chain via ethers + wallet signer. Each function throws
// `ApiUnavailableError` when the backend is unreachable or returns a 5xx,
// so callers can switch to on-chain fallback paths without changing their
// happy-path code.

import type {
  CardRow,
  MintedNFTRow,
  ListingRow,
  TransactionRow,
  StatsResponse,
  RarityStats,
  HealthResponse,
  Rarity,
} from "./types";

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class ApiUnavailableError extends Error {
  readonly cause?: unknown;
  constructor(cause?: unknown) {
    super("Backend API unavailable");
    this.name  = "ApiUnavailableError";
    this.cause = cause;
  }
}

/** True when the API is configured. Callers should fall back to RPC when false. */
export const apiConfigured = Boolean(BASE_URL);

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!BASE_URL) throw new ApiUnavailableError();
  try {
    const res = await fetch(`${BASE_URL}${path}`, { signal });
    if (res.status >= 500) throw new ApiUnavailableError(res.status);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    // Network errors (server down, CORS, DNS) — treat as unavailable.
    const e = err as { name?: string; message?: string };
    if (e.name === "TypeError" || e.name === "ApiUnavailableError" || e.message?.includes("fetch")) {
      throw new ApiUnavailableError(err);
    }
    throw err;
  }
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

export const api = {
  health: (signal?: AbortSignal) =>
    get<HealthResponse>("/api/health", signal),

  cards: (signal?: AbortSignal) =>
    get<{ cards: CardRow[] }>("/api/cards", signal).then(r => r.cards),

  card: (cardId: number, signal?: AbortSignal) =>
    get<{ card: CardRow & { mintedNfts: MintedNFTRow[] } }>(`/api/cards/${cardId}`, signal)
      .then(r => r.card),

  cardsByRarity: (rarity: Rarity, signal?: AbortSignal) =>
    get<{ rarity: Rarity; cards: CardRow[] }>(`/api/cards/rarity/${rarity}`, signal)
      .then(r => r.cards),

  nftsByOwner: (owner: string, signal?: AbortSignal) =>
    get<{ owner: string; count: number; nfts: MintedNFTRow[] }>(
      `/api/nfts?owner=${owner.toLowerCase()}`, signal
    ).then(r => r.nfts),

  nft: (tokenId: number, signal?: AbortSignal) =>
    get<{ nft: MintedNFTRow & { listings: ListingRow[] }; activeListing: ListingRow | null }>(
      `/api/nfts/${tokenId}`, signal,
    ),

  listings: (
    opts: { status?: "active" | "sold" | "cancelled"; rarity?: Rarity; seller?: string } = {},
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams();
    if (opts.status) params.set("status", opts.status);
    if (opts.rarity) params.set("rarity", opts.rarity);
    if (opts.seller) params.set("seller", opts.seller.toLowerCase());
    const q = params.toString();
    return get<{ count: number; listings: ListingRow[] }>(
      `/api/listings${q ? `?${q}` : ""}`, signal,
    ).then(r => r.listings);
  },

  listing: (tokenId: number, signal?: AbortSignal) =>
    get<{ tokenId: number; active: ListingRow | null; history: ListingRow[] }>(
      `/api/listings/${tokenId}`, signal,
    ),

  transactions: (
    opts: { address?: string; type?: string; limit?: number } = {},
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams();
    if (opts.address) params.set("address", opts.address.toLowerCase());
    if (opts.type)    params.set("type",    opts.type);
    if (opts.limit)   params.set("limit",   String(opts.limit));
    const q = params.toString();
    return get<{ count: number; transactions: TransactionRow[] }>(
      `/api/transactions${q ? `?${q}` : ""}`, signal,
    ).then(r => r.transactions);
  },

  stats: (signal?: AbortSignal) =>
    get<StatsResponse>("/api/stats", signal),

  statsRarity: (signal?: AbortSignal) =>
    get<RarityStats>("/api/stats/rarity", signal),
};

// ─── Post-write polling ──────────────────────────────────────────────────────

/**
 * After a write tx confirms on-chain, the indexer needs a beat to catch up.
 * `pollUntil` retries the read until the predicate is true or attempts run out.
 *
 * Returns the final value (or the last value if attempts are exhausted, so the
 * UI still updates with whatever the backend currently has).
 */
export async function pollUntil<T>(
  read:      () => Promise<T>,
  predicate: (value: T) => boolean,
  opts: { attempts?: number; intervalMs?: number } = {},
): Promise<T> {
  const attempts   = opts.attempts   ?? 10;
  const intervalMs = opts.intervalMs ?? 1500;
  let last: T;
  for (let i = 0; i < attempts; i++) {
    try {
      last = await read();
      if (predicate(last)) return last;
    } catch {
      // Treat read errors as "not yet" — keep polling.
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return last!;
}
