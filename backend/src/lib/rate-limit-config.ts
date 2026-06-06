const DEFAULT_RATE_LIMIT_WINDOW_MS = 900_000;
const DEFAULT_RATE_LIMIT_MAX = 100;
const MAX_RATE_LIMIT_WINDOW_MS = 86_400_000;
const MAX_RATE_LIMIT_MAX = 100_000;

export function parsePositiveInt(value: string | undefined, fallback: number, max: number) {
  const parsed = parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function rateLimitConfigFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return {
    windowMs: parsePositiveInt(
      env.API_RATE_LIMIT_WINDOW_MS,
      DEFAULT_RATE_LIMIT_WINDOW_MS,
      MAX_RATE_LIMIT_WINDOW_MS
    ),
    limit: parsePositiveInt(
      env.API_RATE_LIMIT_MAX,
      DEFAULT_RATE_LIMIT_MAX,
      MAX_RATE_LIMIT_MAX
    ),
  };
}
