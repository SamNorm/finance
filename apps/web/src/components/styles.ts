// Class names shared by server and client components. Kept out of ui.tsx:
// a server component importing from a "use client" module gets references,
// not values.

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none [&_svg]:size-4 [&_svg]:shrink-0";

export const button = {
  primary: `${base} bg-accent text-accent-fg shadow-xs hover:opacity-90`,
  secondary: `${base} border border-line bg-surface shadow-xs hover:bg-surface-2`,
  ghost: `${base} text-muted hover:bg-surface-2 hover:text-foreground`,
  danger: `${base} text-danger hover:bg-danger-soft`,
  // The button that goes ahead with a delete, where it's the main one.
  dangerSolid: `${base} bg-danger text-danger-fg shadow-xs hover:opacity-90`,
  icon: "inline-flex size-7 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none [&_svg]:size-4",
};

export const input =
  "w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-surface-2";

export const tones = {
  muted: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export type Tone = keyof typeof tones;

export const badge = (tone: Tone) =>
  `inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`;

// A white panel on the page background.
export const card = "rounded-xl border border-line bg-surface shadow-xs";

// List tables: a header row on a light band, rows that highlight on hover.
// A row is `relative` so one link in it can cover the whole row with
// `rowLink`.
export const table = {
  table: "w-full text-sm",
  head: "border-b border-line bg-surface-2/50 text-left text-xs text-muted",
  th: "px-4 py-2.5 font-medium whitespace-nowrap",
  row: "relative border-b border-line/70 last:border-b-0 hover:bg-surface-2/60",
  td: "px-4 py-3",
};

export const rowLink =
  "font-medium before:absolute before:inset-0 hover:text-accent focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-accent/40 focus-visible:before:ring-inset";
