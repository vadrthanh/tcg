import { useCallback, useEffect, useState } from "react";

// Light/dark theme, persisted to localStorage and applied as a `data-theme`
// attribute on <html>. First visit follows the OS preference; after that the
// user's explicit choice wins. The CSS in index.css reads :root[data-theme="…"].

export type Theme = "light" | "dark";
const KEY = "tcg:theme";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* storage blocked — fall through to OS preference */ }
  const prefersLight =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: light)").matches;
  return prefersLight ? "light" : "dark";
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  // Push the active theme onto <html> so the CSS variables switch.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const toggle = useCallback(() => setTheme(t => (t === "dark" ? "light" : "dark")), []);
  return { theme, toggle };
}
