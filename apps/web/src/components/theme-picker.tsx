"use client";

import { Monitor, Moon, Sun, SunMoon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { THEME_KEY } from "./boot-script";
import { Menu, MenuLabel, MenuRadioGroup } from "./menu";
import { wide } from "./nav-items";

// The viewer's theme, kept in this browser. "system" follows the operating
// system's light or dark setting; the others set data-theme on <html>, which
// globals.css reads. BOOT_SCRIPT applies a saved choice before first paint.

const THEMES = {
  system: { label: "System", icon: Monitor },
  light: { label: "Light", icon: Sun },
  dim: { label: "Dim", icon: SunMoon },
  dark: { label: "Dark", icon: Moon },
} as const;
type Theme = keyof typeof THEMES;

const isTheme = (value: unknown): value is Theme =>
  typeof value === "string" && Object.hasOwn(THEMES, value);

function read(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
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
    if (event.key !== THEME_KEY) return;
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
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
  apply(theme);
  for (const listener of listeners) listener();
}

// In the sidebar, a row like the nav links; in the top bar, an icon.
export function ThemePicker({ variant }: { variant: "sidebar" | "mobile" }) {
  const theme = useSyncExternalStore(subscribe, read, (): Theme => "system");
  const Glyph = THEMES[theme].icon;
  return (
    <Menu
      label="Theme"
      align={variant === "sidebar" ? "start" : "end"}
      trigger={
        variant === "sidebar" ? (
          <button
            type="button"
            title="Theme"
            className="flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <Glyph className="size-[18px] shrink-0" aria-hidden />
            <span className={wide}>Theme</span>
            <span className={`ml-auto text-xs ${wide}`}>
              {THEMES[theme].label}
            </span>
          </button>
        ) : (
          <button
            type="button"
            aria-label="Theme"
            className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <Glyph className="size-4" aria-hidden />
          </button>
        )
      }
    >
      <MenuLabel>Theme</MenuLabel>
      <MenuRadioGroup
        value={theme}
        onChange={(value) => isTheme(value) && choose(value)}
        options={Object.entries(THEMES).map(([value, { label, icon: I }]) => ({
          value,
          label,
          icon: <I aria-hidden />,
        }))}
      />
    </Menu>
  );
}
