import type { schema } from "@finance/db";
import { Dec, parseFormula, type Node } from "@finance/engine";
import type { AnalysisRun } from "../analyses/run";
import { fiscalYearOf } from "../borrowing-bases/cycle";
import { DomainError } from "../errors";
import { entryId } from "../financing/common";
import type { LineFormat, ModelLine } from "../financial-models/types";
import { CODE_PATTERN } from "../scoring-models/validate";
import { parseValue } from "../spreads/values";

// Covenants (§5.5): terms of a credit agreement, kept on the borrower and
// proposed per deal, tested in any analysis whose model computes their
// line. Each period tested, interim ones included, shows the threshold, the
// actual figure, the room left before a breach, and, for a ratio of two
// lines, that room in dollars.

export type Covenant = schema.Covenant;
export type CovenantTestKind = Covenant["test"];

export const COVENANT_TESTS: Record<CovenantTestKind, string> = {
  min: "At least",
  max: "At most",
};

// A covenant as typed. A single `threshold` stands for one that never
// steps; `thresholds` lists each step, the first with no year.
export interface CovenantInput {
  id?: unknown;
  name?: unknown;
  metric?: unknown;
  test?: unknown;
  threshold?: unknown;
  thresholds?: readonly { from?: unknown; value?: unknown }[];
  note?: unknown;
}

const MAX_COVENANTS = 30;
const MAX_STEPS = 20;

const invalid = (message: string) => new DomainError("invalid", message);

// "1.25", "1.25x", "3.5 x", "75%" or "2,000,000": a ratio, a percentage or
// an amount, as a canonical decimal.
export function parseThreshold(raw: unknown, what: string): string {
  const text = String(raw ?? "")
    .trim()
    .replace(/\s*[xX×]$/, "");
  const parsed = parseValue(text, text.endsWith("%") ? "percent" : "amount");
  if ("error" in parsed) throw invalid(`${what}: ${parsed.error}`);
  if (parsed.value === null) throw invalid(`${what}: enter the threshold.`);
  return parsed.value;
}

function parseYear(raw: unknown, what: string): number {
  const year = Number(String(raw ?? "").trim());
  if (!Number.isInteger(year) || year < 1900 || year > 2200)
    throw invalid(`${what}: a step starts in a fiscal year, such as 2026.`);
  return year;
}

// Checks and makes canonical a list of covenants: each named, on a line
// code, at least or at most, with its thresholds in year order.
export function normalizeCovenants(
  input: readonly CovenantInput[],
): Covenant[] {
  if (!Array.isArray(input) || input.length > MAX_COVENANTS)
    throw invalid(`Covenants are a list of up to ${MAX_COVENANTS}.`);
  return input.map((c, i) => {
    const name = String(c?.name ?? "").trim();
    if (!name) throw invalid(`Covenant ${i + 1}: give it a name.`);
    const metric = String(c.metric ?? "").trim();
    if (!CODE_PATTERN.test(metric))
      throw invalid(
        `${name}: choose the financial model line it tests, by its code.`,
      );
    if (c.test !== "min" && c.test !== "max")
      throw invalid(`${name}: choose whether it's a minimum or a maximum.`);
    const raw =
      c.thresholds ??
      (c.threshold === undefined ? [] : [{ value: c.threshold }]);
    if (!Array.isArray(raw) || !raw.length || raw.length > MAX_STEPS)
      throw invalid(`${name}: enter its threshold.`);
    const steps = raw.map((step, s) => ({
      from:
        s === 0 && !String(step?.from ?? "").trim()
          ? null
          : parseYear(step?.from, name),
      value: parseThreshold(step?.value, name),
    }));
    if (steps[0]!.from !== null)
      throw invalid(
        `${name}: the first threshold applies from the start, with no year.`,
      );
    for (let s = 2; s < steps.length; s++)
      if (steps[s]!.from! <= steps[s - 1]!.from!)
        throw invalid(`${name}: list the steps in year order, each once.`);
    const note = String(c.note ?? "").trim();
    return {
      id: entryId(c.id),
      name,
      metric,
      test: c.test,
      thresholds: steps,
      ...(note ? { note } : {}),
    };
  });
}

// The threshold in a fiscal year: the last step started by then.
export function thresholdIn(covenant: Covenant, year: number): string {
  return covenant.thresholds.findLast(
    (step) => step.from === null || step.from <= year,
  )!.value;
}

export interface CovenantPeriod {
  // Null where the covenant isn't tested: the model has no such line.
  threshold: string | null;
  actual: string | null;
  pass: boolean | null;
  // The room left before a breach, in the metric's terms: actual less
  // threshold for a minimum, threshold less actual for a maximum. Negative
  // in breach.
  margin: string | null;
  // For a ratio of two lines, the same room in the numerator's terms, such
  // as cash flow above what the minimum coverage needs, or debt the maximum
  // leverage still allows; and how far the line it rests on can fall before
  // a breach, as a fraction. A line the ratio annualizes counts at its
  // annualized figure, and its label says so in an interim period.
  cushion: {
    amount: string;
    line: string;
    fall: string | null;
    fallLine: string;
  } | null;
}

