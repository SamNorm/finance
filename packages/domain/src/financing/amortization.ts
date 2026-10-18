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

// Months of amortization as years, to two decimals: 90 → "7.5".
export const yearsOf = (months: number) =>
  String(Math.round((months / 12) * 100) / 100);

// "20 years · blended payments · every 2 weeks · moratorium of 10 two-week
// periods on principal, included in the amortization".
export function describeTerms(loan: Amortizing): string {
  const parts: string[] = [];
  if (loan.repayment !== "interest_only") {
    const years = yearsOf(loan.months);
    parts.push(`${years} year${years === "1" ? "" : "s"}`);
  }
  parts.push(REPAYMENTS[loan.repayment].toLowerCase());
  if (loan.frequency && loan.frequency !== "monthly")
    parts.push(FREQUENCIES[loan.frequency].toLowerCase());
  const m = loan.moratorium;
  if (m) {
    const [one, many] = PERIOD_UNITS[loan.frequency ?? "monthly"];
    parts.push(
      `moratorium of ${m.payments} ${m.payments === 1 ? one : many} ${MORATORIUMS[m.kind].toLowerCase()}${
        m.kind === "full" ? " (interest capitalized)" : ""
      }, ${m.included ? "included in" : "before"} the amortization`,
    );
  }
  return parts.join(" · ");
}

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

export type Adjustment = schema.ScheduleAdjustment;

export const ADJUSTMENTS: Record<Adjustment["kind"], string> = {
  extra: "Extra payment",
  payment: "Payment change",
  skip: "Skipped payments",
};

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
  // Changes to the schedule after its start, in any order.
  adjustments?: Adjustment[];
}

export interface Payment {
  date: string;
  // The month it counts in.
  month: number;
  interest: Amount;
  // Principal the schedule calls for.
  principal: Amount;
  // Principal paid on top, by extra payments.
  extra: Amount;
  // Interest added to the balance instead of paid: in a moratorium or skip on
  // principal and interest, or when a changed payment doesn't cover it.
  capitalized: Amount;
  // The balance after the payment.
  after: Amount;
  // Whether it falls in the moratorium, is skipped, or is at a changed amount.
  moratorium: boolean;
  skipped: boolean;
  changed: boolean;
}

export interface Schedule {
  // Interest, scheduled principal and extra principal paid in the months
  // after `from`, up to and including `to`.
  flows(
    from: number,
    to: number,
  ): { interest: Amount; principal: Amount; extra: Amount };
  // What's owed at the end of a month.
  balanceAt(month: number): Amount;
  // The payments after the start, until the loan is repaid; for an
  // interest-only loan, those in the `horizon` months after the start's.
  payments(horizon?: number): Payment[];
}

const MAX_HISTORY = 120;
// Payments stop after this many years, for a loan its payments never repay.
const MAX_YEARS_PAID = 100;
// What decimals leave owed on a repaid loan.
const PAID = new Dec("1e-6");
const zero = new Dec(0);

interface Regular {
  // A blended payment, or equal principal; neither for interest only.
  level: Amount | null;
  step: Amount | null;
}

// The regular payment that repays `owed` over `payments` payments.
function regularPayment(
  repayment: Repayment,
  owed: Amount,
  rate: Amount,
  payments: number,
): Regular {
  if (repayment === "equal_principal")
    return { level: null, step: owed.div(payments) };
  if (repayment === "blended")
    return {
      level: rate.isZero()
        ? owed.div(payments)
        : owed.times(rate).div(new Dec(1).minus(rate.plus(1).pow(-payments))),
      step: null,
    };
  return { level: null, step: null };
}

