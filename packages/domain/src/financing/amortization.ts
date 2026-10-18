import type { schema } from "@finance/db";
import { Dec } from "@finance/engine";

// Loan schedules, shared by the borrower's existing debt and the new loans a
// scenario adds. Dates are reduced to months: a payment falls one, three, six
// or twelve months after the previous one, whatever the day. Kept free of
// server code so the browser can draw a loan's schedule (subpath
// @finance/domain/amortization).

type Amount = InstanceType<typeof Dec>;

export type Repayment = "blended" | "equal_principal" | "interest_only";
export type Frequency = schema.PaymentFrequency;
export type Moratorium = schema.Moratorium;

export const REPAYMENTS: Record<Repayment, string> = {
  blended: "Blended payments",
  equal_principal: "Equal principal",
  interest_only: "Interest only",
};

export const FREQUENCIES: Record<Frequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannual: "Semi-annual",
  annual: "Annual",
};

// Months from one payment to the next.
export const PERIOD_MONTHS: Record<Frequency, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

export const MORATORIUMS: Record<Moratorium["kind"], string> = {
  principal: "On principal",
  full: "On principal and interest",
};

// "2025-09-30" → a count of months, so months compare and subtract.
export const monthIndex = (date: string) =>
  Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

// A count of months → "2025-09", the month it stands for.
export const monthOf = (index: number) =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

export interface Amortizing {
  balance: string;
  // Annual rate, e.g. "0.065".
  rate: string;
  repayment: Repayment;
  // Months left to repay, counting a moratorium the amortization includes;
  // unused for interest-only loans.
  months: number;
  // Monthly when absent.
  frequency?: Frequency;
  // Starting with the first payment.
  moratorium?: Moratorium;
}

export interface Payment {
  // The month it falls in.
  month: number;
  interest: Amount;
  principal: Amount;
  // Interest added to the balance instead of paid, in a moratorium on
  // principal and interest.
  capitalized: Amount;
  // The balance after the payment.
  after: Amount;
  // Whether it falls in the moratorium.
  moratorium: boolean;
}

export interface Schedule {
  // Interest and principal paid in the months after `from`, up to and
  // including `to`.
  flows(from: number, to: number): { interest: Amount; principal: Amount };
  // What's owed at the end of a month.
  balanceAt(month: number): Amount;
  // The payments after `start`: all of them, or for a loan that never
  // matures (interest only), those in the first `horizon` months.
  payments(horizon?: number): Payment[];
}

const MAX_HISTORY = 120;
const zero = new Dec(0);

// The loan's payments after `start`, the month its balance is known at. With
// `history`, the same payments run back before `start`, for periods that
// began earlier (an existing loan known at a date); without, nothing is owed
// before it (a new loan drawn that month). A moratorium comes first; when
// the amortization includes it, the principal is repaid over what's left.
export function amortize(
  loan: Amortizing,
  start: number,
  history = false,
): Schedule {
  const balance = new Dec(loan.balance);
  const every = PERIOD_MONTHS[loan.frequency ?? "monthly"];
  const rate = new Dec(loan.rate).times(every).div(12);
  const moratorium = loan.moratorium;
  const full = moratorium?.kind === "full";
  // Payments in the moratorium, then payments that repay principal.
  const held = moratorium ? Math.floor(moratorium.months / every) : 0;
  const repaying =
    loan.repayment === "interest_only"
      ? Infinity
      : Math.max(
          1,
          Math.floor(
            (loan.months - (moratorium?.included ? moratorium.months : 0)) /
              every,
          ),
        );
  const count = held + repaying;

  // The level payment or equal principal, set on the balance the
  // amortization starts from: the known one, or the one the moratorium
  // leaves.
  let level: Amount | null = null;
  let step: Amount | null = null;
  const settle = (owed: Amount) => {
    if (loan.repayment === "equal_principal") step = owed.div(repaying);
    if (loan.repayment === "blended")
      level = rate.isZero()
        ? owed.div(repaying)
        : owed.times(rate).div(new Dec(1).minus(rate.plus(1).pow(-repaying)));
  };
  if (!held) settle(balance);

  // forward[k - 1] is the k-th payment after start.
  const forward: Payment[] = [];
  const paymentAfter = (k: number): Payment | null => {
    if (k < 1 || k > count) return null;
    while (forward.length < k) {
      const n = forward.length + 1;
      const month = start + n * every;
      const owed = forward.at(-1)?.after ?? balance;
      const interest = owed.times(rate);
      if (n <= held) {
        forward.push(
          full
            ? {
                month,
                interest: zero,
                principal: zero,
                capitalized: interest,
                after: owed.plus(interest),
                moratorium: true,
              }
            : {
                month,
                interest,
                principal: zero,
                capitalized: zero,
                after: owed,
                moratorium: true,
              },
        );
        continue;
      }
      if (n === held + 1 && held) settle(owed);
      const principal =
        loan.repayment === "interest_only"
          ? zero
          : n === count
            ? owed
            : Dec.min(step ?? level!.minus(interest), owed);
      forward.push({
        month,
        interest,
        principal,
        capitalized: zero,
        after: owed.minus(principal),
        moratorium: false,
      });
    }
    return forward[k - 1]!;
  };

  // backward[j] is the payment j periods before start (j = 0 is the start
  // month's own payment, which left the known balance). A loan in a
  // moratorium at its date has been in it all along.
  const backward: Payment[] = [];
  const paymentBefore = (j: number): Payment | null => {
    if (!history || j * every >= MAX_HISTORY) return null;
    while (backward.length <= j) {
      const later = backward.at(-1);
      const after = later
        ? later.after.plus(later.principal).minus(later.capitalized)
        : balance;
      const month = start - backward.length * every;
      if (held && full) {
        const owed = after.div(rate.plus(1));
        backward.push({
          month,
          interest: zero,
          principal: zero,
          capitalized: after.minus(owed),
          after,
          moratorium: true,
        });
        continue;
      }
      const owed =
        held || loan.repayment === "interest_only"
          ? after
          : step
            ? after.plus(step)
            : after.plus(level!).div(rate.plus(1));
      backward.push({
        month,
        interest: owed.times(rate),
        principal: owed.minus(after),
        capitalized: zero,
        after,
        moratorium: held > 0,
      });
    }
    return backward[j]!;
  };

  return {
    flows(from, to) {
      let interest = zero;
      let principal = zero;
      for (let m = from + 1; m <= to; m++) {
        const offset = m - start;
        if (offset % every !== 0) continue;
        const payment =
          offset > 0
            ? paymentAfter(offset / every)
            : paymentBefore(-offset / every);
        if (!payment) continue;
        interest = interest.plus(payment.interest);
        principal = principal.plus(payment.principal);
      }
      return { interest, principal };
    },
    balanceAt(month) {
      if (month >= start) {
        const k = Math.min(Math.floor((month - start) / every), count);
        return k ? paymentAfter(k)!.after : balance;
      }
      if (!history) return zero;
      // After the last payment in or before the month.
      return (
        paymentBefore(Math.ceil((start - month) / every))?.after ?? balance
      );
    },
    payments(horizon = MAX_HISTORY) {
      const last = Number.isFinite(count) ? count : Math.floor(horizon / every);
      const list: Payment[] = [];
      for (let k = 1; k <= last; k++) list.push(paymentAfter(k)!);
      return list;
    },
  };
}
