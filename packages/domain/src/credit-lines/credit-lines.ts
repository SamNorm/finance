import type { schema } from "@finance/db";
import { Dec } from "@finance/engine";
import { DomainError } from "../errors";
import { monthIndex, monthOf } from "../financing/amortization";
import {
  entryId,
  parseAmount,
  parseDate,
  parseRate,
  type Amount,
  type FinancingPeriod,
  type FinancingValue,
} from "../financing/common";
import { parseMonth, parseTerm, termIn, type Term } from "./terms";

// A borrower's lines of credit (borrowing-base-plan.md §4), and their
// interest in analyses: each month, the usage assumed (a share of that
// month's limit, or an amount drawn) at the line's rate. A scenario can
// propose the deal's lines: a new limit or rate, a new line, a line closed.

export type CreditLine = typeof schema.creditLines.$inferSelect;
export type LineUsage = schema.LineUsage;
export type ProposedLine = schema.ProposedLine;

// A line as analyses read it: one in force, a consolidated client's
// member's, or one a scenario proposes.
export interface LineTerms {
  id: string;
  name: string;
  currency: string;
  limit: Term;
  rate: string;
  // In force: closed that day; analyses count it up to its month.
  closedOn?: string | null;
  // Proposed: closed at the deal.
  closed?: boolean;
}

// A line as typed. The limit is a term: an amount, or one with seasons and
// steps (see TermInput).
export interface CreditLineInput {
  name?: unknown;
  currency?: unknown;
  limit?: unknown;
  rate?: unknown;
  // Blank or null keeps it open.
  closedOn?: unknown;
}

export interface ProposedLineInput extends CreditLineInput {
  id?: unknown;
  closed?: unknown;
}

const invalid = (message: string) => new DomainError("invalid", message);

export const MAX_LINES = 20;

function parseCurrency(raw: unknown, what: string): string {
  const text =
    String(raw ?? "")
      .trim()
      .toUpperCase() || "CAD";
  if (!/^[A-Z]{3}$/.test(text))
    throw invalid(`${what}: give the currency as its code, such as CAD.`);
  return text;
}

function parseName(raw: unknown, fallback: string): string {
  const name = String(raw ?? "").trim();
  if (!name) throw invalid(`${fallback}: give the line a name.`);
  return name;
}

// Checks and makes canonical a line as typed.
export function normalizeCreditLine(
  input: CreditLineInput,
  fallback = "Line of credit",
): Pick<CreditLine, "name" | "currency" | "limit" | "rate" | "closedOn"> {
  const name = parseName(input.name, fallback);
  const closed = String(input.closedOn ?? "").trim();
  return {
    name,
    currency: parseCurrency(input.currency, name),
    limit: parseTerm(input.limit, `${name}, limit`, "amount"),
    rate: parseRate(input.rate, name),
    closedOn: closed ? parseDate(closed, name, "date it was closed") : null,
  };
}

// A proposed line's id: one of the lines in force's, which for a
// consolidated client's members read "member/line", or a new line's.
const lineId = (raw: unknown) =>
  typeof raw === "string" && /^[\w-]{1,64}(\/[\w-]{1,64})?$/.test(raw)
    ? raw
    : entryId(undefined);

// Checks and makes canonical the lines a scenario proposes. A line keeps its
// id: one of the lines in force's, or a new line's.
export function normalizeProposedLines(input: unknown): ProposedLine[] {
  if (!Array.isArray(input) || input.length > MAX_LINES)
    throw invalid(`Proposed lines are a list of up to ${MAX_LINES}.`);
  const lines = input.map((raw: ProposedLineInput | null, i) => {
    const line = normalizeCreditLine(raw ?? {}, `Line ${i + 1}`);
    return {
      id: lineId(raw?.id),
      name: line.name,
      currency: line.currency,
      limit: line.limit,
      rate: line.rate,
      ...(raw?.closed === true ? { closed: true } : {}),
    };
  });
  if (new Set(lines.map((l) => l.id)).size !== lines.length)
    throw invalid("Each proposed line is proposed once.");
  return lines;
}

