"use client";

import { useSyncExternalStore } from "react";

// The viewer's theme, kept in this browser. "system" follows the operating
// system's light or dark setting; the others set data-theme on <html>, which
// globals.css reads. THEME_SCRIPT applies a saved choice before first paint.

const THEMES = {
  system: "System",
  light: "Light",
  dim: "Dim",
  dark: "Dark",
} as const;
type Theme = keyof typeof THEMES;

const KEY = "theme";

export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t&&t!=="system")document.documentElement.dataset.theme=t}catch(e){}`;

const isTheme = (value: unknown): value is Theme =>
  typeof value === "string" && Object.hasOwn(THEMES, value);

function read(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    return isTheme(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changed it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    apply(read());
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

function choose(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {}
  apply(theme);
  for (const listener of listeners) listener();
}

export function ThemePicker() {
  const theme = useSyncExternalStore(subscribe, read, () => "system");
  return (
    <label className="flex items-center gap-1.5">
      <span className="sr-only sm:not-sr-only">Theme</span>
      <select
        value={theme}
        onChange={(e) => isTheme(e.target.value) && choose(e.target.value)}
        className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs text-foreground"
      >
        {Object.entries(THEMES).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
