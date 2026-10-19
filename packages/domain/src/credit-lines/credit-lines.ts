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
import { parseValue } from "../spreads/values";
import { checkDefinition } from "../borrowing-bases/compile";
import {
  definitionAsTyped,
  normalizeDefinition,
  type BorrowingBaseDefinition,
  type BorrowingBaseDefinitionInput,
} from "../borrowing-bases/definition";
import {
  parseMonth,
  parseTerm,
  rateAsTyped,
  termAsTyped,
  termIn,
  type Term,
} from "./terms";

// A borrower's lines of credit (borrowing-base-plan.md §4), and their
// interest in analyses: each month, the usage assumed (a share of that
// month's limit, or an amount drawn) at the line's rate. A scenario can
// propose the deal's lines: a new limit or rate, a new line, a line closed.
// A line in another currency than the analysis's is converted at the rate
// the analysis assumes for it.

export type CreditLine = typeof schema.creditLines.$inferSelect;
export type LineUsage = schema.LineUsage;
export type ExchangeRates = schema.ExchangeRates;
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
  // Days after a month end its borrowing base certificate is due; blank or
  // null for none.
  certificateDueDays?: unknown;
}

export interface ProposedLineInput extends CreditLineInput {
  id?: unknown;
  closed?: unknown;
  // Its borrowing base's terms as the deal changes them, by line code:
  // { AR: { rate: "80%" }, INVENTORY: { cap: "1,500,000" } }; a null cap
  // removes it.
  terms?: unknown;
  // A new margined line's borrowing base definition, as typed.
  borrowingBase?: unknown;
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
): Pick<
  CreditLine,
  "name" | "currency" | "limit" | "rate" | "closedOn" | "certificateDueDays"
> {
  const name = parseName(input.name, fallback);
  const closed = String(input.closedOn ?? "").trim();
  const due = String(input.certificateDueDays ?? "").trim();
  const days = due ? Number(due) : null;
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 120))
    throw invalid(
      `${name}: a certificate is due 0 to 120 days after the month's end.`,
    );
  return {
    name,
    currency: parseCurrency(input.currency, name),
    limit: parseTerm(input.limit, `${name}, limit`, "amount"),
    rate: parseRate(input.rate, name),
    closedOn: closed ? parseDate(closed, name, "date it was closed") : null,
    certificateDueDays: days,
  };
}

// Stored proposed lines and usage written back as typed, so saving them
// again (copying a scenario, filling usage) reads their rates the same.
export const proposedLinesAsTyped = (
  lines: readonly ProposedLine[],
): ProposedLineInput[] =>
  lines.map((line) => ({
    ...line,
    rate: rateAsTyped(line.rate),
    ...(line.terms
      ? {
          terms: Object.fromEntries(
            Object.entries(line.terms).map(([code, t]) => [
              code,
              {
                ...t,
                ...(t.rate ? { rate: termAsTyped(t.rate, "rate") } : {}),
              },
            ]),
          ),
        }
      : {}),
    ...(line.borrowingBase
      ? { borrowingBase: definitionAsTyped(line.borrowingBase) }
      : {}),
  }));

export const lineUsageAsTyped = (usage: LineUsage) =>
  Object.fromEntries(
    Object.entries(usage).map(([id, u]) => [
      id,
      {
        ...u,
        ...(u.share !== undefined ? { share: rateAsTyped(u.share) } : {}),
      },
    ]),
  );

// A proposed line's id: one of the lines in force's, which for a
// consolidated client's members read "member/line", or a new line's.
const lineId = (raw: unknown) =>
  typeof raw === "string" && /^[\w-]{1,64}(\/[\w-]{1,64})?$/.test(raw)
    ? raw
    : entryId(undefined);

