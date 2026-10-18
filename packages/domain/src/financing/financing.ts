import type { schema } from "@finance/db";
import { Dec } from "@finance/engine";
import { DomainError } from "../errors";
import type { ScoringItem } from "../scoring-models/types";
import { amortize, monthIndex } from "./amortization";
import {
  entryId,
  parseAmount,
  parseDate,
  parseAdjustments,
  parseRate,
  parseTerms,
  type Amount,
  type FinancingPart,
  type FinancingPeriod,
  type FinancingValue,
} from "./common";

// The project a scenario finances (§5.5), as a sources and uses table at
// closing. Each source and use posts to a balance sheet item, so the
// post-project balance sheet balances when the two sides do; new loans also
// add debt service. Post-project columns show the borrower with the project:
// at closing for actual periods, on the loans' schedules for projected ones.

export type Project = schema.Project;
export type ProjectSource = Project["sources"][number];
export type ProjectLoan = Extract<ProjectSource, { kind: "loan" }>;
export type ProjectFunds = Extract<ProjectSource, { kind: "funds" }>;
export type ProjectUse = Project["uses"][number];
export type FinancingItems = schema.FinancingItems;

// The built-in inputs every formula can read. Project inputs are zero
// outside post-project columns, so a model can add them unconditionally;
// debt schedule inputs are blank in actual periods (see debt-schedule.ts).
export const FINANCING_INPUTS = [
  {
    code: "PROFORMA_DEBT",
    label: "New loans outstanding",
    description:
      "What the project's new loans owe: the full amount at closing, then their balance at each projected year end.",
  },
  {
    code: "PROFORMA_DEBT_CURRENT",
    label: "Current portion of new loans",
    description:
      "Principal on the new loans due in the following twelve months.",
  },
  {
    code: "PROFORMA_INTEREST",
    label: "Post-project interest",
    description:
      "Interest on the new loans, less interest no longer paid on subordinated debt. In actual periods, the first twelve months after closing.",
  },
  {
    code: "PROFORMA_PRINCIPAL",
    label: "Post-project principal",
    description:
      "Scheduled principal on the new loans, less principal no longer paid on subordinated debt. In actual periods, the first twelve months after closing.",
  },
  {
    code: "PROFORMA_PREPAYMENTS",
    label: "Post-project extra payments",
    description:
      "Extra payments of principal on the new loans, from their schedule adjustments. Apart from scheduled principal, so a model chooses whether its debt service counts them. In actual periods, the first twelve months after closing.",
  },
  {
    code: "PROFORMA_LINE_INTEREST",
    label: "Line of credit interest",
    description:
      "Interest on the expected average use of line of credit increases.",
  },
  {
    code: "PROFORMA_TO_EQUITY",
    label: "Debt subordinated to equity",
    description:
      "Debt postponed in favour of the lender and treated as equity.",
  },
  {
    code: "DEBT_SCHEDULE_INTEREST",
    label: "Existing loans: interest",
    description:
      "Interest on the borrower's existing loans, from its debt schedule. Blank in actual periods except post-project, so a formula can fall back on the statements with ISBLANK.",
  },
  {
    code: "DEBT_SCHEDULE_PRINCIPAL",
    label: "Existing loans: principal",
    description:
      "Scheduled principal on the borrower's existing loans, from its debt schedule. Blank in actual periods except post-project.",
  },
  {
    code: "DEBT_SCHEDULE_PREPAYMENTS",
    label: "Existing loans: extra payments",
    description:
      "Extra payments of principal on the borrower's existing loans, from their schedule adjustments. Apart from scheduled principal, so a model chooses whether its debt service counts them. Blank in actual periods except post-project.",
  },
  {
    code: "DEBT_SCHEDULE_BALANCE",
    label: "Existing loans: balance",
    description:
      "What the borrower's existing loans owe, from its debt schedule. Blank in actual periods except post-project.",
  },
] as const;

