// Sanitize image URLs that come from on-chain card metadata before putting them
// in <img src>. imageURI is author-controlled (a card template / listing seller
// sets it), so allow only safe schemes and otherwise fall back to a local
// placeholder. Defense-in-depth — an <img src> does not execute script — and it
// also drops the dependency on an external placeholder host.

const ALLOWED_SCHEMES = ["https:", "ipfs:", "data:image/"];
export const PLACEHOLDER_IMG = "/placeholder-card.svg";

export function safeImageUrl(uri: string | undefined | null): string {
  if (!uri) return PLACEHOLDER_IMG;
  const lower = uri.trim().toLowerCase();
  return ALLOWED_SCHEMES.some(s => lower.startsWith(s)) ? uri : PLACEHOLDER_IMG;
}
