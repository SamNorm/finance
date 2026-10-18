import { ChartColumn, LockOpen } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { MainNav, MainNavFallback } from "./main-nav";
import { wide } from "./nav-items";
import { SidebarToggle } from "./sidebar-toggle";
import { ThemePicker } from "./theme-picker";

const ORGANIZATION = "Dev organization";

// A sidebar from medium screens up, folded to icons below large ones or when
// the viewer folds it; a top bar on phones.
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-14 shrink-0 flex-col border-r border-line bg-surface md:flex lg:w-60 lg:collapsed:w-14">
        <Link
          href="/"
          title="Modeling workspace"
          className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-3"
        >
          <Logo />
          <span className="hidden min-w-0 flex-col leading-tight lg:flex lg:collapsed:hidden">
            <span className="truncate text-sm font-semibold">
              Modeling workspace
            </span>
            <span className="truncate text-xs text-muted">{ORGANIZATION}</span>
          </span>
        </Link>
        <Suspense fallback={<MainNavFallback variant="sidebar" />}>
          <MainNav variant="sidebar" />
        </Suspense>
        <div className="flex flex-col gap-0.5 border-t border-line p-2">
          <ThemePicker variant="sidebar" />
          <SidebarToggle />
          <p
            title="Local development: everyone acts as the dev organization."
            className="flex h-9 items-center gap-3 rounded-md px-2.5 text-xs text-warning"
          >
            <LockOpen className="size-[18px] shrink-0" aria-hidden />
            <span className={wide}>Dev mode · no sign-in</span>
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-line bg-surface px-3 md:hidden">
          <Link href="/" aria-label="Overview">
            <Logo />
          </Link>
          <Suspense fallback={<MainNavFallback variant="mobile" />}>
            <MainNav variant="mobile" />
          </Suspense>
          <ThemePicker variant="mobile" />
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg shadow-xs">
      <ChartColumn className="size-[18px]" aria-hidden />
    </span>
  );
}
