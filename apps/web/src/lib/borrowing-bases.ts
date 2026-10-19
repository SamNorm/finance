import {
  COLLATERAL_CODES,
  fxCode,
  GROUP_TOTALS,
  type BorrowingBaseDefinition,
  type BorrowingBaseFormat,
  type BorrowingBaseLine,
  type BorrowingBaseLineKind,
  type BorrowingBaseTest,
  type CollateralType,
  type GroupSummed,
  type GroupTotals,
} from "@finance/domain/borrowing-bases";
import type { Term } from "@finance/domain/terms";
import type { WaterfallRow } from "@finance/domain";
import { Dec } from "@finance/engine";
import {
  BLANK_TERM,
  describeMonth,
  newKey,
  termDraft,
  termInput,
  typedAmount,
  typedRate,
  type TermDraft,
} from "./credit-lines";
import { formatFigure } from "./format";

// Borrowing bases as the app shows and edits them: months, figures, and a
// definition's lines and tests as typed. Plain functions, safe in client
// components, over what the domain shares with the browser.

export type Quality = "reported" | "verified";

export const QUALITY: Record<Quality, string> = {
  reported: "Reported",
  verified: "Verified",
};

export const QUALITY_HELP: Record<Quality, string> = {
  reported: "The client's certificate.",
  verified: "Confirmed by a field exam or an audit.",
};

export { describeMonth };

// "2024-12" moved by n months: "2025-01" for 1.
export function addMonths(month: string, n: number): string {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const count = year * 12 + (m - 1) + n;
  return `${Math.floor(count / 12)}-${String((count % 12) + 1).padStart(2, "0")}`;
}

// The calendar months of a fiscal year in order, 1 to 12: with a March
// year end, April first.
export const fiscalMonths = (yearEndMonth: number) =>
  Array.from({ length: 12 }, (_, i) => ((yearEndMonth + i) % 12) + 1);

// The month before today's: the certificate usually expected next.
export function lastMonthOf(today: string): string {
  return addMonths(today.slice(0, 7), -1);
}

// A figure as shown. Exchange rates (FX.USD) keep four decimals rather than
// read as a ratio.
export function showFigure(
  value: string | null | undefined,
  format: BorrowingBaseFormat,
  code = "",
): string {
  if (value === null || value === undefined || value === "") return "";
  if (code.startsWith("FX.")) return Number(value).toFixed(4);
  return formatFigure(value, format);
}

// A definition's line as typed in the editor: every field a kind can take,
// so switching a line's kind keeps what was typed. Terms are drafts; an
// advance rate is typed as a percent.
export interface LineDraft {
  key: string;
  kind: BorrowingBaseLineKind;
  code: string;
  label: string;
  description: string;
  collateral: CollateralType;
  group: string;
  currency: string;
  rate: TermDraft;
  cap: TermDraft | null;
  // The buckets, and the first ineligible one (0-based), as saved.
  aging: { buckets: string[]; ineligibleFrom: number } | null;
  reconcilesWith: string;
  formula: string;
  projection: string;
  of: string;
  amount: TermDraft | null;
  format: BorrowingBaseFormat;
  value: string;
  // One per calendar month, January first, for a seasonal assumption.
  byMonth: string[] | null;
}

// An assumption's value as typed back: "10%" for a percent.
const typedValue = (raw: string | null, format: BorrowingBaseFormat) =>
  raw === null
    ? ""
    : format === "percent"
      ? `${new Dec(raw).times(100).toString()}%`
      : raw;

const field = <T>(line: BorrowingBaseLine, name: string): T | undefined =>
  (line as unknown as Record<string, T | undefined>)[name];

export const blankLine = (
  kind: BorrowingBaseLineKind,
  defaults: Partial<LineDraft> = {},
): LineDraft => ({
  key: newKey(),
  kind,
  code: "",
  label: "",
  description: "",
  collateral: "receivables",
  group: "",
  currency: "",
  rate: { ...BLANK_TERM },
  cap: null,
  aging: null,
  reconcilesWith: "",
  formula: "",
  projection: "",
  of: "",
  amount: null,
  format: kind === "assumption" ? "percent" : "amount",
  value: "",
  byMonth: null,
  ...defaults,
});

export function lineDraft(line: BorrowingBaseLine): LineDraft {
  const term = (name: string, typed?: (raw: string) => string) => {
    const t = field<Term>(line, name);
    return t ? termDraft(t, typed) : null;
  };
  const format = field<BorrowingBaseFormat>(line, "format") ?? "amount";
  const byMonth = field<(string | null)[]>(line, "byMonth");
  return blankLine(line.kind, {
    code: line.code,
    label: line.label,
    description: line.description ?? "",
    collateral: field<CollateralType>(line, "collateral") ?? "receivables",
    group: field<string>(line, "group") ?? "",
    currency: field<string>(line, "currency") ?? "",
    rate: term("rate", typedRate) ?? { ...BLANK_TERM },
    cap: term("cap"),
    aging: field<LineDraft["aging"]>(line, "aging") ?? null,
    reconcilesWith: field<string>(line, "reconcilesWith") ?? "",
    formula: field<string>(line, "formula") ?? "",
    projection: field<string>(line, "projection") ?? "",
    of: field<string>(line, "of") ?? "",
    amount: term("amount"),
    format,
    value: typedValue(field<string | null>(line, "value") ?? null, format),
    byMonth: byMonth ? byMonth.map((v) => typedValue(v, format)) : null,
  });
}

