import type { schema } from "@finance/db";
import { Dec } from "@finance/engine";
import { DomainError } from "../errors";
import {
  amortize,
  monthIndex,
  REPAYMENTS,
  type Repayment,
} from "./amortization";
import {
  entryId,
  parseAmount,
  parseDate,
  parseMonths,
  parseRate,
  type FinancingValue,
} from "./common";

// The borrower's existing loans as of a date (§5.5): their actual future
// debt service, for projected years and post-project columns, instead of an
// estimate from the current portion of long-term debt.

export type DebtSchedule = schema.DebtSchedule;
export type ExistingLoan = DebtSchedule["loans"][number];

export const EMPTY_SCHEDULE: DebtSchedule = { asOf: null, loans: [] };

export interface ExistingLoanInput {
  id?: unknown;
  name?: unknown;
  balance?: unknown;
  rate?: unknown;
  repayment?: unknown;
  // Amortization left, in years.
  years?: unknown;
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
      const repayment = loan.repayment as Repayment;
      if (!Object.hasOwn(REPAYMENTS, String(repayment)))
        throw new DomainError("invalid", `${what}: choose how it's repaid.`);
      return {
        id: entryId(loan.id),
        name,
        balance: parseAmount(loan.balance, what, "balance", true),
        rate: parseRate(loan.rate, what),
        repayment,
        months:
          repayment === "interest_only" ? 0 : parseMonths(loan.years, what),
      };
    }),
  };
}

export interface SchedulePeriod {
  end: string;
  months: number;
  // Projected, by the client or from assumptions.
  projected: boolean;
}

export interface ScheduleValues {
  interest: (FinancingValue | null)[];
  principal: (FinancingValue | null)[];
  balance: (FinancingValue | null)[];
}

// The existing loans' interest, principal and balance in each period. In a
// projected period, what falls in it; the schedule runs back before its date
// on the same payments, for a year that began earlier. Actual periods are
// left blank, unless `proForma` gives the month a project closes: then they
// show the twelve months after it (scaled to the period's length) and the
// balance then, the debt service the borrower faces post-project.
export function debtScheduleValues(
  schedule: DebtSchedule,
  periods: readonly SchedulePeriod[],
  proForma: number | null = null,
): ScheduleValues {
  const blank = periods.map(() => null);
  if (!schedule.asOf || !schedule.loans.length)
    return { interest: blank, principal: blank, balance: blank };
  const start = monthIndex(schedule.asOf);
  const loans = schedule.loans.map((loan) => ({
    loan,
    schedule: amortize(loan, start, true),
  }));
  const result: ScheduleValues = {
    interest: [],
    principal: [],
    balance: [],
  };
  for (const period of periods) {
    let from: number;
    let to: number;
    let share = new Dec(1);
    let at: number;
    if (period.projected) {
      to = monthIndex(period.end);
      from = to - period.months;
      at = to;
    } else if (proForma !== null) {
      from = Math.max(proForma, start);
      to = from + 12;
      share = new Dec(period.months).div(12);
      at = from;
    } else {
      result.interest.push(null);
      result.principal.push(null);
      result.balance.push(null);
      continue;
    }
    const cells = {
      interest: { value: new Dec(0), parts: [] as FinancingValue["parts"] },
      principal: { value: new Dec(0), parts: [] as FinancingValue["parts"] },
      balance: { value: new Dec(0), parts: [] as FinancingValue["parts"] },
    };
    for (const { loan, schedule: s } of loans) {
      const flows = s.flows(from, to);
      for (const [key, amount] of [
        ["interest", flows.interest.times(share)],
        ["principal", flows.principal.times(share)],
        ["balance", s.balanceAt(at)],
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
    result.balance.push(cells.balance);
  }
  return result;
}

// Each loan's debt service over the twelve months after the schedule's date.
export function nextYearDebtService(schedule: DebtSchedule) {
  if (!schedule.asOf) return [];
  const start = monthIndex(schedule.asOf);
  return schedule.loans.map((loan) => {
    const { interest, principal } = amortize(loan, start, true).flows(
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
