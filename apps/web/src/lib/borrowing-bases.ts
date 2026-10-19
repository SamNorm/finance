import type {
  BorrowingBaseFormat,
  BorrowingBaseLine,
  BorrowingBaseLineKind,
  CollateralType,
  Term,
} from "@finance/domain";
import { Dec } from "@finance/engine";
import {
  BLANK_TERM,
  describeMonth,
  newKey,
  termDraft,
  termInput,
  typedRate,
  type TermDraft,
} from "./credit-lines";
import { formatFigure } from "./format";

// Borrowing bases as the app shows and edits them: months, figures and a
// definition's lines as typed. Plain functions, safe in client components,
// which can't import the domain's definition module (it reaches
// node:crypto).

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
      for (const [suffix, what] of [
        ["INELIGIBLE", "ineligible"],
        ["ELIGIBLE", "eligible"],
        ["RATE", "advance rate"],
        ...(d.cap ? [["CAP", "cap"]] : []),
        ["MARGINED", "margined"],
      ])
        codes.push({
          code: `${d.code}.${suffix}`,
          label: `${d.label}, ${what}`,
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

// The foreign currencies the lines use, each entered as a rate each month.
export function currenciesOf(
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
  return [...set].sort();
}