export type FinancingCode = (typeof FINANCING_INPUTS)[number]["code"];
export const FINANCING_CODES: readonly string[] = FINANCING_INPUTS.map(
  (input) => input.code,
);
export type ProjectCode = Exclude<FinancingCode, `DEBT_SCHEDULE_${string}`>;
export const PROJECT_CODES = FINANCING_CODES.filter(
  (code) => !code.startsWith("DEBT_SCHEDULE_"),
) as ProjectCode[];

export type Side = "assets" | "claims";

// The balance sheet items a source or use can post to, by side: amounts
// entered under the first top-level balance sheet total (assets) or the
// second (liabilities and equity).
export function balanceSheetSides(
  items: readonly ScoringItem[],
): Map<string, Side> {
  const totals = items.filter(
    (i) =>
      i.statement === "balance_sheet" &&
      i.parentCode === null &&
      i.kind === "subtotal",
  );
  const sides = new Map<string, Side>();
  if (totals.length !== 2) return sides;
  const parent = new Map(items.map((i) => [i.code, i.parentCode]));
  const root = (code: string) => {
    let current = code;
    for (let guard = 0; guard < 100; guard++) {
      const next = parent.get(current);
      if (!next) return current;
      current = next;
    }
    return current;
  };
  for (const item of items) {
    if (
      item.statement !== "balance_sheet" ||
      item.kind !== "input" ||
      item.dataType !== "amount"
    )
      continue;
    const top = root(item.code);
    if (top === totals[0]!.code) sides.set(item.code, "assets");
    if (top === totals[1]!.code) sides.set(item.code, "claims");
  }
  return sides;
}

// A project as typed in a form: every field as text.
export interface ProjectInput {
  closing?: unknown;
  sources?: readonly Record<string, unknown>[];
  uses?: readonly Record<string, unknown>[];
  lines?: readonly Record<string, unknown>[];
  subordinations?: readonly Record<string, unknown>[];
}

const invalid = (message: string) => new DomainError("invalid", message);
const named = (raw: unknown, fallback: string) => {
  const name = String(raw ?? "").trim();
  if (!name) throw invalid(`${fallback}: give it a name.`);
  return name;
};

// Checks and makes canonical a scenario's project; null when it has nothing.
// Items must be balance sheet items of the scoring model, and loans need it
// to say where new debt and repayments post.
export function normalizeProject(
  input: ProjectInput | null | undefined,
  context: { sides: ReadonlyMap<string, Side>; items: FinancingItems },
): Project | null {
  if (!input) return null;
  const list = (value: unknown) => {
    if (value === undefined) return [];
    if (!Array.isArray(value))
      throw invalid("The project's entries must be lists.");
    return value as Record<string, unknown>[];
  };
  const sources = list(input.sources);
  const uses = list(input.uses);
  const lines = list(input.lines);
  const subordinations = list(input.subordinations);
  if (
    !sources.length &&
    !uses.length &&
    !lines.length &&
    !subordinations.length
  )
    return null;
  const closing = parseDate(input.closing, "Project", "closing date");
  const item = (raw: unknown, what: string) => {
    const code = String(raw ?? "");
    if (!context.sides.has(code))
      throw invalid(`${what}: choose the balance sheet item it posts to.`);
    return code;
  };

  const project: Project = {
    closing,
    sources: sources.map((s, i): ProjectSource => {
      const name = named(s.name, `Source ${i + 1}`);
      const amount = parseAmount(s.amount, name, "amount", true);
      if (s.kind === "loan") {
        const terms = parseTerms(s, name);
        const adjustments = parseAdjustments(
          s.adjustments,
          name,
          terms.frequency ?? "monthly",
          closing,
        );
        return {
          kind: "loan",
          id: entryId(s.id),
          name,
          amount,
          rate: parseRate(s.rate, name),
          ...terms,
          ...(adjustments.length ? { adjustments } : {}),
        };
      }
      if (s.kind !== "funds")
        throw invalid(`"${String(s.kind)}" isn't a kind of source.`);
      return {
        kind: "funds",
        id: entryId(s.id),
        name,
        amount,
        item: item(s.item, name),
      };
    }),
    uses: uses.map((u, i) => {
      const name = named(u.name, `Use ${i + 1}`);
      return {
        id: entryId(u.id),
        name,
        amount: parseAmount(u.amount, name, "amount", true),
        item: item(u.item, name),
      };
    }),
    lines: lines.map((l, i) => {
      const name = named(l.name, `Line of credit ${i + 1}`);
      return {
        id: entryId(l.id),
        name,
        increase: parseAmount(l.increase, name, "increase", true),
        usage: parseRate(l.usage, name, "average usage"),
        rate: parseRate(l.rate, name),
      };
    }),
    subordinations: subordinations.map((s, i) => {
      const name = named(s.name, `Subordination ${i + 1}`);
      return {
        id: entryId(s.id),
        name,
        amount: parseAmount(s.amount, name, "amount", true),
        interestSaved: parseAmount(s.interestSaved, name, "interest saved"),
        principalSaved: parseAmount(s.principalSaved, name, "principal saved"),
      };
    }),
  };
  if (project.sources.some((s) => s.kind === "loan")) {
    const { longTermDebt, currentDebt, cash } = context.items;
    if (
      ![longTermDebt, currentDebt, cash].every(
        (code) => code && context.sides.has(code),
      )
    ) {
      throw invalid(
        "Set where new loans post (long-term debt, current portion and cash) on the scoring model first.",
      );
    }
  }
  return project;
}

