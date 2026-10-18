import {
  ADJUSTMENTS,
  amortize,
  describeTerms,
  monthIndex,
  monthOf,
  projectTotals,
  type Amortizing,
  type DebtSchedule,
  type Payment,
  type Project,
} from "@finance/domain";
import { Dec } from "@finance/engine";
import { money, rate } from "./format";

// Loans as the model reads them: their terms in words and what they come to,
// for a project's new loans and the borrower's existing ones alike. `start`
// is when the balance is known: a new loan's closing, or the date of the
// borrower's debt schedule.

// Interest-only loans never mature; their schedule shows these years, as in
// the app.
const INTEREST_ONLY_YEARS = 10;
// The most payments listed one by one.
export const MAX_PAYMENTS = 360;

type Amount = InstanceType<typeof Dec>;

const paymentsOf = (loan: Amortizing, start: string) =>
  amortize(loan, start).payments(INTEREST_ONLY_YEARS * 12);

const sum = (list: Payment[], pick: (p: Payment) => Amount) =>
  list.reduce((total, p) => total.plus(pick(p)), new Dec(0));

// The payment the loan's terms call for, once any moratorium is over.
function regularPayment(loan: Amortizing, payments: Payment[]) {
  const p = payments.find((p) => !p.moratorium && !p.skipped && !p.changed);
  if (!p) return null;
  if (loan.repayment === "blended")
    return `${money(p.interest.plus(p.principal))} principal and interest`;
  if (loan.repayment === "equal_principal")
    return `${money(p.principal)} principal, plus interest (${money(p.interest)} on the first)`;
  return `${money(p.interest)} interest`;
}

export function loanSummary(loan: Amortizing, start: string) {
  const payments = paymentsOf(loan, start);
  const last = payments.at(-1);
  const repaid = loan.repayment !== "interest_only" && last?.after.isZero();
  return {
    rate: rate(loan.rate),
    terms: describeTerms(loan),
    regularPayment: regularPayment(loan, payments),
    firstPayment: payments[0]?.date ?? null,
    maturity: repaid ? last!.date : null,
    totalInterest: repaid ? money(sum(payments, (p) => p.interest)) : null,
    adjustments: (loan.adjustments ?? []).map((a) => ({
      ...a,
      kind: ADJUSTMENTS[a.kind],
    })),
  };
}

// Year by year from `start`: what's paid in each twelve months of the loan
// and what's owed at their end, as the app's "By year" view shows it.
export function loanYears(loan: Amortizing, start: string) {
  const payments = paymentsOf(loan, start);
  if (!payments.length) return [];
  const from = monthIndex(start);
  const count = Math.ceil((payments.at(-1)!.month - from) / 12);
  return Array.from({ length: count }, (_, y) => {
    const first = from + y * 12 + 1;
    const last = from + (y + 1) * 12;
    const inYear = payments.filter((p) => p.month >= first && p.month <= last);
    return {
      year: y + 1,
      months: `${monthOf(first)} to ${monthOf(last)}`,
      interest: money(sum(inYear, (p) => p.interest)),
      principal: money(sum(inYear, (p) => p.principal)),
      extra: money(sum(inYear, (p) => p.extra)),
      capitalized: money(sum(inYear, (p) => p.capitalized)),
      balance: money(inYear.at(-1)?.after ?? (y ? new Dec(0) : loan.balance)),
    };
  });
}

// Each payment, up to MAX_PAYMENTS.
export function loanPayments(loan: Amortizing, start: string) {
  const payments = paymentsOf(loan, start);
  return {
    count: payments.length,
    listed: payments.slice(0, MAX_PAYMENTS).map((p, i) => ({
      n: i + 1,
      date: p.date,
      interest: money(p.interest),
      principal: money(p.principal),
      extra: money(p.extra),
      capitalized: money(p.capitalized),
      balance: money(p.after),
      ...(p.moratorium ? { moratorium: true } : {}),
      ...(p.skipped ? { skipped: true } : {}),
      ...(p.changed ? { changed: true } : {}),
    })),
  };
}

// A scenario's sources and uses at closing, its line of credit increases and
// subordinations, and whether sources cover uses.
export function describeProject(project: Project) {
  const totals = projectTotals(project);
  return {
    closing: project.closing,
    sources: project.sources.map((s) =>
      s.kind === "loan"
        ? {
            kind: "new loan",
            id: s.id,
            name: s.name,
            amount: money(s.amount),
            ...loanSummary({ ...s, balance: s.amount }, project.closing),
          }
        : {
            kind: "funds",
            id: s.id,
            name: s.name,
            amount: money(s.amount),
            postsTo: s.item,
          },
    ),
    uses: project.uses.map((u) => ({
      id: u.id,
      name: u.name,
      amount: money(u.amount),
      postsTo: u.item,
    })),
    lineOfCreditIncreases: project.lines.map((l) => ({
      id: l.id,
      name: l.name,
      increase: money(l.increase),
      averageUsage: rate(l.usage),
      rate: rate(l.rate),
    })),
    subordinations: project.subordinations.map((s) => ({
      id: s.id,
      name: s.name,
      amount: money(s.amount),
      interestSaved: money(s.interestSaved),
      principalSaved: money(s.principalSaved),
    })),
    totals: {
      sources: money(totals.sources),
      uses: money(totals.uses),
      // Sources less uses; the post-project balance sheet balances at zero.
      difference: money(totals.difference),
    },
  };
}

export function describeDebtSchedule(schedule: DebtSchedule) {
  return {
    asOf: schedule.asOf,
    loans: schedule.loans.map((loan) => ({
      id: loan.id,
      name: loan.name,
      balance: money(loan.balance),
      ...loanSummary(loan, schedule.asOf!),
    })),
  };
}
