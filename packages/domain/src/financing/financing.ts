import { randomUUID } from "node:crypto";
import type { schema } from "@finance/db";
import { Dec } from "@finance/engine";
import { DomainError } from "../errors";
import { parseValue } from "../spreads/values";

// Post-project financing (§5.5): new loans and debt subordinated to equity,
// added by a scenario from a fiscal year on. Their effect reaches formulas
// through built-in inputs, so a model decides where each one goes: funded
// debt, debt service, tangible net worth.

export type FinancingAdjustment = schema.FinancingAdjustment;
export type Loan = Extract<FinancingAdjustment, { kind: "loan" }>;
export type Subordination = Extract<
  FinancingAdjustment,
  { kind: "subordination" }
>;
export type Repayment = Loan["repayment"];

type Amount = InstanceType<typeof Dec>;

// The built-in inputs every formula can read. They are zero without
// financing, so a model can add them unconditionally.
export const FINANCING_INPUTS = [
  {
    code: "PROFORMA_DEBT",
    label: "New debt outstanding",
    description: "New loans outstanding at the period end.",
  },
  {
    code: "PROFORMA_DEBT_CURRENT",
    label: "Current portion of new debt",
    description: "Principal on new loans due in the following year.",
  },
  {
    code: "PROFORMA_PROCEEDS",
    label: "New debt drawn",
    description:
      "Loans drawn in the period: the full amount in their first year.",
  },
  {
    code: "PROFORMA_INTEREST",
    label: "Post-project interest",
    description:
      "Interest on new loans, less interest no longer paid on subordinated debt.",
  },
  {
    code: "PROFORMA_PRINCIPAL",
    label: "Post-project principal",
    description:
      "Scheduled principal on new loans, less principal no longer paid on subordinated debt.",
  },
  {
    code: "PROFORMA_TO_EQUITY",
    label: "Debt subordinated to equity",
    description:
      "Debt postponed in favour of the lender and treated as equity, from its year on.",
  },
] as const;

export type FinancingCode = (typeof FINANCING_INPUTS)[number]["code"];
export const FINANCING_CODES: readonly string[] = FINANCING_INPUTS.map(
  (input) => input.code,
);

export const REPAYMENTS: Record<Repayment, string> = {
  blended: "Blended payments",
  equal_principal: "Equal principal",
  interest_only: "Interest only",
};

const MAX_YEARS = 50;

// An adjustment as typed in a form: every field as text.
export type AdjustmentInput = {
  kind: string;
  id?: string;
  name?: string;
  amount?: string;
  rate?: string;
  years?: string | number;
  repayment?: string;
  fromYear?: string | number;
  interestSaved?: string;
  principalSaved?: string;
};

// Checks and makes canonical the adjustments of a scenario, in order.
export function normalizeAdjustments(
  list: readonly AdjustmentInput[],
): FinancingAdjustment[] {
  return list.map((input, i) => {
    const name = String(input.name ?? "").trim();
    const what = name || `Adjustment ${i + 1}`;
    if (!name)
      throw new DomainError("invalid", `${what}: give the adjustment a name.`);
    const id =
      input.id && /^[\w-]{1,64}$/.test(input.id) ? input.id : randomUUID();
    const fromYear = Number(input.fromYear);
    if (!Number.isInteger(fromYear) || fromYear < 1900 || fromYear > 2200)
      throw new DomainError(
        "invalid",
        `${what}: choose the year it applies from.`,
      );
    const amount = money(input.amount, what, "amount", true);
    if (input.kind === "loan") {
      const repayment = input.repayment as Repayment;
      if (!Object.hasOwn(REPAYMENTS, repayment ?? ""))
        throw new DomainError("invalid", `${what}: choose how it's repaid.`);
      const years = Number(input.years);
      if (
        repayment !== "interest_only" &&
        (!Number.isInteger(years) || years < 1 || years > MAX_YEARS)
      ) {
        throw new DomainError(
          "invalid",
          `${what}: amortize over 1 to ${MAX_YEARS} years.`,
        );
      }
      return {
        kind: "loan",
        id,
        name,
        amount,
        rate: rate(input.rate, what),
        years: repayment === "interest_only" ? 0 : years,
        repayment,
        fromYear,
      };
    }
    if (input.kind === "subordination") {
      return {
        kind: "subordination",
        id,
        name,
        amount,
        interestSaved: money(input.interestSaved, what, "interest saved"),
        principalSaved: money(input.principalSaved, what, "principal saved"),
        fromYear,
      };
    }
    throw new DomainError(
      "invalid",
      `"${input.kind}" isn't a kind of financing.`,
    );
  });
}

function money(
  raw: string | undefined,
  what: string,
  field: string,
  required = false,
): string {
  const parsed = parseValue(String(raw ?? ""), "amount");
  if ("error" in parsed)
    throw new DomainError("invalid", `${what}: ${parsed.error}`);
  if (parsed.value === null) {
    if (required)
      throw new DomainError("invalid", `${what}: enter the ${field}.`);
    return "0";
  }
  const value = new Dec(parsed.value);
  if (value.isNegative() || (required && value.isZero()))
    throw new DomainError("invalid", `${what}: the ${field} must be positive.`);
  return value.toFixed();
}