// The loan's payments after `start`, the date its balance is known at. With
// `history`, the same payments run back before it, for periods that began
// earlier (an existing loan known at a date); without, nothing is owed before
// it (a new loan drawn that day).
//
// A moratorium comes first; when the amortization includes it, the principal
// is repaid over what's left. Adjustments then apply in date order, each to
// the first payment on or after its date, on the balance as it stands. For a
// payment, a skip wins over a payment change, which wins over the
// moratorium. "Keeping the end" repays what's owed by the loan's maturity,
// which skips that keep the payment push back. An extra payment during the
// moratorium that keeps the payment leaves the payment after it as it would
// have been.
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
  const when = (k: number) => ({
    date: paymentDate(start, frequency, k),
    month: startMonth + Math.ceil((12 * k) / perYear),
  });
  // The terms the loan starts on, which payments before the start follow.
  const initial = regularPayment(loan.repayment, balance, rate, repaying);
  const sorted = [...(loan.adjustments ?? [])].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  // Interest and principal on a payment of `amount`, principal and interest
  // together; interest it doesn't cover is capitalized.
  const blended = (amount: Amount, interest: Amount) =>
    amount.gte(interest)
      ? { paid: interest, principal: amount.minus(interest), capitalized: zero }
      : { paid: amount, principal: zero, capitalized: interest.minus(amount) };

  // The k-th payment after start, for a set of adjustments. Payments are
  // worked out in order, carrying the loan's state from one to the next.
  const forwardOf = (adjustments: readonly Adjustment[]) => {
    const list: Payment[] = [];
    let owed = balance;
    let regular: Regular = held ? { level: null, step: null } : initial;
    // The payment the loan is due to end with.
    let end = held + repaying;
    let skip: {
      left: number;
      suspends: Moratorium["kind"];
      keep: "payment" | "end";
    } | null = null;
    let change: { amount: Amount; until: string | null } | null = null;
    let next = 0;
    let keptInMoratorium = false;
    let repaid = false;

    const step = () => {
      const n = list.length + 1;
      const at = when(n);
      let extra = zero;
      let reamortize = false;
      while (next < adjustments.length && adjustments[next]!.date <= at.date) {
        const a = adjustments[next++]!;
        if (a.kind === "extra") {
          extra = extra.plus(a.amount);
          if (a.keep === "end") reamortize = true;
          else if (n <= held) keptInMoratorium = true;
        } else if (a.kind === "payment") {
          change = { amount: new Dec(a.amount), until: a.until };
        } else {
          skip = { left: a.payments, suspends: a.suspends, keep: a.keep };
          if (a.keep === "payment") end += a.payments;
        }
      }
      if (change?.until && at.date > change.until) change = null;

      const interest = owed.times(rate);
      let paid = interest;
      let principal = zero;
      let capitalized = zero;
      const suspends = skip
        ? skip.suspends
        : !change && n <= held
          ? moratorium!.kind
          : null;
      if (suspends === "full") {
        paid = zero;
        capitalized = interest;
      } else if (suspends === null) {
        const amount = change?.amount ?? regular.level;
        if (loan.repayment === "blended" && amount)
          ({ paid, principal, capitalized } = blended(amount, interest));
        else principal = change?.amount ?? regular.step ?? zero;
      }
      const owing = owed.plus(capitalized);
      principal = Dec.min(principal, owing);
      extra = Dec.min(extra, owing.minus(principal));
      let after = owing.minus(principal).minus(extra);
      if (after.lt(PAID)) {
        principal = principal.plus(after);
        after = zero;
        repaid = true;
      }
      list.push({
        ...at,
        interest: paid,
        principal,
        extra,
        capitalized,
        after,
        moratorium: n <= held,
        skipped: skip !== null,
        changed: !skip && change !== null,
      });
      owed = after;

      if (skip && --skip.left === 0) {
        if (skip.keep === "end") reamortize = true;
        skip = null;
      }
      // The moratorium's over: the regular payment starts.
      if (n === held)
        regular = regularPayment(
          loan.repayment,
          keptInMoratorium
            ? forwardOf(
                adjustments.filter(
                  (a) => !(a.kind === "extra" && a.keep === "payment"),
                ),
              )(held)!.after
            : after,
          rate,
          end - held,
        );
      else if (reamortize && n > held)
        regular = regularPayment(
          loan.repayment,
          after,
          rate,
          Math.max(1, end - n),
        );
    };

    return (k: number): Payment | null => {
      while (
        list.length < k &&
        !repaid &&
        list.length < MAX_YEARS_PAID * perYear
      )
        step();
      return list[k - 1] ?? null;
    };
  };
  const paymentAfter = forwardOf(sorted);

  // backward[j] is the payment j periods before start (j = 0 is a payment on
  // the start date, which left the known balance), back ten years, on the
  // terms the loan starts with. A loan in a moratorium at its date has been
  // in it all along.
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
      const flags = { extra: zero, skipped: false, changed: false };
      if (held && moratorium!.kind === "full") {
        const owed = after.div(rate.plus(1));
        backward.push({
          ...at,
          ...flags,
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
          : initial.step
            ? after.plus(initial.step)
            : after.plus(initial.level!).div(rate.plus(1));
      backward.push({
        ...at,
        ...flags,
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
      let extra = zero;
      const add = (payment: Payment) => {
        interest = interest.plus(payment.interest);
        principal = principal.plus(payment.principal);
        extra = extra.plus(payment.extra);
      };
      for (let k = 1; ; k++) {
        const payment = paymentAfter(k);
        if (!payment || payment.month > to) break;
        if (payment.month > from) add(payment);
      }
      for (let j = 0; ; j++) {
        const payment = paymentBefore(j);
        if (!payment || payment.month <= from) break;
        if (payment.month <= to) add(payment);
      }
      return { interest, principal, extra };
    },
    balanceAt(month) {
      if (month >= startMonth) {
        let owed = balance;
        for (let k = 1; ; k++) {
          const payment = paymentAfter(k);
          if (!payment || payment.month > month) break;
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
      for (let k = 1; ; k++) {
        const payment = paymentAfter(k);
        if (!payment) break;
        if (
          loan.repayment === "interest_only" &&
          payment.month > startMonth + horizon
        )
          break;
        list.push(payment);
      }
      return list;
    },
  };
}