// A deal's borrowing base terms as typed, by line code: advance rates, caps
// (null removes one) and reserves' amounts. Which lines have which terms is
// checked against the line's definition (see checkProposedTerms).
function proposedTerms(raw: unknown, name: string) {
  const result: NonNullable<ProposedLine["terms"]> = {};
  if (raw === undefined || raw === null) return result;
  if (typeof raw !== "object" || Array.isArray(raw))
    throw invalid(`${name}: give the borrowing base's terms by line code.`);
  for (const [rawCode, given] of Object.entries(raw)) {
    const code = rawCode.toUpperCase();
    if (!given || typeof given !== "object")
      throw invalid(`${name}, ${code}: give its rate, cap or amount.`);
    const { rate, cap, amount } = given as Record<string, unknown>;
    const what = `${name}, ${code}`;
    const term: NonNullable<ProposedLine["terms"]>[string] = {};
    if (rate !== undefined)
      term.rate = parseTerm(rate, `${what}, advance rate`, "rate");
    if (cap === null) term.cap = null;
    else if (cap !== undefined)
      term.cap = parseTerm(cap, `${what}, cap`, "amount");
    if (amount !== undefined)
      term.amount = parseTerm(amount, `${what}, amount`, "amount");
    if (Object.keys(term).length) result[code] = term;
  }
  return result;
}

// Whether a deal's terms fit the line's borrowing base: advance rates and
// caps on collateral, caps on groups, amounts on reserves set as terms.
export function checkProposedTerms(
  terms: ProposedLine["terms"],
  definition: BorrowingBaseDefinition | null,
  name: string,
) {
  for (const [code, term] of Object.entries(terms ?? {})) {
    const line = definition?.lines.find((l) => l.code === code);
    const allowed =
      line?.kind === "collateral"
        ? ["rate", "cap"]
        : line?.kind === "group"
          ? ["cap"]
          : line?.kind === "reserve" && line.amount
            ? ["amount"]
            : [];
    const given = Object.keys(term);
    if (!line)
      throw invalid(
        definition
          ? `${name}: its borrowing base has no line ${code}.`
          : `${name} isn't margined: it has no borrowing base terms to change.`,
      );
    if (given.some((g) => !allowed.includes(g)))
      throw invalid(
        allowed.length
          ? `${name}, ${line.label}: its terms are ${allowed.join(" and ")}.`
          : `${name}, ${line.label}: it has no terms to change.`,
      );
  }
}

