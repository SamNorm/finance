// Class names shared by server and client components. Kept out of ui.tsx:
// a server component importing from a "use client" module gets references,
// not values.

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export const button = {
  primary: `${base} bg-accent text-accent-fg hover:opacity-90`,
  secondary: `${base} border border-line bg-surface hover:bg-surface-2`,
  ghost: `${base} text-muted hover:bg-surface-2 hover:text-foreground`,
  danger: `${base} text-danger hover:bg-danger-soft`,
  icon: "inline-flex size-7 items-center justify-center rounded text-muted hover:bg-surface hover:text-foreground disabled:opacity-30",
};

export const input =
  "w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-surface-2";
