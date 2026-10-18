import type { schema } from "@finance/db";
import { Dec } from "@finance/engine";
import { DomainError } from "../errors";
import { amortize, monthIndex } from "./amortization";
import {
  entryId,
  parseAmount,
  parseDate,
  parseAdjustments,
  parseRate,
  parseTerms,
  type FinancingPeriod,
  type FinancingValue,
  type LoanTermsInput,
} from "./common";

// The borrower's existing loans as of a date (§5.5): their actual future
// debt service, for projected years and post-project columns, instead of an
// estimate from the current portion of long-term debt.

export type DebtSchedule = schema.DebtSchedule;
export type ExistingLoan = DebtSchedule["loans"][number];

export const EMPTY_SCHEDULE: DebtSchedule = { asOf: null, loans: [] };

// Amortization (`years`) and any moratorium are what's left at the date.
export interface ExistingLoanInput extends LoanTermsInput {
  id?: unknown;
  name?: unknown;
  balance?: unknown;
  rate?: unknown;
  // Dated after the schedule's.
  adjustments?: unknown;
}

export function normalizeDebtSchedule(input: {
  asOf?: unknown;
  loans?: readonly ExistingLoanInput[];
}): DebtSchedule {
  const list = input.loans ?? [];
  if (!Array.isArray(list))
    throw new DomainError("invalid", "Loans must be a list.");
  if (!list.length) return EMPTY_SCHEDULE;
  const asOf = parseDate(input.asOf, "Debt schedule", "date it's as of");
  return {
    asOf,
    loans: list.map((loan, i) => {
      const name = String(loan.name ?? "").trim();
      const what = name || `Loan ${i + 1}`;
      if (!name)
        throw new DomainError("invalid", `${what}: give the loan a name.`);
      const terms = parseTerms(loan, what);
      const adjustments = parseAdjustments(
        loan.adjustments,
        what,
        terms.frequency ?? "monthly",
        asOf,
      );
      return {
        id: entryId(loan.id),
        name,
        balance: parseAmount(loan.balance, what, "balance", true),
        rate: parseRate(loan.rate, what),
        ...terms,
        ...(adjustments.length ? { adjustments } : {}),
      };
    }),
  };
}

export interface ScheduleValues {
  interest: (FinancingValue | null)[];
  principal: (FinancingValue | null)[];
  // Extra payments, apart from scheduled principal.
  prepayments: (FinancingValue | null)[];
  balance: (FinancingValue | null)[];
}

// The existing loans' interest, principal and balance in each period. In a
// projected period, what falls in it; the schedule runs back before its date
// on the same payments, for a year that began earlier. Actual periods are
// left blank. Pro forma periods show the twelve months after the project
// closes (scaled to the period's length) and the balance then: the debt
// service the borrower faces post-project. Loans the project consolidates
// (`repaid`) are paid off at closing: nothing after it.
export function debtScheduleValues(
  schedule: DebtSchedule,
  periods: readonly FinancingPeriod[],
  closing: number | null = null,
  repaid: ReadonlySet<string> = new Set(),
): ScheduleValues {
  const blank = periods.map(() => null);
  if (!schedule.asOf || !schedule.loans.length)
    return {
      interest: blank,
      principal: blank,
      prepayments: blank,
      balance: blank,
    };
  const { asOf } = schedule;
  const start = monthIndex(asOf);
  const loans = schedule.loans.map((loan) => ({
    loan,
    schedule: amortize(loan, asOf, true),
  }));
  const result: ScheduleValues = {
    interest: [],
    principal: [],
    prepayments: [],
    balance: [],
  };
  for (const period of periods) {
    let from: number;
    let to: number;
    let share = new Dec(1);
    let at: number;
    if (period.mode === "projected") {
      to = monthIndex(period.end);
      from = to - period.months;
      at = to;
    } else if (period.mode === "proForma") {
      from = Math.max(closing ?? start, start);
      to = from + 12;
      share = new Dec(period.months).div(12);
      at = from;
    } else {
      result.interest.push(null);
      result.principal.push(null);
      result.prepayments.push(null);
      result.balance.push(null);
      continue;
    }
    const cells = {
      interest: { value: new Dec(0), parts: [] as FinancingValue["parts"] },
      principal: { value: new Dec(0), parts: [] as FinancingValue["parts"] },
      prepayments: { value: new Dec(0), parts: [] as FinancingValue["parts"] },
      balance: { value: new Dec(0), parts: [] as FinancingValue["parts"] },
    };
    for (const { loan, schedule: s } of loans) {
      const end = closing !== null && repaid.has(loan.id) ? closing : Infinity;
      const flows = s.flows(from, Math.min(to, end));
      for (const [key, amount] of [
        ["interest", flows.interest.times(share)],
        ["principal", flows.principal.times(share)],
        ["prepayments", flows.extra.times(share)],
        ["balance", at >= end ? new Dec(0) : s.balanceAt(at)],
      ] as const) {
        cells[key].value = cells[key].value!.plus(amount);
        if (!amount.isZero())
          cells[key].parts.push({
            id: loan.id,
            name: loan.name,
            value: amount.toFixed(),
          });
      }
    }
    result.interest.push(cells.interest);
    result.principal.push(cells.principal);
    result.prepayments.push(cells.prepayments);
    result.balance.push(cells.balance);
  }
  return result;
}

// Each loan's debt service over the twelve months after the schedule's date.
export function nextYearDebtService(schedule: DebtSchedule) {
  const { asOf } = schedule;
  if (!asOf) return [];
  const start = monthIndex(asOf);
  return schedule.loans.map((loan) => {
    const { interest, principal } = amortize(loan, asOf, true).flows(
      start,
      start + 12,
    );
    return {
      id: loan.id,
      interest: interest.toFixed(),
      principal: principal.toFixed(),
    };
  });
}
