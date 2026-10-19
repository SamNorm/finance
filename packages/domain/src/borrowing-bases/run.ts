import { Dec, evaluateModel, type Value } from "@finance/engine";
import {
  serialize,
  type LineageRef,
  type ResultCell,
  type ResultValue,
} from "../analyses/run";
import { monthIndex, monthOf } from "../financing/amortization";
import { assumptionValue } from "../financial-models/validate";
import { monthNumber, termIn, type Term } from "../credit-lines/terms";
import {
  compileBorrowingBase,
  type CompiledBorrowingBase,
  type WaterfallRow,
} from "./compile";
import type { BorrowingBaseDefinition, BorrowingBaseTest } from "./definition";

// Runs a borrowing base over its months (borrowing-base-plan.md §9.3), pure
// as runModel is: the months contiguous, so PREV(x, 12) is the same month a
// year earlier; terms resolved month by month; every value with what it was
// computed from.

export type BorrowingBaseQuality = "reported" | "verified";

export interface BorrowingBaseMonthInput {
  // "YYYY-MM".
  month: string;
  quality: BorrowingBaseQuality;
  // Figures by code, canonical decimals.
  figures: Record<string, string>;
}

export interface RunMonth {
  month: string;
  // The month's last day.
  end: string;
  // Null for a month with no certificate between two that have one, and
  // for projected months.
  quality: BorrowingBaseQuality | null;
  projected: boolean;
}

// A projected month, after the history: the figures entered for it (the
// client's projections, a scenario's changes), which win over projection
// formulas.
export interface ProjectedMonthInput {
  month: string;
  figures: Record<string, string>;
}

// Terms a deal changes, from the month after `after`: the line's new limit,
// and its borrowing base's advance rates, caps and reserves by line code.
export interface ProposedTerms {
  after: string;
  limit?: Term;
  terms?: Record<string, { rate?: Term; cap?: Term | null; amount?: Term }>;
}

export interface TestPeriod extends ResultValue {
  threshold: string | null;
  // Room before a breach: above a minimum, below a maximum.
  margin: string | null;
  pass: boolean | null;
}

export interface TestResult {
  id: string;
  name: string;
  metric: string;
  test: "min" | "max";
  builtIn: boolean;
  months: TestPeriod[];
}

export interface BorrowingBaseRun {
  months: RunMonth[];
  rows: WaterfallRow[];
  cells: Record<string, ResultCell[]>;
  tests: TestResult[];
}

// "2025-02" → "2025-02-28".
export const monthEnd = (month: string) => {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
};

// The months from the first to the last, gaps included.
export function contiguousMonths(months: readonly string[]): string[] {
  if (!months.length) return [];
  const sorted = [...months].sort();
  const from = monthNumber(sorted[0]!);
  const to = monthNumber(sorted.at(-1)!);
  const result: string[] = [];
  for (let m = from; m <= to; m++) result.push(monthOf(m));
  return result;
}

// The margin test (usage at most the borrowing base, a surplus of at least
// zero) and the overline test (usage at most the limit), built in.
const builtInTests = (limit: Term): BorrowingBaseTest[] => [
  {
    id: "margin",
    name: "Usage within the borrowing base",
    metric: "BB_SURPLUS",
    test: "min",
    threshold: { value: "0" },
  },
  {
    id: "overline",
    name: "Usage within the limit",
    metric: "BB_USAGE",
    test: "max",
    threshold: limit,
  },
];