// Checks and makes canonical the lines a scenario proposes. A line keeps its
// id: one of the lines in force's, or a new line's.
export function normalizeProposedLines(input: unknown): ProposedLine[] {
  if (!Array.isArray(input) || input.length > MAX_LINES)
    throw invalid(`Proposed lines are a list of up to ${MAX_LINES}.`);
  const lines = input.map((raw: ProposedLineInput | null, i) => {
    const line = normalizeCreditLine(raw ?? {}, `Line ${i + 1}`);
    const terms = proposedTerms(raw?.terms, line.name);
    let borrowingBase: ProposedLine["borrowingBase"];
    if (raw?.borrowingBase) {
      const read = normalizeDefinition(
        raw.borrowingBase as BorrowingBaseDefinitionInput,
        line.currency,
      );
      const errors = [
        ...read.issues,
        ...checkDefinition(read.definition, line),
      ].filter((issue) => issue.severity === "error");
      if (errors.length)
        throw new DomainError(
          "invalid",
          `${line.name}: ${errors[0]!.message}`,
          errors,
        );
      borrowingBase = read.definition;
    }
    return {
      id: lineId(raw?.id),
      name: line.name,
      currency: line.currency,
      limit: line.limit,
      rate: line.rate,
      ...(raw?.closed === true ? { closed: true } : {}),
      ...(Object.keys(terms).length ? { terms } : {}),
      ...(borrowingBase ? { borrowingBase } : {}),
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

// Checks and makes canonical exchange rates as typed, by currency code:
// { USD: "1.37" }. Blank or null rates are dropped.
export function normalizeExchangeRates(input: unknown): ExchangeRates {
  if (input === null || input === undefined) return {};
  if (typeof input !== "object" || Array.isArray(input))
    throw invalid('Exchange rates are given by currency: { USD: "1.37" }.');
  const result: ExchangeRates = {};
  for (const [code, raw] of Object.entries(input as Record<string, unknown>)) {
    const currency = parseCurrency(code, "Exchange rate");
    const parsed = parseValue(String(raw ?? ""), "amount");
    if ("error" in parsed) throw invalid(`${currency} rate: ${parsed.error}`);
    if (parsed.value === null) continue;
    if (!new Dec(parsed.value).gt(0))
      throw invalid(`${currency} rate: give a rate above zero.`);
    result[currency] = parsed.value;
  }
  return result;
}

// The lines a run reads: those in force, and those the scenario proposes,
// from the month after `proposedAfter`; and what converts those in another
// currency than the run's.
export interface RunLines {
  inForce: readonly LineTerms[];
  proposed?: readonly ProposedLine[] | null;
  proposedAfter?: number | null;
  usage: LineUsage;
  // The run's currency; without one, lines count as they are.
  currency?: string | null;
  rates?: ExchangeRates;
}

// The rate converting a line's amounts into the run's currency: none when
// it's in it, or null when its currency has no rate, so it counts nothing.
type Conversion = { rate: Amount } | null;
function conversionOf(
  line: LineTerms,
  lines: Pick<RunLines, "currency" | "rates">,
): Conversion | undefined {
  if (!lines.currency || line.currency === lines.currency) return undefined;
  const rate = lines.rates?.[line.currency];
  return rate === undefined ? null : { rate: new Dec(rate) };
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
// Adds a line's amount, in its own currency, converted into the run's.
function add(
  target: FinancingValue,
  line: LineTerms,
  amount: Amount,
  conversion: Conversion | undefined,
) {
  if (conversion === null) return;
  const value = conversion ? amount.times(conversion.rate) : amount;
  target.value = target.value!.plus(value);
  if (!amount.isZero())
    target.parts.push({
      id: line.id,
      name: line.name,
      value: value.toFixed(),
      ...(conversion
        ? {
            converted: {
              currency: line.currency,
              amount: amount.toFixed(),
              rate: conversion.rate.toFixed(),
            },
          }
        : {}),
    });
}

// The lines' built-in inputs in each period of a run: interest, the limit at
// the period's end and the average drawn, each with a part per line, in the
// run's currency; blank in actual periods, and everywhere when there are no
// lines. In a post-project run (`closing` given), PROFORMA_LINE_INTEREST is
// what the proposed lines add to the interest of those in force.
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
      const conversion = conversionOf(line, lines);
      add(interest, line, interestOf(cost, w), conversion);
      add(average, line, usage.div(months), conversion);
    }
    const authorized = cell();
    for (const line of linesIn(lines, w.at))
      add(
        authorized,
        line,
        new Dec(termIn(line.limit, w.at).value),
        conversionOf(line, lines),
      );
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
        if (!after || !was || after.line.currency === was.line.currency) {
          add(
            proforma,
            line,
            interestOf(
              (after?.cost ?? new Dec(0)).minus(was?.cost ?? new Dec(0)),
              w,
            ),
            conversionOf(line, lines),
          );
          continue;
        }
        // The deal moves the line to another currency: each side converts
        // at its own rate.
        const converted = (side: typeof after) => {
          const conversion = conversionOf(side.line, lines);
          const amount = interestOf(side.cost, w);
          return conversion === null
            ? new Dec(0)
            : conversion
              ? amount.times(conversion.rate)
              : amount;
        };
        add(proforma, line, converted(after).minus(converted(was)), undefined);
      }
    }
  }
  return result;
}

// The lines a run counts in another currency with no rate to convert them:
// they count as nothing.
export function linesWithoutRate(
  lines: readonly LineTerms[],
  currency: string,
  rates: ExchangeRates,
): LineTerms[] {
  return lines.filter(
    (l) => !l.closed && l.currency !== currency && rates[l.currency] === undefined,
  );
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