export function projectTotals(project: Project) {
  const sum = (amounts: string[]) =>
    amounts.reduce((total, a) => total.plus(a), new Dec(0));
  const sources = sum(project.sources.map((s) => s.amount));
  const uses = sum(project.uses.map((u) => u.amount));
  return { sources, uses, difference: sources.minus(uses) };
}

// Sources and uses balance to the dollar; less is rounding.
export const BALANCE_TOLERANCE = 1;

// Whether the post-project balance sheet balances: sources equal uses.
export const isBalanced = (project: Project) =>
  projectTotals(project).difference.abs().lt(BALANCE_TOLERANCE);

const dollars = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });

// "Sources exceed uses by 500,000", or null when they balance.
export function imbalance(project: Project): string | null {
  if (isBalanced(project)) return null;
  const { difference } = projectTotals(project);
  return `Sources ${difference.isPositive() ? "exceed" : "fall short of"} uses by ${dollars.format(Number(difference.abs().toFixed(2)))}`;
}

interface Window {
  // Payments counted: months after `from`, up to and including `to`.
  from: number;
  to: number;
  // Flows scaled by this share: a pro forma period's months over twelve.
  share: Amount;
  // The month balances are read at.
  at: number;
  // Months of the window after closing, for facilities without a schedule.
  open: number;
}

// How a period reads the project. Pro forma periods are at closing: the full
// amounts, and the first twelve months of payments scaled to the period's
// length. Projected periods read the schedules as they stand in the period;
// before closing, and in actual periods, nothing applies.
function windowOf(period: FinancingPeriod, closing: number): Window | null {
  if (period.mode === "actual") return null;
  if (period.mode === "proForma") {
    return {
      from: closing,
      to: closing + 12,
      share: new Dec(period.months).div(12),
      at: closing,
      open: 12,
    };
  }
  const to = monthIndex(period.end);
  if (to < closing) return null;
  const from = to - period.months;
  return {
    from,
    to,
    share: new Dec(1),
    at: to,
    open: to - Math.max(from, closing),
  };
}

const loanSchedules = (project: Project) =>
  project.sources
    .filter((s): s is ProjectLoan => s.kind === "loan")
    .map((loan) => ({
      loan,
      schedule: amortize({ ...loan, balance: loan.amount }, project.closing),
    }));