export function runBorrowingBase(input: {
  definition: BorrowingBaseDefinition;
  line: { currency: string; limit: Term };
  months: readonly BorrowingBaseMonthInput[];
  // Months projected after the history, in order, from the month after its
  // last.
  projected?: readonly ProjectedMonthInput[];
  // An assumption's value in a month, when the analysis or a scenario
  // gives one; undefined leaves the definition's.
  assumptionAt?: (code: string, month: string) => string | null | undefined;
  proposed?: ProposedTerms | null;
  // Precompiled, when the caller has it.
  compiled?: CompiledBorrowingBase;
}): BorrowingBaseRun {
  const compiled =
    input.compiled ?? compileBorrowingBase(input.definition, input.line);
  const byMonth = new Map(input.months.map((m) => [m.month, m]));
  const projected = new Map(
    (input.projected ?? []).map((m) => [m.month, m.figures]),
  );
  const months: RunMonth[] = [
    ...contiguousMonths([...byMonth.keys()]).map((month) => ({
      month,
      end: monthEnd(month),
      quality: byMonth.get(month)?.quality ?? null,
      projected: false,
    })),
    ...[...projected.keys()]
      .filter((month) => !byMonth.has(month))
      .map((month) => ({
        month,
        end: monthEnd(month),
        quality: null,
        projected: true,
      })),
  ];
  const index = months.map((m) => monthIndex(m.end));
  const proposed = input.proposed;
  const after = proposed ? monthNumber(proposed.after) : Infinity;
  // A term's value in each month: the deal's from after its month.
  const termValues = (term: Term, deal: Term | null | undefined) =>
    index.map((m) => {
      const own = m > after && deal !== undefined ? deal : term;
      return own === null ? null : new Dec(termIn(own, m).value);
    });
  const termCodes = new Set(compiled.terms.map((t) => t.code));
  const assumptions: Record<string, Value | Value[]> = {};
  for (const { code, term } of compiled.terms) {
    const [line, field] = code.includes(".")
      ? (code.split(".") as [string, string])
      : [code, "AMOUNT"];
    const deal =
      code === "BB_LIMIT"
        ? proposed?.limit
        : proposed?.terms?.[line]?.[
            field.toLowerCase() as "rate" | "cap" | "amount"
          ];
    assumptions[code] = termValues(term, deal);
  }
  for (const a of compiled.assumptions)
    assumptions[a.code] = months.map((m) => {
      const given = input.assumptionAt?.(a.code, m.month);
      return assumptionValue(
        given !== undefined
          ? given
          : a.byMonth
            ? (a.byMonth[Number(m.month.slice(5)) - 1] ?? a.value)
            : a.value,
        a.format,
      );
    });
  const inputCodes = compiled.inputs.map((r) => r.code);
  const figuresOf = (p: number) => {
    const m = months[p]!;
    return m.projected ? projected.get(m.month) : byMonth.get(m.month)?.figures;
  };
  const evaluation = evaluateModel({
    periods: months.map((m) => ({
      key: m.month,
      end: m.end,
      months: 1,
      ...(m.projected ? { projection: "assumptions" as const } : {}),
    })),
    calculations: compiled.calculations.map((c) => ({
      code: c.code,
      formula: c.formula,
      projectionFormula: c.projection ?? null,
    })),
    assumptions,
    inputCodes,
    input: (code, p) => {
      const raw = figuresOf(p)?.[code];
      return raw === undefined ? null : new Dec(raw);
    },
    inputProjections: compiled.projections,
  });

  const labels = new Map(compiled.rows.map((r) => [r.code, r.label]));
  const entered = new Set(inputCodes);
  const sourceOf = (code: string, p: number): LineageRef["source"] => {
    if (termCodes.has(code)) return "term";
    if (assumptions[code] !== undefined) return "assumption";
    if (entered.has(code)) {
      if (figuresOf(p)?.[code] !== undefined) return "entered";
      return months[p]!.projected ? "calculation" : "blank";
    }
    return "calculation";
  };
  const cells: Record<string, ResultCell[]> = {};
  for (const row of compiled.rows) {
    if (row.kind === "section") continue;
    cells[row.code] = months.map((_, p) => {
      const cell = evaluation.cell(row.code, p);
      return {
        ...serialize(cell.value),
        formula: cell.formula,
        refs: cell.refs.map((ref) => ({
          ...serialize(ref.value),
          code: ref.code,
          label: labels.get(ref.code) ?? ref.code,
          period: ref.period,
          source: sourceOf(ref.code, ref.period),
        })),
      };
    });
  }

  const tests = [
    ...builtInTests(input.line.limit).map((t) => ({ test: t, builtIn: true })),
    ...(input.definition.tests ?? []).map((t) => ({ test: t, builtIn: false })),
  ].map(({ test, builtIn }): TestResult => ({
    id: test.id,
    name: test.name,
    metric: test.metric,
    test: test.test,
    builtIn,
    months: months.map((m, p) => {
      const cell = evaluation.cell(test.metric, p);
      const value = serialize(cell.value);
      // The overline test reads the limit in force, a deal's included.
      const limit = (assumptions.BB_LIMIT as Value[])[p];
      const threshold =
        builtIn && test.id === "overline"
          ? limit instanceof Dec
            ? limit.toFixed()
            : null
          : termIn(test.threshold, index[p]!).value;
      // Months without a certificate aren't tested; projected ones are.
      if (
        (!m.quality && !m.projected) ||
        value.value === null ||
        value.error ||
        threshold === null
      )
        return { ...value, threshold, margin: null, pass: null };
      const figure = new Dec(value.value);
      const margin =
        test.test === "min"
          ? figure.minus(threshold)
          : new Dec(threshold).minus(figure);
      return {
        ...value,
        threshold,
        margin: margin.toFixed(),
        pass: !margin.isNegative(),
      };
    }),
  }));
  return { months, rows: compiled.rows, cells, tests };
}