// What the domain reads: the fields the line's kind takes, as typed.
export function lineInput(draft: LineDraft): Record<string, unknown> {
  const base = {
    kind: draft.kind,
    code: draft.code,
    label: draft.label,
    ...(draft.description.trim() ? { description: draft.description } : {}),
  };
  const formulas = {
    ...(draft.formula.trim() ? { formula: draft.formula } : {}),
    ...(draft.projection.trim() ? { projection: draft.projection } : {}),
  };
  const projection = draft.projection.trim()
    ? { projection: draft.projection }
    : {};
  const currency = draft.currency.trim() ? { currency: draft.currency } : {};
  const cap = draft.cap ? { cap: termInput(draft.cap) } : {};
  switch (draft.kind) {
    case "collateral":
      return {
        ...base,
        collateral: draft.collateral,
        ...(draft.group ? { group: draft.group } : {}),
        ...currency,
        rate: termInput(draft.rate),
        ...cap,
        ...(draft.aging ? { aging: draft.aging } : {}),
        ...(draft.reconcilesWith
          ? { reconcilesWith: draft.reconcilesWith }
          : {}),
        ...(draft.aging ? projection : formulas),
      };
    case "group":
      return { ...base, collateral: draft.collateral, ...cap };
    case "ineligible":
      return { ...base, of: draft.of, ...formulas };
    case "prior_claim":
      return { ...base, ...currency, ...formulas };
    case "reserve":
      return {
        ...base,
        ...(draft.amount ? { amount: termInput(draft.amount) } : {}),
        ...(draft.amount ? projection : formulas),
      };
    case "usage":
      return {
        ...base,
        ...currency,
        ...(draft.reconcilesWith
          ? { reconcilesWith: draft.reconcilesWith }
          : {}),
        ...projection,
      };
    case "driver":
      return { ...base, format: draft.format, ...projection };
    case "assumption":
      return {
        ...base,
        format: draft.format,
        value: draft.value,
        ...(draft.byMonth ? { byMonth: draft.byMonth } : {}),
      };
    case "calculation":
      return { ...base, format: draft.format, ...formulas };
  }
}

// What each collateral line and group computes, for formulas to read
// (borrowing-base-plan.md §5.4).
export function computedCodes(
  drafts: readonly LineDraft[],
): { code: string; label: string }[] {
  const codes: { code: string; label: string }[] = [];
  for (const d of drafts) {
    if (!d.code) continue;
    if (d.kind === "collateral") {
      d.aging?.buckets.forEach((bucket, i) =>
        codes.push({
          code: `${d.code}.AGE${i + 1}`,
          label: `${d.label}, ${bucket}`,
        }),
      );
      if (d.aging)
        codes.push({
          code: `${d.code}.AGED_OUT`,
          label: `${d.label}, aged out`,
        });
      for (const { suffix, label } of COLLATERAL_CODES)
        if (suffix !== "CAP" || d.cap)
          codes.push({
            code: `${d.code}.${suffix}`,
            label: `${d.label}, ${label.toLowerCase()}`,
          });
    }
    if (d.kind === "group") {
      if (d.cap)
        codes.push({ code: `${d.code}.CAP`, label: `${d.label}, cap` });
      codes.push({ code: `${d.code}.MARGINED`, label: `${d.label}, margined` });
    }
  }
  return codes;
}

// The rates of the foreign currencies the lines use, entered each month
// (FX.USD).
export function ratesOf(
  drafts: readonly LineDraft[],
  facility: string,
): string[] {
  const byCode = new Map(drafts.map((d) => [d.code, d]));
  const set = new Set<string>();
  for (const d of drafts) {
    const currency =
      d.kind === "ineligible"
        ? byCode.get(d.of)?.currency
        : ["collateral", "prior_claim", "usage"].includes(d.kind)
          ? d.currency
          : "";
    const code = currency?.trim().toUpperCase();
    if (code && code !== facility) set.add(code);
  }
  return [...set].sort().map(fxCode);
}

// A test as typed (§6.3): a figure at least or at most a threshold, which
// can step from a month and differ by season as other terms do. The
// threshold is typed as the figure shows: "250,000", "15%" or "1.25x".
export interface TestDraft {
  key: string;
  id?: string;
  name: string;
  metric: string;
  test: "min" | "max";
  threshold: TermDraft;
}