// Checks and makes canonical the usage assumed for lines, by line id: its
// average share of the limit ("60%"), and amounts drawn by month
// ("2025-11"). Blank or null values are dropped; lines not in `lineIds`
// are refused.
export function normalizeLineUsage(
  input: unknown,
  lineIds: ReadonlySet<string>,
  names: ReadonlyMap<string, string> = new Map(),
): LineUsage {
  if (input === null || input === undefined) return {};
  if (typeof input !== "object" || Array.isArray(input))
    throw invalid("Line usage is given by line.");
  const result: LineUsage = {};
  for (const [id, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!lineIds.has(id))
      throw invalid("That isn't one of the lines of credit here.");
    const what = names.get(id) ?? "Line of credit";
    if (raw === null || raw === undefined) continue;
    if (typeof raw !== "object")
      throw invalid(`${what}: give its usage as a share and months.`);
    const { share, months } = raw as { share?: unknown; months?: unknown };
    const usage: LineUsage[string] = {};
    if (share !== undefined && share !== null && String(share).trim())
      usage.share = parseRate(share, what, "average usage");
    if (months !== undefined && months !== null) {
      if (typeof months !== "object" || Array.isArray(months))
        throw invalid(`${what}: give months' usage by month, "2025-11".`);
      const kept: Record<string, string> = {};
      for (const [rawMonth, amount] of Object.entries(months)) {
        const month = parseMonth(rawMonth, what);
        if (amount === null || !String(amount).trim()) continue;
        kept[month] = parseAmount(amount, `${what}, ${month}`, "usage");
      }
      if (Object.keys(kept).length) usage.months = kept;
    }
    if (usage.share !== undefined || usage.months) result[id] = usage;
  }
  return result;
}

// A scenario's usage over the analysis's: its share replaces the analysis's,
// and its months replace theirs month by month.
export function mergeLineUsage(base: LineUsage, over: LineUsage): LineUsage {
  const result: LineUsage = { ...base };
  for (const [id, usage] of Object.entries(over)) {
    const months = { ...base[id]?.months, ...usage.months };
    const share = usage.share ?? base[id]?.share;
    result[id] = {
      ...(share !== undefined ? { share } : {}),
      ...(Object.keys(months).length ? { months } : {}),
    };
  }
  return result;
}

// The lines a run reads: those in force, and those the scenario proposes,
// from the month after `proposedAfter`.
export interface RunLines {
  inForce: readonly LineTerms[];
  proposed?: readonly ProposedLine[] | null;
  proposedAfter?: number | null;
  usage: LineUsage;
}

export const LINE_CODES = [
  "LINE_INTEREST",
  "LINE_AUTHORIZED",
  "LINE_AVERAGE_USAGE",
] as const;
export type LineCode = (typeof LINE_CODES)[number];

export type LineValues = Record<
  LineCode | "PROFORMA_LINE_INTEREST",
  (FinancingValue | null)[]
>;

// The lines open in a month: those in force (up to the month they close),
// or, once the deal applies, as it proposes them.
export function linesIn(
  lines: Pick<RunLines, "inForce" | "proposed" | "proposedAfter">,
  month: number,
): LineTerms[] {
  const open = lines.inForce.filter(
    (l) => !l.closedOn || month <= monthIndex(l.closedOn),
  );
  const { proposed, proposedAfter } = lines;
  if (!proposed || proposedAfter === null || proposedAfter === undefined)
    return open;
  if (month <= proposedAfter) return open;
  const byId = new Map(proposed.map((l) => [l.id, l]));
  const inForce = new Set(lines.inForce.map((l) => l.id));
  return [
    ...open.map((l) => byId.get(l.id) ?? l),
    ...proposed.filter((l) => !inForce.has(l.id)),
  ].filter((l) => !l.closed);
}

interface Window {
  // Months after `from`, up to and including `to`.
  from: number;
  to: number;
  // Interest scaled to this many months out of twelve: a pro forma
  // period's months.
  scale: number;
  // The month limits are read at.
  at: number;
}

// How a period reads lines, as it reads the debt schedule: a projected
// period, the months it covers; a pro forma one, the twelve months after
// closing; an actual one, nothing, so models fall back on the statements.
function windowOf(
  period: FinancingPeriod,
  closing: number | null,
): Window | null {
  const end = monthIndex(period.end);
  if (period.mode === "projected")
    return { from: end - period.months, to: end, scale: 12, at: end };
  if (period.mode === "proForma") {
    const from = closing ?? end;
    return { from, to: from + 12, scale: period.months, at: from + 1 };
  }
  return null;
}

