import type { schema } from "@finance/db";
import { Dec } from "@finance/engine";

// Loan schedules, shared by the borrower's existing debt and the new loans a
// scenario adds. Periods read a schedule by months: the k-th payment counts
// 12k/n months after the start's month, rounded up, for n payments a year. So
// any twelve months hold a year's payments, 52 of them weekly, even though a
// calendar year can hold 53 weeks; after some years a weekly payment's date
// can fall a few days off the month it counts in. Kept free of server code
// so the browser can draw a loan's schedule (@finance/domain/amortization).

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
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  semimonthly: "Twice a month",
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannual: "Semi-annual",
  annual: "Annual",
};

export const PAYMENTS_PER_YEAR: Record<Frequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
};

// The period between two payments, singular and plural: what a moratorium is
// counted in.
export const PERIOD_UNITS: Record<Frequency, [string, string]> = {
  weekly: ["week", "weeks"],
  biweekly: ["two-week period", "two-week periods"],
  semimonthly: ["half-month", "half-months"],
  monthly: ["month", "months"],
  quarterly: ["quarter", "quarters"],
  semiannual: ["half-year", "half-years"],
  annual: ["year", "years"],
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

// How many payments repay a loan over `months` at a frequency, to the
// nearest payment: 20 years is 1,040 weekly payments.
export const paymentCount = (months: number, frequency: Frequency) =>
  Math.max(1, Math.round((months * PAYMENTS_PER_YEAR[frequency]) / 12));

const DAY = 86_400_000;
const lastDay = (month: number) =>
  new Date(Date.UTC(Math.floor(month / 12), (month % 12) + 1, 0)).getUTCDate();
const dateIn = (month: number, day: number) =>
  `${monthOf(month)}-${String(day).padStart(2, "0")}`;

// The date of the k-th payment after a schedule's start; k = 0 is a payment on
// the start date, and k < 0 those before it. Weekly payments fall every seven
// days from the start. Twice a month: the 15th and the last day, from the
// month after the start's. Otherwise every one, three, six or twelve months,
// on the start's day of the month (the month's last day when the start is on
// its month's last day).
export function paymentDate(
  start: string,
  frequency: Frequency,
  k: number,
): string {
  if (frequency === "weekly" || frequency === "biweekly") {
    const days = frequency === "weekly" ? 7 : 14;
    const time = Date.parse(`${start}T00:00:00Z`) + k * days * DAY;
    return new Date(time).toISOString().slice(0, 10);
  }
  const from = monthIndex(start);
  if (frequency === "semimonthly") {
    const month = from + Math.ceil(k / 2);
    return dateIn(month, k % 2 === 0 ? lastDay(month) : 15);
  }
  const month = from + k * (12 / PAYMENTS_PER_YEAR[frequency]);
  const day = Number(start.slice(8, 10));
  return dateIn(
    month,
    day >= lastDay(from) ? lastDay(month) : Math.min(day, lastDay(month)),
  );
}

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
  date: string;
  // The month it counts in.
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
  // The payments after the start: all of them, or for a loan that never
  // matures (interest only), those in the `horizon` months after its month.
  payments(horizon?: number): Payment[];
}

const MAX_HISTORY = 120;
const zero = new Dec(0);

// The loan's payments after `start`, the date its balance is known at. With
// `history`, the same payments run back before it, for periods that began
// earlier (an existing loan known at a date); without, nothing is owed before
// it (a new loan drawn that day). A moratorium comes first; when the
// amortization includes it, the principal is repaid over what's left.
export function amortize(
  loan: Amortizing,
  start: string,
  history = false,
): Schedule {
  const balance = new Dec(loan.balance);
  const frequency = loan.frequency ?? "monthly";
  const perYear = PAYMENTS_PER_YEAR[frequency];
  const rate = new Dec(loan.rate).div(perYear);
  const startMonth = monthIndex(start);
  const moratorium = loan.moratorium;
  const full = moratorium?.kind === "full";
  // Payments in the moratorium, then payments that repay principal.
  const held = moratorium?.payments ?? 0;
  const repaying =
    loan.repayment === "interest_only"
      ? Infinity
      : Math.max(
          1,
          paymentCount(loan.months, frequency) -
            (moratorium?.included ? held : 0),
        );
  const count = held + repaying;
  const when = (k: number) => ({
    date: paymentDate(start, frequency, k),
    month: startMonth + Math.ceil((12 * k) / perYear),
  });

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
      const owed = forward.at(-1)?.after ?? balance;
      const interest = owed.times(rate);
      if (n <= held) {
        forward.push(
          full
            ? {
                ...when(n),
                interest: zero,
                principal: zero,
                capitalized: interest,
                after: owed.plus(interest),
                moratorium: true,
              }
            : {
                ...when(n),
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
        ...when(n),
        interest,
        principal,
        capitalized: zero,
        after: owed.minus(principal),
        moratorium: false,
      });
    }
    return forward[k - 1]!;
  };

  // backward[j] is the payment j periods before start (j = 0 is a payment on
  // the start date, which left the known balance), back ten years. A loan in
  // a moratorium at its date has been in it all along.
  const backward: Payment[] = [];
  const paymentBefore = (j: number): Payment | null => {
    if (!history) return null;
    while (backward.length <= j) {
      const at = when(-backward.length);
      if (startMonth - at.month >= MAX_HISTORY) return null;
      const later = backward.at(-1);
      const after = later
        ? later.after.plus(later.principal).minus(later.capitalized)
        : balance;
      if (held && full) {
        const owed = after.div(rate.plus(1));
        backward.push({
          ...at,
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
        ...at,
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
      const add = (payment: Payment) => {
        interest = interest.plus(payment.interest);
        principal = principal.plus(payment.principal);
      };
      for (let k = 1; k <= count; k++) {
        const payment = paymentAfter(k)!;
        if (payment.month > to) break;
        if (payment.month > from) add(payment);
      }
      for (let j = 0; ; j++) {
        const payment = paymentBefore(j);
        if (!payment || payment.month <= from) break;
        if (payment.month <= to) add(payment);
      }
      return { interest, principal };
    },
    balanceAt(month) {
      if (month >= startMonth) {
        let owed = balance;
        for (let k = 1; k <= count; k++) {
          const payment = paymentAfter(k)!;
          if (payment.month > month) break;
          owed = payment.after;
        }
        return owed;
      }
      if (!history) return zero;
      // After the last payment in or before the month.
      for (let j = 0; ; j++) {
        const payment = paymentBefore(j);
        if (!payment) return balance;
        if (payment.month <= month) return payment.after;
      }
    },
    payments(horizon = MAX_HISTORY) {
      const list: Payment[] = [];
      for (let k = 1; k <= count; k++) {
        const payment = paymentAfter(k)!;
        if (!Number.isFinite(count) && payment.month > startMonth + horizon)
          break;
        list.push(payment);
      }
      return list;
    },
  };
}