export const typedThreshold = (format: BorrowingBaseFormat) =>
  format === "percent"
    ? typedRate
    : format === "ratio"
      ? (raw: string) => `${Number(raw)}x`
      : typedAmount;

export const testDraft = (
  test: BorrowingBaseTest,
  format: BorrowingBaseFormat,
): TestDraft => ({
  key: test.id,
  id: test.id,
  name: test.name,
  metric: test.metric,
  test: test.test,
  threshold: termDraft(test.threshold, typedThreshold(format)),
});

export const testInput = (draft: TestDraft) => ({
  ...(draft.id ? { id: draft.id } : {}),
  name: draft.name,
  metric: draft.metric,
  test: draft.test,
  threshold: termInput(draft.threshold),
});

// A figure a test or a chart can read: any row of the waterfall but
// headings, named so it reads alone ("Trade receivables, eligible"), under
// its section.
export interface Figure {
  code: string;
  label: string;
  format: BorrowingBaseFormat;
  section: string;
}

export function figuresOf(
  rows: readonly WaterfallRow[],
  definition: BorrowingBaseDefinition,
): Figure[] {
  const labels = new Map(rows.map((r) => [r.code, r.label]));
  const parents = new Map(
    definition.lines.flatMap((l) =>
      l.kind === "ineligible" ? [[l.code, l.of] as const] : [],
    ),
  );
  let section = "";
  return rows.flatMap((row) => {
    if (row.kind === "section") {
      section = row.label;
      return [];
    }
    if (row.kind === "line" && row.lineKind === "group") return [];
    const dot = row.code.indexOf(".");
    const parent =
      row.kind === "detail" && !row.code.startsWith("BB_")
        ? dot > 0
          ? row.code.slice(0, dot)
          : parents.get(row.code)
        : undefined;
    const of = parent && labels.get(parent);
    return [
      {
        code: row.code,
        label: of ? `${of}, ${row.label.toLowerCase()}` : row.label,
        format: row.format,
        section,
      },
    ];
  });
}

// A new test, on excess availability until another figure is chosen.
export const newTest = (): TestDraft => ({
  key: newKey(),
  name: "",
  metric: "BB_EXCESS",
  test: "min",
  threshold: { ...BLANK_TERM },
});

// A consolidated client's figures (borrowing-base-plan.md §7.5), in
// waterfall order: its totals, and the figures they give.
export type GroupFigureKey =
  GroupSummed | "gross" | "usage" | "surplus" | "excess" | "utilization";

export const GROUP_FIGURES: {
  key: GroupFigureKey;
  label: string;
  format: "amount" | "percent";
  kind: "line" | "subtotal" | "total";
}[] = [
  ...(["receivables", "inventory", "otherCollateral"] as const).map((key) => ({
    key,
    label: GROUP_TOTALS.find((t) => t.key === key)!.label,
    format: "amount" as const,
    kind: "line" as const,
  })),
  {
    key: "gross",
    label: "Gross borrowing base",
    format: "amount",
    kind: "subtotal",
  },
  { key: "priorClaims", label: "Prior claims", format: "amount", kind: "line" },
  { key: "reserves", label: "Reserves", format: "amount", kind: "line" },
  { key: "total", label: "Borrowing base", format: "amount", kind: "total" },
  {
    key: "limit",
    label: "Authorized limits",
    format: "amount",
    kind: "line",
  },
  {
    key: "available",
    label: "Availability",
    format: "amount",
    kind: "subtotal",
  },
  {
    key: "outstanding",
    label: "Lines outstanding",
    format: "amount",
    kind: "line",
  },
  { key: "otherUsage", label: "Other usage", format: "amount", kind: "line" },
  { key: "usage", label: "Usage", format: "amount", kind: "subtotal" },
  {
    key: "surplus",
    label: "Margin surplus (deficit)",
    format: "amount",
    kind: "total",
  },
  {
    key: "excess",
    label: "Excess availability",
    format: "amount",
    kind: "line",
  },
  {
    key: "utilization",
    label: "Utilization",
    format: "percent",
    kind: "line",
  },
];

// What a member line's totals give, as the group's do: for display.
export function memberFigures(
  totals: GroupTotals,
): Record<GroupFigureKey, number | null> {
  const n = (key: GroupSummed) =>
    totals[key] === null ? null : Number(totals[key]);
  const add = (...values: (number | null)[]) =>
    values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  const usage = add(n("outstanding"), n("otherUsage"));
  const limit = n("limit");
  return {
    receivables: n("receivables"),
    inventory: n("inventory"),
    otherCollateral: n("otherCollateral"),
    priorClaims: n("priorClaims"),
    reserves: n("reserves"),
    total: n("total"),
    available: n("available"),
    limit,
    outstanding: n("outstanding"),
    otherUsage: n("otherUsage"),
    gross: add(n("receivables"), n("inventory"), n("otherCollateral")),
    usage,
    surplus: add(n("total")) - usage,
    excess: add(n("available")) - usage,
    utilization: limit ? usage / limit : null,
  };
}
