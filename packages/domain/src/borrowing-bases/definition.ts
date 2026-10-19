import { randomUUID } from "node:crypto";
import type { Issue } from "../errors";
import { parseTerm, termAsTyped, type Term } from "../credit-lines/terms";
import { normalizeCharts } from "../financial-models/charts";
import { normalizeAssumption } from "../financial-models/validate";

// A borrowing base's definition (borrowing-base-plan.md §5): typed lines in
// the client's order, which the app turns into the waterfall. Collateral,
// less its ineligibles, times its advance rate, up to its cap, adds up in
// groups with caps of their own into the gross borrowing base; prior claims
// and reserves come off it. Users name their lines; the app names what it
// computes from them, with a dot (AR.MARGINED) or a BB_ prefix (BB_TOTAL).

export * from "./constants";
import {
  COLLATERAL_TYPES,
  DEFAULT_BUCKETS,
  DEFAULT_INELIGIBLE_FROM,
  LINE_KINDS,
  type BorrowingBaseDefinition,
  type BorrowingBaseFormat,
  type BorrowingBaseLine,
  type BorrowingBaseLineKind,
  type BorrowingBaseTest,
  type CollateralType,
  type LineOf,
} from "./constants";

// A line as typed: its kind and code, and whatever the kind takes. Terms
// are typed as TermInput.
export type BorrowingBaseLineInput = Record<string, unknown>;

export interface BorrowingBaseDefinitionInput {
  basedOn?: unknown;
  lines?: unknown;
  outstandingReconcilesWith?: unknown;
  outstandingProjection?: unknown;
  tests?: unknown;
  charts?: unknown;
}

const FORMATS: readonly BorrowingBaseFormat[] = [
  "amount",
  "percent",
  "ratio",
  "count",
  "flag",
];

export const MAX_BB_LINES = 120;
const MAX_TESTS = 30;

const text = (raw: unknown) =>
  typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
const optional = (raw: unknown) => text(raw) || undefined;

function parseCurrency(raw: unknown, facility: string): string | undefined {
  const code = text(raw).toUpperCase();
  return code && code !== facility ? code : undefined;
}