// "6.5%", "6.5" and "0.065" all mean 6.5%: a rate typed without a percent
// sign and at least 1 is read as a percentage.
function rate(raw: string | undefined, what: string): string {
  const text = String(raw ?? "").trim();
  const parsed = parseValue(text, "percent");
  if ("error" in parsed)
    throw new DomainError("invalid", `${what}: ${parsed.error}`);
  if (parsed.value === null)
    throw new DomainError("invalid", `${what}: enter the interest rate.`);
  let value = new Dec(parsed.value);
  if (!text.endsWith("%") && value.gte(1)) value = value.div(100);
  if (value.isNegative() || value.gte(1))
    throw new DomainError(
      "invalid",
      `${what}: the rate must be between 0% and 100%.`,
    );
  return value.toFixed();
}

// One adjustment's share of a built-in input in a period.
export interface FinancingPart {
  id: string;
  name: string;
  value: string;
}

export interface FinancingValue {
  value: Amount;
  parts: FinancingPart[];
}

interface LoanYear {
  interest: Amount;
  principal: Amount;
  balance: Amount;
}

// A loan's years from its first, with monthly payments: blended payments of
// principal and interest, equal monthly principal, or interest only. Drawn at
// the start of its first year.
export function loanSchedule(loan: Loan, years: number): LoanYear[] {
  const monthly = new Dec(loan.rate).div(12);
  const months = loan.years * 12;
  const amount = new Dec(loan.amount);
  const payment =
    loan.repayment !== "blended"
      ? null
      : monthly.isZero()
        ? amount.div(months)
        : amount
            .times(monthly)
            .div(new Dec(1).minus(monthly.plus(1).pow(-months)));
  const schedule: LoanYear[] = [];
  let balance = amount;
  for (let y = 0; y < years; y++) {
    let interest = new Dec(0);
    let principal = new Dec(0);
    for (let m = 0; m < 12; m++) {
      const owed = balance.times(monthly);
      const due =
        loan.repayment === "interest_only"
          ? new Dec(0)
          : loan.repayment === "equal_principal"
            ? amount.div(months)
            : payment!.minus(owed);
      const paid = Dec.min(due, balance);
      interest = interest.plus(owed);
      principal = principal.plus(paid);
      balance = balance.minus(paid);
    }
    schedule.push({ interest, principal, balance });
  }
  return schedule;
}

// Each built-in input in each period. Flows scale with the months a period
// covers; balances are as of the period's year end.
export function financingValues(
  adjustments: readonly FinancingAdjustment[],
  periods: readonly { end: string; months: number }[],
): Record<FinancingCode, FinancingValue[]> {
  const result = Object.fromEntries(
    FINANCING_CODES.map((code) => [
      code,
      periods.map(() => ({ value: new Dec(0), parts: [] as FinancingPart[] })),
    ]),
  ) as Record<FinancingCode, FinancingValue[]>;
  const add = (
    code: FinancingCode,
    p: number,
    adjustment: FinancingAdjustment,
    value: Amount,
  ) => {
    if (value.isZero()) return;
    const cell = result[code][p]!;
    cell.value = cell.value.plus(value);
    cell.parts.push({
      id: adjustment.id,
      name: adjustment.name,
      value: value.toFixed(),
    });
  };

  const lastYear = Math.max(
    0,
    ...periods.map((p) => Number(p.end.slice(0, 4))),
  );
  for (const adjustment of adjustments) {
    const schedule =
      adjustment.kind === "loan"
        ? loanSchedule(adjustment, lastYear - adjustment.fromYear + 2)
        : [];
    periods.forEach((period, p) => {
      const k = Number(period.end.slice(0, 4)) - adjustment.fromYear;
      if (k < 0) return;
      const share = new Dec(period.months).div(12);
      if (adjustment.kind === "loan") {
        const year = schedule[k]!;
        add("PROFORMA_DEBT", p, adjustment, year.balance);
        add("PROFORMA_DEBT_CURRENT", p, adjustment, schedule[k + 1]!.principal);
        if (k === 0)
          add("PROFORMA_PROCEEDS", p, adjustment, new Dec(adjustment.amount));
        add("PROFORMA_INTEREST", p, adjustment, year.interest.times(share));
        add("PROFORMA_PRINCIPAL", p, adjustment, year.principal.times(share));
      } else {
        add("PROFORMA_TO_EQUITY", p, adjustment, new Dec(adjustment.amount));
        add(
          "PROFORMA_INTEREST",
          p,
          adjustment,
          new Dec(adjustment.interestSaved).times(share).neg(),
        );
        add(
          "PROFORMA_PRINCIPAL",
          p,
          adjustment,
          new Dec(adjustment.principalSaved).times(share).neg(),
        );
      }
    });
  }
  return result;
}
