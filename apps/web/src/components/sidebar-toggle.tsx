"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { SIDEBAR_KEY } from "./boot-script";
import { wide } from "./nav-items";

// Folds the sidebar to icons, for wide spreads and analyses. The choice is
// kept in this browser; which icon shows follows data-sidebar through CSS,
// so the button renders the same on the server.
export function SidebarToggle() {
  function toggle() {
    const root = document.documentElement;
    const collapse = root.dataset.sidebar !== "collapsed";
    if (collapse) root.dataset.sidebar = "collapsed";
    else delete root.dataset.sidebar;
    try {
      localStorage.setItem(SIDEBAR_KEY, collapse ? "collapsed" : "expanded");
    } catch {}
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title="Fold or unfold the sidebar"
      className="hidden h-9 w-full items-center gap-3 rounded-md px-2.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground lg:flex"
    >
      <PanelLeftClose
        className="size-[18px] shrink-0 collapsed:hidden"
        aria-hidden
      />
      <PanelLeftOpen
        className="hidden size-[18px] shrink-0 collapsed:block"
        aria-hidden
      />
      <span className={wide}>Fold sidebar</span>
    </button>
  );
}
