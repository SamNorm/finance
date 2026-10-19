import type { schema } from "@finance/db";
import { DomainError } from "../errors";
import { parseMonth } from "../credit-lines/terms";
import { normalizeAssumption } from "../financial-models/validate";
import { parseValue } from "../spreads/values";
import type { CompiledBorrowingBase } from "./compile";
import type { BorrowingBaseDefinition, LineOf } from "./definition";

// How analyses and scenarios project a borrowing base (borrowing-base-plan.md
// §8): settings by line, checked against its definition.

export type ProjectedBorrowingBase = schema.ProjectedBorrowingBase;
export type ScenarioBorrowingBase = schema.ScenarioBorrowingBase;

export const DEFAULT_PROJECTED_MONTHS = 12;
export const MAX_PROJECTED_MONTHS = 24;

const invalid = (message: string) => new DomainError("invalid", message);

const object = (raw: unknown, what: string) => {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw))
    throw invalid(`${what}: give it by code.`);
  return raw as Record<string, unknown>;
};

function assumptionOf(
  definition: BorrowingBaseDefinition,
  code: string,
  name: string,
): LineOf<"assumption"> {
  const line = definition.lines.find((l) => l.code === code.toUpperCase());
  if (line?.kind !== "assumption")
    throw invalid(`${name}: "${code}" isn't one of its assumptions.`);
  return line;
}

const value = (
  raw: unknown,
  line: LineOf<"assumption">,
  what: string,
): string | null => {
  const parsed = normalizeAssumption(String(raw ?? ""), line.format);
  if ("error" in parsed) throw invalid(`${what}: ${parsed.error}`);
  return parsed.value;
};

// An analysis's settings for a line, as typed: where its projection comes
// from, over how many months, and the base case's assumption values, one
// for every month or one per calendar month.
export function normalizeProjectedBorrowingBase(
  input: { source?: unknown; months?: unknown; assumptions?: unknown },
  definition: BorrowingBaseDefinition,
  name: string,
  current?: ProjectedBorrowingBase,
): ProjectedBorrowingBase {
  const source =
    input.source === undefined
      ? (current?.source ?? "assumptions")
      : input.source;
  if (source !== "assumptions" && source !== "client")
    throw invalid(`${name}: project from assumptions or the client's figures.`);
  const months =
    input.months === undefined
      ? (current?.months ?? DEFAULT_PROJECTED_MONTHS)
      : Number(input.months);
  if (!Number.isInteger(months) || months < 1 || months > MAX_PROJECTED_MONTHS)
    throw invalid(`${name}: project 1 to ${MAX_PROJECTED_MONTHS} months.`);
  const assumptions: NonNullable<ProjectedBorrowingBase["assumptions"]> =
    input.assumptions === undefined ? { ...current?.assumptions } : {};
  for (const [code, raw] of Object.entries(
    object(input.assumptions, `${name}, assumptions`),
  )) {
    const line = assumptionOf(definition, code, name);
    if (raw === null) continue;
    const given = (typeof raw === "object" ? raw : { value: raw }) as {
      value?: unknown;
      byMonth?: unknown;
    };
    const byMonth = Array.isArray(given.byMonth)
      ? given.byMonth.map((v, m) =>
          value(v, line, `${line.label}, month ${m + 1}`),
        )
      : undefined;
    if (byMonth && byMonth.length !== 12)
      throw invalid(`${line.label}: give a value for each of the 12 months.`);
    const own =
      given.value === undefined ? null : value(given.value, line, line.label);
    if (own === null && !byMonth?.some((v) => v !== null)) continue;
    assumptions[line.code] = {
      ...(own !== null ? { value: own } : {}),
      ...(byMonth?.some((v) => v !== null) ? { byMonth } : {}),
    };
  }
  return {
    source,
    months,
    ...(Object.keys(assumptions).length ? { assumptions } : {}),
  };
}

// A scenario's changes to a line's projection, as typed: assumption values
// for every month or month by month, and figures of projected months by
// month then code, such as an extra ineligible.
export function normalizeScenarioBorrowingBase(
  input: unknown,
  definition: BorrowingBaseDefinition,
  compiled: CompiledBorrowingBase,
  name: string,
): ScenarioBorrowingBase {
  const raw = object(input, name) as {
    assumptions?: unknown;
    figures?: unknown;
  };
  const assumptions: NonNullable<ScenarioBorrowingBase["assumptions"]> = {};
  for (const [code, given] of Object.entries(
    object(raw.assumptions, `${name}, assumptions`),
  )) {
    const line = assumptionOf(definition, code, name);
    if (given === null) continue;
    const g = (typeof given === "object" ? given : { value: given }) as {
      value?: unknown;
      months?: unknown;
    };
    const months: Record<string, string> = {};
    for (const [rawMonth, v] of Object.entries(
      object(g.months, `${line.label}, months`),
    )) {
      const parsed = value(v, line, `${line.label}, ${rawMonth}`);
      if (parsed !== null) months[parseMonth(rawMonth, line.label)] = parsed;
    }
    const own = g.value === undefined ? null : value(g.value, line, line.label);
    if (own === null && !Object.keys(months).length) continue;
    assumptions[line.code] = {
      ...(own !== null ? { value: own } : {}),
      ...(Object.keys(months).length ? { months } : {}),
    };
  }
  const inputs = new Map(compiled.inputs.map((r) => [r.code, r]));
  const figures: NonNullable<ScenarioBorrowingBase["figures"]> = {};
  for (const [rawMonth, codes] of Object.entries(
    object(raw.figures, `${name}, figures`),
  )) {
    const month = parseMonth(rawMonth, name);
    for (const [rawCode, v] of Object.entries(
      object(codes, `${name}, ${month}`),
    )) {
      const code = rawCode.toUpperCase();
      const row = inputs.get(code);
      if (!row)
        throw invalid(
          `${name}: "${rawCode}" isn't entered in its borrowing base.`,
        );
      const parsed = parseValue(
        String(v ?? ""),
        row.format === "ratio" ? "ratio" : "amount",
      );
      if ("error" in parsed)
        throw invalid(`${row.label}, ${month}: ${parsed.error}`);
      if (parsed.value !== null) (figures[month] ??= {})[code] = parsed.value;
    }
  }
  return {
    ...(Object.keys(assumptions).length ? { assumptions } : {}),
    ...(Object.keys(figures).length ? { figures } : {}),
  };
}

// An assumption's value in a month: the scenario's for that month or for
// every month, else the analysis's for that calendar month or every month;
// undefined leaves the definition's.
export function assumptionAt(
  analysis: ProjectedBorrowingBase | undefined,
  scenario: ScenarioBorrowingBase | undefined,
) {
  return (code: string, month: string): string | null | undefined => {
    const own = scenario?.assumptions?.[code];
    if (own?.months?.[month] !== undefined) return own.months[month];
    if (own?.value !== undefined) return own.value;
    const base = analysis?.assumptions?.[code];
    const seasonal = base?.byMonth?.[Number(month.slice(5, 7)) - 1];
    if (seasonal !== undefined && seasonal !== null) return seasonal;
    return base?.value;
  };
}
