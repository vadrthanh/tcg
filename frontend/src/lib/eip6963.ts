// EIP-6963 multi-wallet discovery — the modern replacement for reading the legacy
// `window.ethereum` singleton (which breaks when several wallets inject at once).
//
// We do the discovery by hand rather than via ethers' `BrowserProvider.discover()`
// because that static helper hides the underlying EIP-1193 provider, and we need
// that raw object to attach `accountsChanged` / `chainChanged` listeners to the
// exact wallet we sign with.

export interface Eip1193 {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193;
}

// Ask any EIP-6963 wallets to announce themselves, collect them for `timeoutMs`,
// and resolve the first one. Falls back to the legacy `window.ethereum` injection
// for wallets that don't yet implement EIP-6963. Resolves null if no wallet exists.
export function discoverInjectedProvider(timeoutMs = 300): Promise<Eip1193 | null> {
  return new Promise(resolve => {
    if (typeof window === "undefined") { resolve(null); return; }

    const seen: Eip6963Detail[] = [];
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<Eip6963Detail>).detail;
      if (d?.provider && !seen.some(s => s.info.uuid === d.info.uuid)) seen.push(d);
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    window.setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
      resolve(seen[0]?.provider ?? (window.ethereum as Eip1193 | undefined) ?? null);
    }, timeoutMs);
  });
}
