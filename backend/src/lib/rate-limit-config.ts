const DEFAULT_RATE_LIMIT_WINDOW_MS = 900_000;
const DEFAULT_RATE_LIMIT_MAX = 100;
const MAX_RATE_LIMIT_WINDOW_MS = 86_400_000;
const MAX_RATE_LIMIT_MAX = 100_000;

export function parsePositiveInt(value: string | undefined, fallback: number, max: number) {
  // Number() (not parseInt) so "1.9" / "123abc" fall back to the default
  // instead of being silently truncated to 1 / 123.
  const parsed = Number(value);
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
