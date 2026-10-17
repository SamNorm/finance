import {
  Dec,
  evaluateModel,
  isError,
  isNumber,
  shiftYear,
  type Projection,
  type Value,
} from "@finance/engine";
import { assumptionValue } from "../financial-models/validate";
import type { ModelLine } from "../financial-models/types";
import {
  FINANCING_CODES,
  FINANCING_INPUTS,
  financingValues,
  type FinancingAdjustment,
  type FinancingCode,
  type FinancingPart,
} from "../financing/financing";
import { TOLERANCE } from "../spreads/checks";
import type { StatementQuality } from "../spreads/service";

// Runs a financial model version over a borrower's periods, plus projected
// years, and serializes every value with what it was computed from (§6,
// lineage). Pure: the service loads the figures and the model.

export interface RunPeriod {
  key: string;
  end: string;
  months: number;
  quality: StatementQuality;
  // Null for actuals; how the period is projected otherwise.
  projection: Projection | null;
}

// A value as text: decimals in full, "true"/"false" for flags, or an error.
export interface ResultValue {
  value: string | null;
  error: { code: string; message: string } | null;
}

export interface LineageRef extends ResultValue {
  code: string;
  label: string;
  period: number;
  // Where the value came from: a model line, an assumption, a figure entered
  // in the spread or for the model, a subtotal summed from its lines, the
  // scenario's financing, or nothing.
  source:
    | "calculation"
    | "assumption"
    | "entered"
    | "summed"
    | "adjustment"
    | "blank";
  // For financing: each loan's or subordination's share.
  parts?: FinancingPart[];
}

export interface ResultCell extends ResultValue {
  formula: string | null;
  refs: LineageRef[];
}

export interface AssumptionValue {
  base: string | null;
  value: string | null;
  overridden: boolean;
}

// Input lines that break down a scoring model item, such as inventory by
// type, against the item in one period.
export interface Breakdown {
  code: string;
  label: string;
  period: number;
  // The item as entered or summed in the spread, and the sum of its parts.
  total: string | null;
  parts: string;
  // Total less parts; zero, within rounding, when they reconcile.
  difference: string;
  reconciles: boolean;
}

export interface AnalysisRun {
  periods: RunPeriod[];
  cells: Record<string, ResultCell[]>;
  assumptions: Record<string, AssumptionValue>;
  breakdowns: Breakdown[];
}

export interface RunInput {
  // Spread periods, oldest first, with their figures. Periods of quality
  // "projected" are the client's projections.
  periods: {
    key: string;
    end: string;
    months: number;
    quality: StatementQuality;
    entered: Record<string, string>;
    summed: Record<string, string>;
    // Figures for the model's input lines, by line code.
    modelInputs: Record<string, string>;
  }[];
  // Years computed from assumptions after the last period.
  projectionYears: number;
  lines: readonly ModelLine[];
  overrides: Record<string, string>;
  // The scenario's post-project financing.
  adjustments: readonly FinancingAdjustment[];
  // Items of the scoring model version the model is bound to.
  items: readonly { code: string; label: string; numeric: boolean }[];
}

export function serialize(value: Value): ResultValue {
  if (isError(value))
    return { value: null, error: { code: value.code, message: value.message } };
  if (value === null) return { value: null, error: null };
  if (typeof value === "boolean") return { value: String(value), error: null };
  if (typeof value === "string") return { value, error: null };
  return { value: value.toFixed(), error: null };
}

