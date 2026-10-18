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
import { monthIndex } from "../financing/amortization";
import { capexValues, type CapexItem } from "../financing/capex";
import {
  periodModes,
  type FinancingPart,
  type FinancingValue,
} from "../financing/common";
import {
  debtSchedulesValues,
  type DebtSchedule,
} from "../financing/debt-schedule";
import {
  FINANCING_CODES,
  FINANCING_INPUTS,
  PROJECT_CODES,
  projectItemAdjustments,
  projectValues,
  type FinancingCode,
  type FinancingItems,
  type Project,
  type Side,
} from "../financing/financing";
import type { ScoringItem } from "../scoring-models/types";
import { addToItems, effectiveAmounts, TOLERANCE } from "../spreads/checks";
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
  // scenario's financing, the borrower's debt schedule, the scenario's capex
  // plan, or nothing.
  source:
    | "calculation"
    | "assumption"
    | "entered"
    | "summed"
    | "adjustment"
    | "schedule"
    | "capex"
    | "blank";
  // For financing and items the project adjusted: each entry's share.
  parts?: FinancingPart[];
}

export interface ResultCell extends ResultValue {
  formula: string | null;
  refs: LineageRef[];
}

export interface AssumptionValue {
  base: string | null;
  // The scenario's value for every period, or else the base.
  value: string | null;
  // Whether the scenario changes it, for every period or year by year.
  overridden: boolean;
  // Keys of the periods where the scenario's value for that period applies.
  byPeriod: string[];
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
  // With the scenario's project: the post-project columns.
  postProject: boolean;
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
    // Items the project changed, with what they're made of.
    adjusted?: Record<string, FinancingPart[]>;
  }[];
  // Years computed from assumptions after the last period.
  projectionYears: number;
  lines: readonly ModelLine[];
  overrides: Record<string, string>;
  // Values entered year by year, by assumption code then period end. They
  // apply in projected periods and, post-project, from the last fiscal year
  // on; never to actual periods as they stand.
  periodOverrides?: Record<string, Record<string, string>>;
  // The scenario's project: given, the run is post-project. Its effect on
  // balance sheet items comes in the periods' figures.
  project?: Project | null;
  // The borrower's existing loans, or a consolidated client's members'.
  debtSchedules?: readonly DebtSchedule[];
  // The scenario's purchases planned in projected years.
  capex?: readonly CapexItem[];
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
  const project = input.project ?? null;
  const modes = periodModes(
    periods.map((p) => ({
      months: p.months,
      projected: p.projection !== null,
    })),
    project !== null,
  );
  const info = periods.map((p, i) => ({
    end: p.end,
    months: p.months,
    mode: modes[i]!,
  }));
  const financing = (
    project
      ? projectValues(project, info)
      : Object.fromEntries(
          PROJECT_CODES.map((code) => [
            code,
            periods.map(() => ({ value: new Dec(0), parts: [] })),
          ]),
        )
  ) as Record<FinancingCode, FinancingValue[]>;
  const schedule = debtSchedulesValues(
    input.debtSchedules ?? [],
    info,
    project ? monthIndex(project.closing) : null,
    new Set(project?.consolidatedLoans),
  );
  const blank = { value: null, parts: [] };
  financing.DEBT_SCHEDULE_INTEREST = schedule.interest.map((v) => v ?? blank);
  financing.DEBT_SCHEDULE_PRINCIPAL = schedule.principal.map((v) => v ?? blank);
  financing.DEBT_SCHEDULE_PREPAYMENTS = schedule.prepayments.map(
    (v) => v ?? blank,
  );
  financing.DEBT_SCHEDULE_BALANCE = schedule.balance.map((v) => v ?? blank);
  Object.assign(financing, capexValues(input.capex ?? [], info));
  const isFinancing = (code: string): code is FinancingCode =>
    FINANCING_CODES.includes(code);
  const financingLabels = new Map<string, string>(
    FINANCING_INPUTS.map((f) => [f.code, f.label]),
  );
  const assumptions: Record<string, AssumptionValue> = {};
  const assumptionValues: Record<string, Value | Value[]> = {};
  for (const line of input.lines) {
    if (line.kind !== "assumption") continue;
    const override = input.overrides[line.code];
    const value = override ?? line.defaultValue;
    const entered = input.periodOverrides?.[line.code] ?? {};
    const byPeriod = periods.flatMap((p, i) =>
      modes[i] !== "actual" && entered[p.end] !== undefined ? [p.key] : [],
    );
    assumptions[line.code] = {
      base: line.defaultValue,
      value,
      overridden: override !== undefined || byPeriod.length > 0,
      byPeriod,
    };
    assumptionValues[line.code] = byPeriod.length
      ? periods.map((p, i) =>
          assumptionValue(
            modes[i] !== "actual" ? (entered[p.end] ?? value) : value,
            line.format,
          ),
        )
      : assumptionValue(value, line.format);
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
    if (isFinancing(code))
      return code.startsWith("DEBT_SCHEDULE_")
        ? "schedule"
        : code.startsWith("CAPEX_")
          ? "capex"
          : "adjustment";
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
    if (period?.adjusted?.[code]) return "adjustment";
    if (period?.entered[code] !== undefined) return "entered";
    if (period?.summed[code] !== undefined) return "summed";
    return "blank";
  };
  const partsOf = (code: string, p: number) =>
    isFinancing(code)
      ? financing[code][p]!.parts
      : input.periods[p]?.adjusted?.[code];

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
          ...(partsOf(ref.code, ref.period)
            ? { parts: partsOf(ref.code, ref.period) }
            : {}),
        })),
      };
    });
  }
  return {
    postProject: project !== null,
    periods,
    cells,
    assumptions,
    breakdowns: reconcile(input, inputLines),
  };
}

// The spread's periods with the project posted to their balance sheet
// items, subtotals moved or summed again, and what each adjusted item is
// made of.
export function withProject(
  periods: RunInput["periods"],
  project: Project,
  items: readonly ScoringItem[],
  sides: ReadonlyMap<string, Side>,
  mapping: FinancingItems,
): RunInput["periods"] {
  const modes = periodModes(
    periods.map((p) => ({
      months: p.months,
      projected: p.quality === "projected",
    })),
    true,
  );
  const adjustments = projectItemAdjustments(
    project,
    periods.map((p, i) => ({ end: p.end, months: p.months, mode: modes[i]! })),
    sides,
    mapping,
  );
  return periods.map((period, i) => {
    const changes = adjustments[i]!;
    if (!changes.size) return period;
    const { entered, adjusted } = addToItems(items, period.entered, changes);
    const { computed } = effectiveAmounts(
      items,
      new Map(Object.entries(entered)),
    );
    return {
      ...period,
      entered,
      summed: Object.fromEntries(
        [...computed].map(([code, value]) => [code, value.toFixed()]),
      ),
      adjusted,
    };
  });
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