// Reads a definition as typed. What it can't read becomes an issue; the
// definition is usable only without errors (see checkDefinition).
export function normalizeDefinition(
  input: BorrowingBaseDefinitionInput,
  facilityCurrency: string,
): { definition: BorrowingBaseDefinition; issues: Issue[] } {
  const issues: Issue[] = [];
  const error = (code: string, message: string, itemCode?: string) =>
    issues.push({
      severity: "error",
      code,
      message,
      ...(itemCode ? { itemCode } : {}),
    });
  const list = Array.isArray(input.lines) ? input.lines : [];
  if (input.lines !== undefined && !Array.isArray(input.lines))
    error("lines_invalid", "A borrowing base's lines are a list.");
  if (list.length > MAX_BB_LINES)
    error("lines_invalid", `A borrowing base has up to ${MAX_BB_LINES} lines.`);
  // Terms that don't read are reported, and kept out.
  const term = (
    raw: unknown,
    what: string,
    kind: "amount" | "rate",
    code: string,
  ): Term | undefined => {
    try {
      return parseTerm(raw, what, kind);
    } catch (e) {
      error("term_invalid", (e as Error).message, code);
      return undefined;
    }
  };
  const lines: BorrowingBaseLine[] = [];
  for (const [i, raw] of list.slice(0, MAX_BB_LINES).entries()) {
    const line = (raw ?? {}) as BorrowingBaseLineInput;
    const code = text(line.code).toUpperCase();
    const label = text(line.label) || code || `Line ${i + 1}`;
    const kind = text(line.kind) as BorrowingBaseLineKind;
    const base = {
      code,
      label,
      ...(optional(line.description)
        ? { description: optional(line.description) }
        : {}),
    };
    const formula = optional(line.formula);
    const projection = optional(line.projection);
    const formulas = {
      ...(formula ? { formula } : {}),
      ...(projection ? { projection } : {}),
    };
    const collateral = (
      Object.hasOwn(COLLATERAL_TYPES, text(line.collateral))
        ? text(line.collateral)
        : "other"
    ) as CollateralType;
    switch (kind) {
      case "collateral": {
        const rate = term(line.rate, `${label}, advance rate`, "rate", code);
        const cap =
          line.cap === undefined || line.cap === null || line.cap === ""
            ? undefined
            : term(line.cap, `${label}, cap`, "amount", code);
        let aging: LineOf<"collateral">["aging"];
        if (line.aging) {
          const raw = (line.aging === true ? {} : line.aging) as {
            buckets?: unknown;
            ineligibleFrom?: unknown;
          };
          const buckets = Array.isArray(raw.buckets)
            ? raw.buckets.map(text).filter(Boolean)
            : DEFAULT_BUCKETS;
          const from = Number(raw.ineligibleFrom ?? DEFAULT_INELIGIBLE_FROM);
          if (buckets.length < 2 || buckets.length > 12)
            error(
              "aging_invalid",
              `${label}: aging has 2 to 12 buckets.`,
              code,
            );
          else if (!Number.isInteger(from) || from < 1 || from > buckets.length)
            error(
              "aging_invalid",
              `${label}: say which bucket is the first ineligible one, 1 to ${buckets.length - 1} buckets in.`,
              code,
            );
          else aging = { buckets, ineligibleFrom: from };
        }
        if (aging && formula)
          error(
            "aging_formula",
            `${label}: an aged line is its buckets added up, so it can't also have a formula.`,
            code,
          );
        const currency = parseCurrency(line.currency, facilityCurrency);
        lines.push({
          ...base,
          kind,
          collateral,
          ...(optional(line.group)
            ? { group: text(line.group).toUpperCase() }
            : {}),
          ...(currency ? { currency } : {}),
          rate: rate ?? { value: "0" },
          ...(cap ? { cap } : {}),
          ...(aging ? { aging } : {}),
          ...(optional(line.reconcilesWith)
            ? { reconcilesWith: text(line.reconcilesWith) }
            : {}),
          ...formulas,
        });
        break;
      }
      case "group": {
        const cap =
          line.cap === undefined || line.cap === null || line.cap === ""
            ? undefined
            : term(line.cap, `${label}, cap`, "amount", code);
        lines.push({ ...base, kind, collateral, ...(cap ? { cap } : {}) });
        break;
      }
      case "ineligible":
        lines.push({
          ...base,
          kind,
          of: text(line.of).toUpperCase(),
          ...formulas,
        });
        break;
      case "prior_claim":
      case "usage": {
        const currency = parseCurrency(line.currency, facilityCurrency);
        lines.push({
          ...base,
          kind,
          ...(currency ? { currency } : {}),
          ...(kind === "usage" && optional(line.reconcilesWith)
            ? { reconcilesWith: text(line.reconcilesWith) }
            : {}),
          ...(kind === "prior_claim" ? formulas : {}),
          ...(kind === "usage" && projection ? { projection } : {}),
        } as BorrowingBaseLine);
        break;
      }
      case "reserve": {
        const amount =
          line.amount === undefined ||
          line.amount === null ||
          line.amount === ""
            ? undefined
            : term(line.amount, `${label}, amount`, "amount", code);
        if (amount && formula)
          error(
            "reserve_formula",
            `${label}: a reserve is a set amount or a formula, not both.`,
            code,
          );
        lines.push({
          ...base,
          kind,
          ...(amount ? { amount } : {}),
          ...formulas,
        });
        break;
      }
      case "driver":
      case "assumption":
      case "calculation": {
        const format = (
          FORMATS.includes(text(line.format) as BorrowingBaseFormat)
            ? text(line.format)
            : kind === "assumption"
              ? "percent"
              : "amount"
        ) as BorrowingBaseFormat;
        if (kind === "driver") {
          lines.push({
            ...base,
            kind,
            format,
            ...(projection ? { projection } : {}),
          });
        } else if (kind === "calculation") {
          if (!formula)
            error("formula_missing", `${label}: give it a formula.`, code);
          lines.push({
            ...base,
            kind,
            format,
            formula: formula ?? "",
            ...(projection ? { projection } : {}),
          });
        } else {
          const value = (raw: unknown, what: string) => {
            const parsed = normalizeAssumption(text(raw), format);
            if ("error" in parsed) {
              error("assumption_value", `${what}: ${parsed.error}`, code);
              return null;
            }
            return parsed.value;
          };
          const byMonth = Array.isArray(line.byMonth)
            ? line.byMonth.map((v, m) => value(v, `${label}, month ${m + 1}`))
            : undefined;
          if (byMonth && byMonth.length !== 12)
            error(
              "assumption_months",
              `${label}: give a value for each of the 12 months, January first.`,
              code,
            );
          lines.push({
            ...base,
            kind,
            format,
            value: value(line.value, label),
            ...(byMonth?.length === 12 && byMonth.some((v) => v !== null)
              ? { byMonth }
              : {}),
          });
        }
        break;
      }
      default:
        error(
          "kind_invalid",
          `${label}: "${String(line.kind)}" isn't a kind of line; use one of ${Object.keys(LINE_KINDS).join(", ")}.`,
          code,
        );
    }
  }

  const tests: BorrowingBaseTest[] = [];
  const rawTests = input.tests ?? [];
  if (!Array.isArray(rawTests) || rawTests.length > MAX_TESTS)
    error("tests_invalid", `Tests are a list of up to ${MAX_TESTS}.`);
  else
    for (const [i, raw] of rawTests.entries()) {
      const t = (raw ?? {}) as Record<string, unknown>;
      const name = text(t.name) || `Test ${i + 1}`;
      const metric = text(t.metric).toUpperCase();
      if (t.test !== "min" && t.test !== "max") {
        error("test_invalid", `${name}: choose at least or at most.`);
        continue;
      }
      let threshold: Term | undefined;
      try {
        threshold = parseTerm(t.threshold, `${name}, threshold`, "number");
      } catch (e) {
        error("test_invalid", (e as Error).message);
        continue;
      }
      tests.push({
        id:
          typeof t.id === "string" && /^[\w-]{1,64}$/.test(t.id)
            ? t.id
            : randomUUID(),
        name,
        metric,
        test: t.test,
        threshold,
      });
    }

  let charts: BorrowingBaseDefinition["charts"];
  if (input.charts !== undefined && input.charts !== null) {
    try {
      charts = normalizeCharts(input.charts as never);
    } catch (e) {
      error("charts_invalid", (e as Error).message);
    }
  }

  const basedOn = input.basedOn as BorrowingBaseDefinition["basedOn"];
  return {
    definition: {
      ...(basedOn &&
      typeof basedOn === "object" &&
      typeof basedOn.id === "string" &&
      typeof basedOn.name === "string" &&
      ["builtin", "template", "line"].includes(basedOn.kind)
        ? {
            basedOn: { kind: basedOn.kind, id: basedOn.id, name: basedOn.name },
          }
        : {}),
      lines,
      ...(optional(input.outstandingReconcilesWith)
        ? { outstandingReconcilesWith: text(input.outstandingReconcilesWith) }
        : {}),
      ...(optional(input.outstandingProjection)
        ? { outstandingProjection: text(input.outstandingProjection) }
        : {}),
      ...(tests.length ? { tests } : {}),
      // An empty list is kept: no charts, rather than the defaults.
      ...(charts ? { charts } : {}),
    },
    issues,
  };
}

