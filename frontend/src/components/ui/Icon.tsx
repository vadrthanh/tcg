import type { ReactNode } from "react";

export type IconName =
  | "home" | "bolt" | "grid" | "cards" | "store" | "coin" | "wallet" | "flame"
  | "spark" | "check" | "lock" | "arrow" | "refresh" | "plus" | "tag" | "trophy" | "chart"
  | "copy" | "external" | "power" | "chevron" | "sun" | "moon";

const PATHS: Record<IconName, ReactNode> = {
  home:   <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
  bolt:   <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />,
  grid:   <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  cards:  <><rect x="3" y="6" width="13" height="15" rx="2" /><path d="M8 3h11a2 2 0 0 1 2 2v12" /></>,
  store:  <><path d="M4 9h16l-1-5H5L4 9Z" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></>,
  coin:   <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5h3.2a1.8 1.8 0 0 1 0 3.6H10m-.5 0h3.5a1.8 1.8 0 0 1 0 3.6H9.5" /></>,
  wallet: <><rect x="3" y="6" width="18" height="14" rx="2.5" /><path d="M3 10h18" /><circle cx="17" cy="14" r="1.3" fill="currentColor" stroke="none" /></>,
  flame:  <path d="M12 3c1 3-2 4-2 7a2 2 0 0 0 4 0c0-1 0-1 .5-2 1.5 1.5 2.5 3 2.5 5a5 5 0 0 1-10 0c0-3 3-4 5-10Z" />,
  spark:  <path d="M12 3v4m0 10v4m9-9h-4M7 12H3m13.5-6.5-2.8 2.8M9.3 14.7l-2.8 2.8m11 0-2.8-2.8M9.3 9.3 6.5 6.5" />,
  check:  <path d="M5 12.5 10 17l9-10" />,
  lock:   <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  arrow:  <path d="M5 12h14m-6-6 6 6-6 6" />,
  refresh:<><path d="M21 12a9 9 0 1 1-2.6-6.3" /><path d="M21 3v5h-5" /></>,
  plus:   <path d="M12 5v14M5 12h14" />,
  tag:    <><path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z" /><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" /></>,
  trophy: <><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" /><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M9 18h6M10 21h4M12 13v5" /></>,
  chart:  <><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 16v-4M12 16V8m4 8v-6" /></>,
  copy:   <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2" /></>,
  external:<><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" /></>,
  power:  <><path d="M12 3v9" /><path d="M7.6 6.6a7 7 0 1 0 8.8 0" /></>,
  chevron:<path d="m6 9 6 6 6-6" />,
  sun:    <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" /></>,
  moon:   <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z" />,
};

export function Icon({ name, size = 18, stroke = 1.8 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}
