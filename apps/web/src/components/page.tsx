import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { badge, card, type Tone } from "./styles";

// Page building blocks, safe in server and client components alike.

// The content column. Lists and forms read best narrow; spreads, models and
// analyses use the width.
export function Page({
  wide = false,
  children,
}: {
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`mx-auto w-full ${wide ? "max-w-[1600px]" : "max-w-[1200px]"} px-4 py-6 sm:px-6 lg:px-8 lg:py-8`}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  crumbs,
  title,
  badges,
  description,
  meta,
  actions,
}: {
  crumbs?: { href: string; label: string }[];
  title: ReactNode;
  badges?: ReactNode;
  description?: ReactNode;
  // A line of facts under the title: links, dates, counts.
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        {crumbs && (
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1 text-xs text-muted"
          >
            {crumbs.map((crumb) => (
              <span key={crumb.href} className="flex items-center gap-1">
                <Link href={crumb.href} className="hover:text-foreground">
                  {crumb.label}
                </Link>
                <ChevronRight className="size-3" aria-hidden />
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            {title}
          </h1>
          {badges}
        </div>
        {description && (
          <p className="max-w-3xl text-sm text-muted">{description}</p>
        )}
        {meta && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {meta}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}

// A panel with an optional header. `flush` drops the body padding, for
// tables and lists that run edge to edge.
export function Card({
  title,
  description,
  actions,
  flush = false,
  className = "",
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`${card} overflow-hidden ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="text-xs text-muted">{description}</p>}
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </header>
      )}
      {flush ? children : <div className="p-4">{children}</div>}
    </section>
  );
}

export function Badge({
  tone = "muted",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return <span className={badge(tone)}>{children}</span>;
}

const VERSION_TONES = {
  draft: "accent",
  published: "success",
  retired: "muted",
} as const;

export function VersionBadge({
  status,
  number,
}: {
  status: keyof typeof VERSION_TONES;
  number?: number;
}) {
  return (
    <Badge tone={VERSION_TONES[status]}>
      {number !== undefined && `v${number} · `}
      {status === "draft"
        ? "Draft"
        : status === "published"
          ? "Published"
          : "Retired"}
    </Badge>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  actions,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
      {icon && (
        <span className="grid size-10 place-items-center rounded-full bg-surface-2 text-muted [&_svg]:size-5">
          {icon}
        </span>
      )}
      <p className="text-sm font-medium">{title}</p>
      {children && (
        <div className="max-w-md text-sm text-muted">{children}</div>
      )}
      {actions && (
        <div className="flex flex-wrap justify-center gap-2">{actions}</div>
      )}
    </div>
  );
}

// A figure with its label, for summary strips.
export function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "success" | "danger" | "warning";
}) {
  const color =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : tone === "warning"
          ? "text-warning"
          : "";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-xs text-muted">{label}</span>
      <span
        className={`text-xl font-semibold tracking-tight tabular-nums ${color}`}
      >
        {value}
      </span>
      {detail && <span className="text-xs text-muted">{detail}</span>}
    </div>
  );
}

export const plural = (n: number, word: string, words = `${word}s`) =>
  `${n} ${n === 1 ? word : words}`;
