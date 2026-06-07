// Sanitize image URLs read from on-chain data before putting them in <img src>.
//
// imageURI comes from contract data — in theory it could contain a dangerous
// scheme like javascript: or file:. Allow only safe schemes; everything else
// falls back to a local placeholder (no dependency on an external image host).

const ALLOWED_SCHEMES = ["https:", "ipfs:", "data:image/"];
export const PLACEHOLDER_IMG = "/placeholder-card.svg";

export function safeImageUrl(uri: string | undefined): string {
  if (!uri) return PLACEHOLDER_IMG;
  const lower = uri.toLowerCase();
  if (ALLOWED_SCHEMES.some(s => lower.startsWith(s))) return uri;
  return PLACEHOLDER_IMG;
}