// A stored definition written back as typed, so saving it again reads its
// advance rates the same (see rateAsTyped).
export function definitionAsTyped(
  definition: BorrowingBaseDefinition,
): BorrowingBaseDefinitionInput {
  return {
    ...definition,
    lines: definition.lines.map((line) =>
      line.kind === "collateral"
        ? { ...line, rate: termAsTyped(line.rate, "rate") }
        : line,
    ),
  };
}

// Whether a line's monthly amount is entered, rather than computed: a
// collateral line not aged and without a formula, an ineligible, prior
// claim or reserve without one, usage and drivers.
export function isEntered(line: BorrowingBaseLine): boolean {
  switch (line.kind) {
    case "collateral":
      return !line.aging && !line.formula;
    case "ineligible":
    case "prior_claim":
      return !line.formula;
    case "reserve":
      return !line.formula && !line.amount;
    case "usage":
    case "driver":
      return true;
    default:
      return false;
  }
}

// The foreign currencies a definition's lines use, each needing a rate each
// month (FX.USD).
export function currenciesOf(definition: BorrowingBaseDefinition): string[] {
  const byCode = new Map(definition.lines.map((l) => [l.code, l]));
  const currencies = new Set<string>();
  for (const line of definition.lines) {
    const currency =
      line.kind === "ineligible"
        ? (() => {
            const of = byCode.get(line.of);
            return of?.kind === "collateral" ? of.currency : undefined;
          })()
        : "currency" in line
          ? line.currency
          : undefined;
    if (currency) currencies.add(currency);
  }
  return [...currencies].sort();
}