// A line's usage in a month: the amount entered for it, or the share of
// the month's limit.
function usageIn(line: LineTerms, usage: LineUsage, month: number): Amount {
  const own = usage[line.id];
  const amount = own?.months?.[monthOf(month)];
  if (amount !== undefined) return new Dec(amount);
  if (own?.share === undefined) return new Dec(0);
  return new Dec(termIn(line.limit, month).value).times(own.share);
}

// Each line's usage over a window, and its cost: usage times rate, month by
// month, a year's interest per month. Interest is the cost over twelve,
// divided once so a year's adds up exactly.
function windowFigures(
  lines: Pick<RunLines, "inForce" | "proposed" | "proposedAfter">,
  usage: LineUsage,
  w: Window,
) {
  const each = new Map<
    string,
    { line: LineTerms; cost: Amount; usage: Amount }
  >();
  for (let month = w.from + 1; month <= w.to; month++) {
    for (const line of linesIn(lines, month)) {
      const used = usageIn(line, usage, month);
      const current = each.get(line.id) ?? {
        line,
        cost: new Dec(0),
        usage: new Dec(0),
      };
      current.line = line;
      current.cost = current.cost.plus(used.times(line.rate));
      current.usage = current.usage.plus(used);
      each.set(line.id, current);
    }
  }
  return each;
}

// A window's interest from a cost, scaled to a pro forma period's months.
const interestOf = (cost: Amount, w: Window) => cost.times(w.scale).div(144);

const cell = (): FinancingValue => ({ value: new Dec(0), parts: [] });
function add(target: FinancingValue, line: LineTerms, amount: Amount) {
  target.value = target.value!.plus(amount);
  if (!amount.isZero())
    target.parts.push({
      id: line.id,
      name: line.name,
      value: amount.toFixed(),
    });
}

// The lines' built-in inputs in each period of a run: interest, the limit at
// the period's end and the average drawn, each with a part per line; blank
// in actual periods, and everywhere when there are no lines. In a
// post-project run (`closing` given), PROFORMA_LINE_INTEREST is what the
// proposed lines add to the interest of those in force.
export function creditLineValues(
  lines: RunLines,
  periods: readonly FinancingPeriod[],
  closing: number | null,
): LineValues {
  const result: LineValues = {
    LINE_INTEREST: [],
    LINE_AUTHORIZED: [],
    LINE_AVERAGE_USAGE: [],
    PROFORMA_LINE_INTEREST: [],
  };
  const any = lines.inForce.length > 0 || (lines.proposed?.length ?? 0) > 0;
  const proposing =
    closing !== null && Boolean(lines.proposed) && lines.proposedAfter !== null;
  for (const period of periods) {
    const w = windowOf(period, closing);
    const proforma = cell();
    result.PROFORMA_LINE_INTEREST.push(proforma);
    if (!w || !any) {
      for (const code of LINE_CODES) result[code].push(null);
      continue;
    }
    const months = new Dec(w.to - w.from);
    const figures = windowFigures(lines, lines.usage, w);
    const interest = cell();
    const average = cell();
    for (const { line, cost, usage } of figures.values()) {
      add(interest, line, interestOf(cost, w));
      add(average, line, usage.div(months));
    }
    const authorized = cell();
    for (const line of linesIn(lines, w.at))
      add(authorized, line, new Dec(termIn(line.limit, w.at).value));
    result.LINE_INTEREST.push(interest);
    result.LINE_AUTHORIZED.push(authorized);
    result.LINE_AVERAGE_USAGE.push(average);
    if (proposing) {
      const before = windowFigures({ inForce: lines.inForce }, lines.usage, w);
      const ids = new Set([...figures.keys(), ...before.keys()]);
      for (const id of ids) {
        const after = figures.get(id);
        const was = before.get(id);
        const line = after?.line ?? was!.line;
        add(
          proforma,
          line,
          interestOf(
            (after?.cost ?? new Dec(0)).minus(was?.cost ?? new Dec(0)),
            w,
          ),
        );
      }
    }
  }
  return result;
}

// The lines a run counts with no usage assumed: their interest counts as
// zero.
export function linesWithoutUsage(
  lines: readonly LineTerms[],
  usage: LineUsage,
): LineTerms[] {
  return lines.filter(
    (l) =>
      !l.closed &&
      usage[l.id]?.share === undefined &&
      !Object.keys(usage[l.id]?.months ?? {}).length,
  );
}
