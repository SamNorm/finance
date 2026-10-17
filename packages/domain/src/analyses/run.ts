import {
  Dec,
  evaluateModel,
  isError,
  isNumber,
  shiftYear,
  type Value,
} from "@finance/engine";
import { assumptionValue } from "../financial-models/validate";
import type { ModelLine } from "../financial-models/types";
import type { StatementQuality } from "../spreads/service";

// Runs a financial model version over a borrower's periods, plus projected
// years, and serializes every value with what it was computed from (§6,
// lineage). Pure: the service loads the figures and the model.

export interface RunPeriod {
  key: string;
  end: string;
  months: number;
  quality: StatementQuality;
  projected: boolean;
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
  // in the spread, a subtotal summed from its lines, or nothing.
  source: "calculation" | "assumption" | "entered" | "summed" | "blank";
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

export interface AnalysisRun {
  periods: RunPeriod[];
  cells: Record<string, ResultCell[]>;
  assumptions: Record<string, AssumptionValue>;
}

export interface RunInput {
  // Historical periods, oldest first, with their figures.
  periods: {
    key: string;
    end: string;
    months: number;
    quality: StatementQuality;
    entered: Record<string, string>;
    summed: Record<string, string>;
  }[];
  projectionYears: number;
  lines: readonly ModelLine[];
  overrides: Record<string, string>;
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
  const last = input.periods.at(-1);
  const periods: RunPeriod[] = [
    ...input.periods.map(({ key, end, months, quality }) => ({
      key,
      end,
      months,
      quality,
      projected: false,
    })),
    ...(last
      ? Array.from({ length: input.projectionYears }, (_, i) => ({
          key: `projected-${i + 1}`,
          end: shiftYear(last.end, i + 1),
          months: 12,
          quality: "projected" as const,
          projected: true,
        }))
      : []),
  ];

  const items = new Map(input.items.map((item) => [item.code, item]));
  const lineByCode = new Map(input.lines.map((line) => [line.code, line]));
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
    periods: periods.map(({ key, end, months, projected }) => ({
      key,
      end,
      months,
      projected,
    })),
    calculations: input.lines
      .filter((line) => line.kind === "calculation")
      .map((line) => ({
        code: line.code,
        formula: line.formula,
        projectionFormula: line.projectionFormula,
      })),
    assumptions: assumptionValues,
    inputCodes: input.items.map((item) => item.code),
    input: (code, p) => {
      const period = input.periods[p];
      const raw = period?.entered[code] ?? period?.summed[code];
      if (raw === undefined) return null;
      return items.get(code)?.numeric ? new Dec(raw) : raw;
    },
  });

  const sourceOf = (code: string, p: number): LineageRef["source"] => {
    const line = lineByCode.get(code);
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
            items.get(ref.code)?.label ??
            ref.code,
          period: ref.period,
          source: sourceOf(ref.code, ref.period),
        })),
      };
    });
  }
  return { periods, cells, assumptions };
}
