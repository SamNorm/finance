import type { schema } from "@finance/db";
import { DomainError } from "../errors";
import { monthIndex } from "../financing/amortization";
import { parseAmount, parseRate } from "../financing/common";

// Terms of a line of credit and its borrowing base (borrowing-base-plan.md
// §5.3): a limit, an advance rate or a cap that can differ in some calendar
// months every year, for a season, and step from a month, for an amendment.
// A step replaces the value and its seasons from its month on.

export type Term = schema.Term;
export type Season = schema.Season;

// A term as typed: a plain value, or the value with its seasons and steps.
// Seasons' months are calendar months, 1 to 12, as a list ([10, 11, 12, 1,
// 2, 3]) or a range ("10-3", October to March). Steps start in a month,
// "2026-06".
export type TermInput =
  | string
  | number
  | {
      value?: unknown;
      seasons?: unknown;
      steps?: unknown;
    };

export type TermKind = "amount" | "rate";

const MAX_SEASONS = 6;
const MAX_STEPS = 24;

const invalid = (message: string) => new DomainError("invalid", message);

// "2026-06" or "2026-06-30" → "2026-06".
export function parseMonth(raw: unknown, what: string): string {
  const text = String(raw ?? "").trim();
  const match = /^(\d{4})-(\d{2})(-\d{2})?$/.exec(text);
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12)
    throw invalid(`${what}: give the month as YYYY-MM, such as 2026-06.`);
  return `${match[1]}-${match[2]}`;
}

// The month a "YYYY-MM" stands for, counted as monthIndex counts dates.
export const monthNumber = (month: string) => monthIndex(`${month}-01`);

function parseMonths(raw: unknown, what: string): number[] {
  let months: number[];
  if (Array.isArray(raw)) months = raw.map(Number);
  else {
    const range = /^\s*(\d{1,2})\s*[-–]\s*(\d{1,2})\s*$/.exec(
      String(raw ?? ""),
    );
    if (!range)
      throw invalid(
        `${what}: give a season's months as a list, such as [10, 11, 12, 1, 2, 3], or a range, such as "10-3".`,
      );
    const [from, to] = [Number(range[1]), Number(range[2])];
    months = [];
    for (let m = from; months.length < 12; m = (m % 12) + 1) {
      months.push(m);
      if (m === to) break;
    }
  }
  if (
    !months.length ||
    months.some((m) => !Number.isInteger(m) || m < 1 || m > 12)
  )
    throw invalid(`${what}: a season's months are 1 to 12.`);
  if (new Set(months).size !== months.length || months.length === 12)
    throw invalid(
      `${what}: a season covers some of the year's months, each once.`,
    );
  return months;
}

function parseValueOf(raw: unknown, what: string, kind: TermKind): string {
  return kind === "rate"
    ? parseRate(raw, what, "rate")
    : parseAmount(raw, what, "amount", true);
}

function parseSeasons(raw: unknown, what: string, kind: TermKind): Season[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_SEASONS)
    throw invalid(`${what}: seasons are a list of up to ${MAX_SEASONS}.`);
  const seen = new Set<number>();
  return raw.map((season: { months?: unknown; value?: unknown } | null) => {
    const months = parseMonths(season?.months, what);
    if (months.some((m) => seen.has(m)))
      throw invalid(`${what}: two seasons can't share a month.`);
    for (const m of months) seen.add(m);
    return { months, value: parseValueOf(season?.value, what, kind) };
  });
}

// Checks and makes canonical a term as typed; `what` names it in messages,
// e.g. "Operating line, limit".
export function parseTerm(raw: unknown, what: string, kind: TermKind): Term {
  if (raw === null || raw === undefined || raw === "")
    throw invalid(`${what}: enter it.`);
  if (typeof raw !== "object") return { value: parseValueOf(raw, what, kind) };
  const input = raw as Exclude<TermInput, string | number>;
  const seasons = parseSeasons(input.seasons, what, kind);
  const rawSteps = input.steps ?? [];
  if (!Array.isArray(rawSteps) || rawSteps.length > MAX_STEPS)
    throw invalid(`${what}: steps are a list of up to ${MAX_STEPS}.`);
  const steps = rawSteps
    .map(
      (step: { from?: unknown; value?: unknown; seasons?: unknown } | null) => {
        const from = parseMonth(step?.from, `${what}, step`);
        const stepSeasons = parseSeasons(
          step?.seasons,
          `${what}, from ${from}`,
          kind,
        );
        return {
          from,
          value: parseValueOf(step?.value, `${what}, from ${from}`, kind),
          ...(stepSeasons.length ? { seasons: stepSeasons } : {}),
        };
      },
    )
    .sort((a, b) => a.from.localeCompare(b.from));
  if (new Set(steps.map((s) => s.from)).size !== steps.length)
    throw invalid(`${what}: two steps can't start in the same month.`);
  return {
    value: parseValueOf(input.value, what, kind),
    ...(seasons.length ? { seasons } : {}),
    ...(steps.length ? { steps } : {}),
  };
}

export interface TermValue {
  value: string;
  // The step in force, by the month it started; null before any.
  from: string | null;
  // The season's months, when one applies.
  season: number[] | null;
}

// A term's value in a month, counted as monthIndex counts dates.
export function termIn(term: Term, month: number): TermValue {
  const step = term.steps?.findLast((s) => monthNumber(s.from) <= month);
  const { value, seasons } = step ?? term;
  const calendar = (((month % 12) + 12) % 12) + 1;
  const season = seasons?.find((s) => s.months.includes(calendar));
  return {
    value: season?.value ?? value,
    from: step?.from ?? null,
    season: season?.months ?? null,
  };
}

// Whether a term ever changes: by season or step.
export const isPlain = (term: Term) =>
  !term.seasons?.length && !term.steps?.length;