// The project's built-in inputs in each period of a post-project run.
export function projectValues(
  project: Project,
  periods: readonly FinancingPeriod[],
): Record<ProjectCode, FinancingValue[]> {
  const result = Object.fromEntries(
    PROJECT_CODES.map((code) => [
      code,
      periods.map((): FinancingValue => ({ value: new Dec(0), parts: [] })),
    ]),
  ) as Record<ProjectCode, FinancingValue[]>;
  const add = (
    code: ProjectCode,
    p: number,
    entry: { id: string; name: string },
    value: Amount,
  ) => {
    if (value.isZero()) return;
    const cell = result[code][p]!;
    cell.value = cell.value!.plus(value);
    cell.parts.push({
      id: entry.id,
      name: entry.name,
      value: value.toFixed(),
    });
  };

  const closing = monthIndex(project.closing);
  const loans = loanSchedules(project);
  periods.forEach((period, p) => {
    const w = windowOf(period, closing);
    if (!w) return;
    for (const { loan, schedule } of loans) {
      const flows = schedule.flows(w.from, w.to);
      add("PROFORMA_DEBT", p, loan, schedule.balanceAt(w.at));
      add(
        "PROFORMA_DEBT_CURRENT",
        p,
        loan,
        schedule.flows(w.at, w.at + 12).principal,
      );
      add("PROFORMA_INTEREST", p, loan, flows.interest.times(w.share));
      add("PROFORMA_PRINCIPAL", p, loan, flows.principal.times(w.share));
      add("PROFORMA_PREPAYMENTS", p, loan, flows.extra.times(w.share));
    }
    const open = new Dec(w.open).div(12).times(w.share);
    for (const line of project.lines) {
      const yearly = new Dec(line.increase).times(line.usage).times(line.rate);
      add("PROFORMA_LINE_INTEREST", p, line, yearly.times(open));
    }
    for (const sub of project.subordinations) {
      add("PROFORMA_TO_EQUITY", p, sub, new Dec(sub.amount));
      add(
        "PROFORMA_INTEREST",
        p,
        sub,
        new Dec(sub.interestSaved).times(open).neg(),
      );
      add(
        "PROFORMA_PRINCIPAL",
        p,
        sub,
        new Dec(sub.principalSaved).times(open).neg(),
      );
    }
  });
  return result;
}

export interface ItemAdjustment {
  delta: Amount;
  parts: FinancingPart[];
}

// What the project adds to balance sheet items in each period of a
// post-project run: sources and uses at their amounts, new loans split
// between their current and long-term portions, and in projected periods
// the principal repaid since closing, out of cash.
export function projectItemAdjustments(
  project: Project,
  periods: readonly FinancingPeriod[],
  sides: ReadonlyMap<string, Side>,
  items: FinancingItems,
): Map<string, ItemAdjustment>[] {
  const closing = monthIndex(project.closing);
  const loans = loanSchedules(project);
  return periods.map((period) => {
    const adjustments = new Map<string, ItemAdjustment>();
    const w = windowOf(period, closing);
    if (!w) return adjustments;
    const post = (
      code: string | null,
      entry: { id: string; name: string },
      value: Amount,
    ) => {
      if (!code || value.isZero()) return;
      const current = adjustments.get(code) ?? {
        delta: new Dec(0),
        parts: [],
      };
      current.delta = current.delta.plus(value);
      current.parts.push({
        id: entry.id,
        name: entry.name,
        value: value.toFixed(),
      });
      adjustments.set(code, current);
    };
    // Sources raise liabilities or equity, or draw down an asset such as
    // cash; uses raise assets, or reduce what's owed or equity.
    for (const source of project.sources) {
      if (source.kind !== "funds") continue;
      const amount = new Dec(source.amount);
      post(
        source.item,
        source,
        sides.get(source.item) === "assets" ? amount.neg() : amount,
      );
    }
    for (const use of project.uses) {
      const amount = new Dec(use.amount);
      post(
        use.item,
        use,
        sides.get(use.item) === "assets" ? amount : amount.neg(),
      );
    }
    for (const { loan, schedule } of loans) {
      const balance = schedule.balanceAt(w.at);
      const current = Dec.min(
        schedule.flows(w.at, w.at + 12).principal,
        balance,
      );
      post(items.currentDebt, loan, current);
      post(items.longTermDebt, loan, balance.minus(current));
      post(items.cash, loan, new Dec(loan.amount).minus(balance).neg());
    }
    return adjustments;
  });
}
