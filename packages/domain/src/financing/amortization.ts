import { Dec } from "@finance/engine";

// Monthly loan schedules, shared by the borrower's existing debt and the new
// loans a scenario adds. Dates are reduced to months: a payment falls in the
// month after the previous one, whatever the day.

type Amount = InstanceType<typeof Dec>;

export type Repayment = "blended" | "equal_principal" | "interest_only";

export const REPAYMENTS: Record<Repayment, string> = {
  blended: "Blended payments",
  equal_principal: "Equal principal",
  interest_only: "Interest only",
};

// "2025-09-30" → a count of months, so months compare and subtract.
export const monthIndex = (date: string) =>
  Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

export interface Amortizing {
  balance: string;
  // Annual rate, e.g. "0.065".
  rate: string;
  repayment: Repayment;
  // Months left to repay; unused for interest-only loans.
  months: number;
}

export interface Schedule {
  // Interest and principal paid in the months after `from`, up to and
  // including `to`.
  flows(from: number, to: number): { interest: Amount; principal: Amount };
  // What's owed at the end of a month.
  balanceAt(month: number): Amount;
}

interface Payment {
  interest: Amount;
  principal: Amount;
  // The balance after the payment.
  after: Amount;
}

const MAX_HISTORY = 120;

// The loan's monthly payments after `start`, the month its balance is known
// at. With `history`, the same payments run back before `start`, for periods
// that began earlier (an existing loan known at a date); without, nothing is
// owed before it (a new loan drawn that month).
export function amortize(
  loan: Amortizing,
  start: number,
  history = false,
): Schedule {
  const balance = new Dec(loan.balance);
  const rate = new Dec(loan.rate).div(12);
  const months = loan.repayment === "interest_only" ? Infinity : loan.months;
  const level =
    loan.repayment !== "blended"
      ? null
      : rate.isZero()
        ? balance.div(months)
        : balance.times(rate).div(new Dec(1).minus(rate.plus(1).pow(-months)));
  const step =
    loan.repayment === "equal_principal" ? balance.div(months) : null;

  // forward[k - 1] is the payment k months after start.
  const forward: Payment[] = [];
  const paymentAfter = (k: number): Payment | null => {
    if (k > months) return null;
    if (loan.repayment === "interest_only")
      return {
        interest: balance.times(rate),
        principal: new Dec(0),
        after: balance,
      };
    while (forward.length < k) {
      const owed = forward.at(-1)?.after ?? balance;
      const interest = owed.times(rate);
      const due = step ?? level!.minus(interest);
      const principal = Dec.min(due, owed);
      forward.push({ interest, principal, after: owed.minus(principal) });
    }
    return forward[k - 1]!;
  };

  // backward[j] is the payment made j months before start (j = 0 is the
  // start month's own payment, which left the known balance).
  const backward: Payment[] = [];
  const paymentBefore = (j: number): Payment | null => {
    if (!history || j >= MAX_HISTORY) return null;
    while (backward.length <= j) {
      const after = backward.at(-1)
        ? backward.at(-1)!.after.plus(backward.at(-1)!.principal)
        : balance;
      let owed: Amount;
      if (loan.repayment === "interest_only") owed = after;
      else if (step) owed = after.plus(step);
      else owed = after.plus(level!).div(rate.plus(1));
      const interest = owed.times(rate);
      backward.push({ interest, principal: owed.minus(after), after });
    }
    return backward[j]!;
  };

  return {
    flows(from, to) {
      let interest = new Dec(0);
      let principal = new Dec(0);
      for (let m = from + 1; m <= to; m++) {
        const payment =
          m > start ? paymentAfter(m - start) : paymentBefore(start - m);
        if (!payment) continue;
        interest = interest.plus(payment.interest);
        principal = principal.plus(payment.principal);
      }
      return { interest, principal };
    },
    balanceAt(month) {
      if (month >= start) {
        if (month === start || loan.repayment === "interest_only")
          return balance;
        return paymentAfter(Math.min(month - start, months))!.after;
      }
      if (!history) return new Dec(0);
      return paymentBefore(start - month)?.after ?? balance;
    },
  };
}