export interface CovenantResult {
  covenant: Covenant;
  // The metric's label and format in the model; null when the model has no
  // such line, so the covenant can't be tested.
  label: string | null;
  format: LineFormat | null;
  periods: CovenantPeriod[];
}

const UNTESTED: CovenantPeriod = {
  threshold: null,
  actual: null,
  pass: null,
  margin: null,
  cushion: null,
};

// A side of a ratio: a line, or a line annualized, as in
// FUNDED_DEBT / ANNUALIZE(EBITDA), which reads its figure scaled to twelve
// months.
interface Side {
  code: string;
  annualized: boolean;
}

function sideOf(node: Node): Side | null {
  if (node.type === "ref") return { code: node.name, annualized: false };
  const [arg] = node.type === "call" ? node.args : [];
  return node.type === "call" &&
    node.name.toUpperCase() === "ANNUALIZE" &&
    node.args.length === 1 &&
    arg!.type === "ref"
    ? { code: arg!.name, annualized: true }
    : null;
}

// A formula that divides one line by another: its two sides.
function ratioOf(formula: string | null): [Side, Side] | null {
  if (!formula) return null;
  let node: Node;
  try {
    node = parseFormula(formula);
  } catch {
    return null;
  }
  if (node.type !== "binary" || node.op !== "/") return null;
  const [top, bottom] = [sideOf(node.left), sideOf(node.right)];
  return top && bottom ? [top, bottom] : null;
}

// The borrower's fiscal year end month, 1 to 12, from the run's latest
// fiscal year; December when it has none.
function yearEndMonthOf(run: AnalysisRun): number {
  const year =
    run.periods.findLast((p) => p.months === 12 && !p.projection) ??
    run.periods.findLast((p) => p.months === 12);
  return year ? Number(year.end.slice(5, 7)) : 12;
}

// Tests covenants in each period of a run: fiscal years, interim periods
// and projected years. An interim period takes the threshold of the fiscal
// year it falls in, and the model's line as it computes it there: a ratio
// that mixes the balance sheet with the P&L annualizes the P&L side, with
// ANNUALIZE or TTM, as it would for the results table.
export function testCovenants(
  covenants: readonly Covenant[],
  run: AnalysisRun,
  lines: readonly ModelLine[],
): CovenantResult[] {
  const byCode = new Map(lines.map((l) => [l.code.toUpperCase(), l]));
  const yearEndMonth = yearEndMonthOf(run);
  return covenants.map((covenant) => {
    const line = byCode.get(covenant.metric.toUpperCase());
    if (!line || line.kind === "header")
      return {
        covenant,
        label: null,
        format: null,
        periods: run.periods.map(() => UNTESTED),
      };
    const cells = run.cells[line.code] ?? [];
    return {
      covenant,
      label: line.label,
      format: line.format,
      periods: run.periods.map((period, p): CovenantPeriod => {
        const cell = cells[p];
        const threshold = thresholdIn(
          covenant,
          fiscalYearOf(period.end, yearEndMonth),
        );
        if (!cell || cell.error || cell.value === null)
          return { ...UNTESTED, threshold };
        const actual = new Dec(cell.value);
        const limit = new Dec(threshold);
        const min = covenant.test === "min";
        const margin = min ? actual.minus(limit) : limit.minus(actual);
        const ratio = ratioOf(cell.formula);
        // A side's figure in the period, annualized where the ratio is.
        const side = (s: Side) => {
          const ref = cell.refs.find(
            (r) =>
              r.code.toUpperCase() === s.code.toUpperCase() && r.period === p,
          );
          if (!ref?.value) return null;
          const interim = s.annualized && period.months !== 12;
          return {
            value: interim
              ? new Dec(ref.value).times(12).div(period.months)
              : new Dec(ref.value),
            label: interim ? `${ref.label}, annualized` : ref.label,
          };
        };
        const [top, bottom] = ratio ? [side(ratio[0]), side(ratio[1])] : [];
        let cushion: CovenantPeriod["cushion"] = null;
        if (top && bottom && !limit.isZero()) {
          const a = top.value;
          const b = bottom.value;
          // Minimum: the numerator needs threshold × denominator, and can
          // fall to it. Maximum: the numerator can rise to threshold ×
          // denominator, and the denominator fall to numerator / threshold.
          const room = min ? a.minus(limit.times(b)) : limit.times(b).minus(a);
          const fall = min
            ? a.isPositive()
              ? room.div(a)
              : null
            : b.isPositive()
              ? new Dec(1).minus(a.div(limit.times(b)))
              : null;
          cushion = {
            amount: room.toFixed(),
            line: top.label,
            fall: fall?.toFixed() ?? null,
            fallLine: min ? top.label : bottom.label,
          };
        }
        return {
          threshold,
          actual: actual.toFixed(),
          pass: !margin.isNegative(),
          margin: margin.toFixed(),
          cushion,
        };
      }),
    };
  });
}
