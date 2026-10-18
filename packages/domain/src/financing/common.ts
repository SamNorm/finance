import { randomUUID } from "node:crypto";
import { Dec } from "@finance/engine";
import { DomainError } from "../errors";
import { parseValue } from "../spreads/values";
import {
  FREQUENCIES,
  MORATORIUMS,
  paymentCount,
  PAYMENTS_PER_YEAR,
  PERIOD_UNITS,
  REPAYMENTS,
  type Amortizing,
  type Frequency,
  type Moratorium,
  type Repayment,
} from "./amortization";

// Reading financing as typed, and the shape of the values formulas read.

export type Amount = InstanceType<typeof Dec>;

// One loan's, facility's or adjustment's share of a built-in input.
export interface FinancingPart {
  id: string;
  name: string;
  value: string;
}

// A built-in input in one period; null where it doesn't apply, so formulas
// can fall back with ISBLANK.
export interface FinancingValue {
  value: Amount | null;
  parts: FinancingPart[];
}

export const MAX_YEARS = 50;

// Keeps a client's id for an entry, or makes one.
export const entryId = (id: unknown) =>
  typeof id === "string" && /^[\w-]{1,64}$/.test(id) ? id : randomUUID();

const invalid = (message: string) => new DomainError("invalid", message);

export function parseAmount(
  raw: unknown,
  what: string,
  field: string,
  required = false,
): string {
  const parsed = parseValue(String(raw ?? ""), "amount");
  if ("error" in parsed) throw invalid(`${what}: ${parsed.error}`);
  if (parsed.value === null) {
    if (required) throw invalid(`${what}: enter the ${field}.`);
    return "0";
  }
  const value = new Dec(parsed.value);
  if (value.isNegative() || (required && value.isZero()))
    throw invalid(`${what}: the ${field} must be positive.`);
  return value.toFixed();
}

// "6.5%", "6.5" and "0.065" all mean 6.5%: a rate typed without a percent
// sign and at least 1 is read as a percentage.
export function parseRate(raw: unknown, what: string, field = "rate"): string {
  const text = String(raw ?? "").trim();
  const parsed = parseValue(text, "percent");
  if ("error" in parsed) throw invalid(`${what}: ${parsed.error}`);
  if (parsed.value === null) throw invalid(`${what}: enter the ${field}.`);
  let value = new Dec(parsed.value);
  if (!text.endsWith("%") && value.gte(1)) value = value.div(100);
  if (value.isNegative() || value.gt(1))
    throw invalid(`${what}: the ${field} must be between 0% and 100%.`);
  return value.toFixed();
}

// Years of amortization, decimals allowed ("7.5"), as whole months.
export function parseMonths(raw: unknown, what: string): number {
  const years = Number(String(raw ?? "").trim());
  const months = Math.round(years * 12);
  if (!Number.isFinite(years) || months < 1 || years > MAX_YEARS)
    throw invalid(`${what}: amortize over 1 month to ${MAX_YEARS} years.`);
  return months;
}

// A loan's terms as typed: how it's repaid, over how long, how often, and any
// moratorium at the start of its schedule. Amortization is typed in years
// and paid to the nearest payment; a saved loan, copied, has months and its
// moratorium as an object.
export interface LoanTermsInput {
  repayment?: unknown;
  years?: unknown;
  months?: unknown;
  frequency?: unknown;
  // "principal", "full", or blank for none.
  moratorium?: unknown;
  // How many of the loan's payments the moratorium suspends, and whether the
  // amortization includes them.
  moratoriumPayments?: unknown;
  moratoriumIncluded?: unknown;
}

// A moratorium suspends up to ten years of payments.
export const MAX_MORATORIUM_YEARS = 10;

export function parseTerms(
  raw: LoanTermsInput,
  what: string,
): Pick<Amortizing, "repayment" | "months" | "frequency" | "moratorium"> {
  const repayment = raw.repayment as Repayment;
  if (!Object.hasOwn(REPAYMENTS, String(repayment)))
    throw invalid(`${what}: choose how it's repaid.`);
  const frequency = (String(raw.frequency ?? "") || "monthly") as Frequency;
  if (!Object.hasOwn(FREQUENCIES, frequency))
    throw invalid(`${what}: choose how often it's paid.`);
  if (repayment === "interest_only") return { repayment, months: 0, frequency };

  const months = parseMonths(
    raw.years ?? (typeof raw.months === "number" ? raw.months / 12 : ""),
    what,
  );
  const saved =
    raw.moratorium && typeof raw.moratorium === "object"
      ? (raw.moratorium as Record<string, unknown>)
      : null;
  const kind = String((saved ? saved.kind : raw.moratorium) ?? "");
  if (!kind) return { repayment, months, frequency };
  if (!Object.hasOwn(MORATORIUMS, kind))
    throw invalid(`${what}: "${kind}" isn't a kind of moratorium.`);
  const payments = Number(
    String((saved ? saved.payments : raw.moratoriumPayments) ?? "").trim(),
  );
  const most = MAX_MORATORIUM_YEARS * PAYMENTS_PER_YEAR[frequency];
  if (!Number.isInteger(payments) || payments < 1 || payments > most)
    throw invalid(
      `${what}: the moratorium lasts 1 to ${most} ${PERIOD_UNITS[frequency][1]}.`,
    );
  const flag = saved ? saved.included : raw.moratoriumIncluded;
  const included = flag === true || flag === "true";
  if (included && payments >= paymentCount(months, frequency))
    throw invalid(
      `${what}: the moratorium must end before the amortization does.`,
    );
  return {
    repayment,
    months,
    frequency,
    moratorium: { kind: kind as Moratorium["kind"], payments, included },
  };
}

export function parseDate(raw: unknown, what: string, field: string): string {
  const text = String(raw ?? "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(text) : null;
  if (
    !date ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== text
  )
    throw invalid(`${what}: enter the ${field} as a date.`);
  return text;
}

// How a period reads financing. "actual": the statements alone. "proForma":
// an actual period with the project as if closed then. "projected": a
// projected year, on the loans' schedules.
export type PeriodMode = "actual" | "proForma" | "projected";

export interface FinancingPeriod {
  end: string;
  months: number;
  mode: PeriodMode;
}

// The modes of a run's periods. Post-project, the last actual fiscal year and
// any actual period after it (a year-to-date) are pro forma; earlier years
// stay as they were, so comparisons with them read history.
export function periodModes(
  periods: readonly { months: number; projected: boolean }[],
  postProject: boolean,
): PeriodMode[] {
  const actual = periods.flatMap((p, i) => (p.projected ? [] : [i]));
  const lastYear =
    actual.findLast((i) => periods[i]!.months === 12) ?? actual.at(-1) ?? 0;
  return periods.map((p, i) =>
    p.projected
      ? "projected"
      : postProject && i >= lastYear
        ? "proForma"
        : "actual",
  );
}
