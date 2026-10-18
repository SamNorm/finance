"use client";

import {
  Building2,
  ChartLine,
  FileText,
  LayoutDashboard,
  ListTree,
  Sigma,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCurrent, wide, type NavIcon, type NavSection } from "./nav-items";

const ICONS: Record<NavIcon, typeof Sigma> = {
  overview: LayoutDashboard,
  borrowers: Building2,
  analyses: ChartLine,
  scoring: ListTree,
  financial: Sigma,
  documents: FileText,
};

// The sidebar's sections. `pathname` is null while it loads, in the static
// shell, which reads no URL.
export function SidebarSections({
  sections,
  pathname,
}: {
  sections: NavSection[];
  pathname: string | null;
}) {
  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-2 py-4">
      {sections.map((section, i) => (
        <div key={section.label} className="flex flex-col gap-0.5">
          {i > 0 && (
            <div className="mx-2 mb-2 h-px bg-line lg:hidden lg:collapsed:block" />
          )}
          <p className="hidden items-center gap-2 px-2.5 pb-1.5 text-[11px] font-medium tracking-wide text-muted uppercase lg:flex lg:collapsed:hidden">
            {section.label}
            {section.owner && (
              <span
                className="rounded bg-surface-2 px-1 py-px text-[10px] tracking-normal normal-case"
                title="Set up by your organization's administrators or power users. Analysts use what they publish."
              >
                {section.owner}
              </span>
            )}
          </p>
          {section.items.map(({ href, label, icon }) => {
            const Glyph = ICONS[icon];
            return (
              <Link
                key={href}
                href={href}
                title={label}
                aria-current={
                  pathname && isCurrent(href, pathname) ? "page" : undefined
                }
                className="flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium aria-[current=page]:text-accent"
              >
                <Glyph className="size-[18px] shrink-0" aria-hidden />
                <span className={`truncate ${wide}`}>{label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function SidebarNav({ sections }: { sections: NavSection[] }) {
  return <SidebarSections sections={sections} pathname={usePathname()} />;
}

// On narrow screens the links scroll sideways in the top bar.
export function MobileSections({
  sections,
  pathname,
}: {
  sections: NavSection[];
  pathname: string | null;
}) {
  return (
    <nav className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
      {sections
        .flatMap((s) => s.items)
        .map(({ href, label, icon }) => {
          const Glyph = ICONS[icon];
          return (
            <Link
              key={href}
              href={href}
              aria-current={
                pathname && isCurrent(href, pathname) ? "page" : undefined
              }
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted hover:text-foreground aria-[current=page]:bg-accent-soft aria-[current=page]:font-medium aria-[current=page]:text-accent"
            >
              <Glyph className="size-4" aria-hidden />
              {label}
            </Link>
          );
        })}
    </nav>
  );
}

export function MobileNav({ sections }: { sections: NavSection[] }) {
  return <MobileSections sections={sections} pathname={usePathname()} />;
}