export function runModel(input: RunInput): AnalysisRun {
  // Projected years follow the last fiscal year, past any year-to-date period.
  const last =
    input.periods.findLast((p) => p.months === 12) ?? input.periods.at(-1);
  const periods: RunPeriod[] = [
    ...input.periods.map(({ key, end, months, quality }) => ({
      key,
      end,
      months,
      quality,
      projection: quality === "projected" ? ("client" as const) : null,
    })),
    ...(last
      ? Array.from({ length: input.projectionYears }, (_, i) => ({
          key: `projected-${i + 1}`,
          end: shiftYear(last.end, i + 1),
          months: 12,
          quality: "projected" as const,
          projection: "assumptions" as const,
        }))
      : []),
  ];

  const items = new Map(input.items.map((item) => [item.code, item]));
  const lineByCode = new Map(input.lines.map((line) => [line.code, line]));
  const inputLines = input.lines.filter((line) => line.kind === "input");
  const financing = financingValues(input.adjustments, periods);
  const isFinancing = (code: string): code is FinancingCode =>
    FINANCING_CODES.includes(code);
  const financingLabels = new Map<string, string>(
    FINANCING_INPUTS.map((f) => [f.code, f.label]),
  );
  const assumptions: Record<string, AssumptionValue> = {};
  const assumptionValues: Record<string, Value> = {};
  for (const line of input.lines) {
    if (line.kind !== "assumption") continue;
    const override = input.overrides[line.code];
    const value = override ?? line.defaultValue;
    assumptions[line.code] = {
      base: line.defaultValue,
      value,
      overridden: override !== undefined,
    };
    assumptionValues[line.code] = assumptionValue(value, line.format);
  }

  const evaluation = evaluateModel({
    periods: periods.map(({ key, end, months, projection }) => ({
      key,
      end,
      months,
      projection: projection ?? undefined,
    })),
    calculations: input.lines
      .filter((line) => line.kind === "calculation")
      .map((line) => ({
        code: line.code,
        formula: line.formula,
        projectionFormula: line.projectionFormula,
      })),
    assumptions: assumptionValues,
    inputCodes: [
      ...input.items
        .map((item) => item.code)
        .filter((code) => !isFinancing(code)),
      ...inputLines.map((line) => line.code),
      ...FINANCING_CODES,
    ],
    input: (code, p) => {
      if (isFinancing(code)) return financing[code][p]!.value;
      const period = input.periods[p];
      const line = lineByCode.get(code);
      if (line?.kind === "input")
        return assumptionValue(period?.modelInputs[code] ?? null, line.format);
      const raw = period?.entered[code] ?? period?.summed[code];
      if (raw === undefined) return null;
      return items.get(code)?.numeric ? new Dec(raw) : raw;
    },
    inputProjections: Object.fromEntries(
      inputLines.map((line) => [line.code, line.projectionFormula]),
    ),
  });

  const sourceOf = (code: string, p: number): LineageRef["source"] => {
    if (isFinancing(code)) return "adjustment";
    const line = lineByCode.get(code);
    if (line?.kind === "input") {
      if (periods[p]?.projection === "assumptions" && line.projectionFormula)
        return "calculation";
      return input.periods[p]?.modelInputs[code] !== undefined
        ? "entered"
        : "blank";
    }
    if (line) return line.kind === "assumption" ? "assumption" : "calculation";
    const period = input.periods[p];
    if (period?.entered[code] !== undefined) return "entered";
    if (period?.summed[code] !== undefined) return "summed";
    return "blank";
  };

  const cells: Record<string, ResultCell[]> = {};
  for (const line of input.lines) {
    if (line.kind === "header") continue;
    cells[line.code] = periods.map((_, p) => {
      const cell = evaluation.cell(line.code, p);
      return {
        ...serialize(cell.value),
        formula: cell.formula,
        refs: cell.refs.map((ref) => ({
          ...serialize(ref.value),
          code: ref.code,
          label:
            lineByCode.get(ref.code)?.label ??
            financingLabels.get(ref.code) ??
            items.get(ref.code)?.label ??
            ref.code,
          period: ref.period,
          source: sourceOf(ref.code, ref.period),
          ...(isFinancing(ref.code)
            ? { parts: financing[ref.code][ref.period]!.parts }
            : {}),
        })),
      };
    });
  }
  return {
    periods,
    cells,
    assumptions,
    breakdowns: reconcile(input, inputLines),
  };
}

// Each item broken down by input lines, in every spread period where at least
// one part is entered.
function reconcile(input: RunInput, inputLines: ModelLine[]): Breakdown[] {
  const parts = new Map<string, ModelLine[]>();
  for (const line of inputLines) {
    if (line.breaksDown)
      parts.set(line.breaksDown, [...(parts.get(line.breaksDown) ?? []), line]);
  }
  const breakdowns: Breakdown[] = [];
  for (const [code, lines] of parts) {
    const label = input.items.find((item) => item.code === code)?.label ?? code;
    input.periods.forEach((period, p) => {
      const entered = lines
        .map((line) => period.modelInputs[line.code])
        .filter((raw) => raw !== undefined);
      if (!entered.length) return;
      const sum = entered.reduce((a, raw) => a.plus(raw), new Dec(0));
      const raw = period.entered[code] ?? period.summed[code] ?? null;
      const difference = new Dec(raw ?? 0).minus(sum);
      breakdowns.push({
        code,
        label,
        period: p,
        total: raw,
        parts: sum.toFixed(),
        difference: difference.toFixed(),
        reconciles: difference.abs().lte(TOLERANCE),
      });
    });
  }
  return breakdowns;
}
