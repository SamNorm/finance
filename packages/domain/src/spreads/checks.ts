import type { schema } from "@finance/db";
import { Dec } from "@finance/engine";
import type { Issue } from "../errors";
import { monthIndex } from "../financing/amortization";
import type { FinancingPart } from "../financing/common";
import type { ScoringItem } from "../scoring-models/types";

// Statement checks (§5.6): subtotals reconcile with their lines, the balance
// sheet balances, and figures carry the sign the scoring model expects; net
// income matches the statements', and retained earnings roll forward. They
// never block entry. Errors are critical: a period with one can't be
// analyzed (see analyses/service.ts); warnings only flag.

export type CheckItems = schema.CheckItems;
export type ReconciliationLine = schema.ReconciliationLine;

type Amount = InstanceType<typeof Dec>;

// Differences up to this much are rounding, not errors.
export const TOLERANCE = new Dec(1);

const NUMERIC = new Set(["amount", "percent", "ratio", "count"]);
export const isNumeric = (item: ScoringItem) => NUMERIC.has(item.dataType);

const format = (value: Amount) =>
  Number(value.toFixed(2)).toLocaleString("en-CA", {
    maximumFractionDigits: 2,
  });

// Every numeric item's value in one period: what was entered, or for a
// subtotal with nothing entered, the sum of its lines. Text items are left out.
export function effectiveAmounts(
  items: readonly ScoringItem[],
  entered: ReadonlyMap<string, string>,
) {
  const children = childrenOf(items);
  const amounts = new Map<string, Amount>();
  const computed = new Map<string, Amount>();

  const sum = (item: ScoringItem): Amount | null => {
    const known = computed.get(item.code);
    if (known) return known;
    let total: Amount | null = null;
    for (const child of children.get(item.code) ?? []) {
      if (child.aggregation === "ignore" || child.kind === "header") continue;
      const value = valueOf(child);
      if (value === null) continue;
      const signed = child.aggregation === "subtract" ? value.neg() : value;
      total = total ? total.plus(signed) : signed;
    }
    if (total) computed.set(item.code, total);
    return total;
  };
  const valueOf = (item: ScoringItem): Amount | null => {
    const raw = entered.get(item.code);
    if (raw !== undefined) return new Dec(raw);
    return item.kind === "subtotal" ? sum(item) : null;
  };

  for (const item of items) {
    if (!isNumeric(item) || item.kind === "header") continue;
    const value = valueOf(item);
    if (value !== null) amounts.set(item.code, value);
  }
  return { amounts, computed, sum };
}

// Adds amounts to input items, such as a project's postings or a
// consolidation's eliminations, and to each subtotal above them that holds a
// figure of its own, as pasted totals do, so totals move with their lines.
// Each figure changed keeps what it's made of: as entered, then each part.
export function addToItems(
  items: readonly ScoringItem[],
  entered: Readonly<Record<string, string>>,
  changes: ReadonlyMap<string, { delta: Amount; parts: FinancingPart[] }>,
): {
  entered: Record<string, string>;
  adjusted: Record<string, FinancingPart[]>;
} {
  const byCode = new Map(items.map((item) => [item.code, item]));
  const result = { ...entered };
  const adjusted: Record<string, FinancingPart[]> = {};
  const add = (code: string, delta: Amount, parts: FinancingPart[]) => {
    result[code] = delta.plus(result[code] ?? 0).toFixed();
    (adjusted[code] ??= [
      { id: "entered", name: "As entered", value: entered[code] ?? "0" },
    ]).push(...parts);
  };
  for (const [code, { delta, parts }] of changes) {
    add(code, delta, parts);
    // Up the hierarchy, flipping the sign through lines a total subtracts.
    let negative = false;
    let child = byCode.get(code);
    while (child?.parentCode && child.aggregation !== "ignore") {
      if (child.aggregation === "subtract") negative = !negative;
      const parent = byCode.get(child.parentCode);
      if (!parent) break;
      if (entered[parent.code] !== undefined)
        add(
          parent.code,
          negative ? delta.neg() : delta,
          negative
            ? parts.map((p) => ({
                ...p,
                value: new Dec(p.value).neg().toFixed(),
              }))
            : parts,
        );
      child = parent;
    }
  }
  return { entered: result, adjusted };
}

export function checkPeriod(
  items: readonly ScoringItem[],
  entered: ReadonlyMap<string, string>,
): Issue[] {
  const issues: Issue[] = [];
  const known = new Set(items.map((item) => item.code));
  const { amounts, sum } = effectiveAmounts(items, entered);

  const balanceSheetTotals = items.filter(
    (item) =>
      item.statement === "balance_sheet" &&
      item.parentCode === null &&
      item.kind === "subtotal",
  );
  if (balanceSheetTotals.length === 2) {
    const [assets, claims] = balanceSheetTotals as [ScoringItem, ScoringItem];
    // A side with nothing entered counts as zero once the other has figures.
    const a = amounts.get(assets.code) ?? new Dec(0);
    const b = amounts.get(claims.code) ?? new Dec(0);
    if (a.minus(b).abs().gt(TOLERANCE)) {
      issues.push({
        severity: "error",
        code: "balance",
        itemCode: assets.code,
        message: `The balance sheet doesn't balance: ${assets.label} ${format(a)} vs ${claims.label} ${format(b)} (difference ${format(a.minus(b))}).`,
      });
    }
  }

  for (const item of items) {
    const raw = entered.get(item.code);
    if (raw === undefined || !isNumeric(item)) continue;
    const value = new Dec(raw);
    if (item.kind === "subtotal") {
      const lines = sum(item);
      if (lines && value.minus(lines).abs().gt(TOLERANCE)) {
        issues.push({
          severity: "warning",
          code: "subtotal",
          itemCode: item.code,
          message: `${item.label} is ${format(value)} but its lines add up to ${format(lines)} (difference ${format(value.minus(lines))}).`,
        });
      }
    }
    if (
      item.expectedSign === "positive" &&
      value.isNegative() &&
      !value.isZero()
    ) {
      issues.push({
        severity: "warning",
        code: "sign",
        itemCode: item.code,
        message: `${item.label} is negative; the scoring model expects a positive figure.`,
      });
    }
    if (
      item.expectedSign === "negative" &&
      value.isPositive() &&
      !value.isZero()
    ) {
      issues.push({
        severity: "warning",
        code: "sign",
        itemCode: item.code,
        message: `${item.label} is positive; the scoring model expects a negative figure.`,
      });
    }
  }

  for (const code of entered.keys()) {
    if (!known.has(code)) {
      issues.push({
        severity: "warning",
        code: "unknown_code",
        itemCode: code,
        message: `"${code}" isn't in this period's scoring model version.`,
      });
    }
  }
  return issues;
}

// What the statements themselves say about a period, beyond its figures.
export interface StatementControls {
  // The scoring model's net income and retained earnings items.
  items: CheckItems;
  // Net income as printed on the statements, when entered.
  reportedNetIncome: string | null;
  // How retained earnings changed other than by net income.
  reconciliation: readonly Pick<ReconciliationLine, "amount">[];
  // The period it rolls forward from, with its figures, when there's one.
  previous: {
    end: string;
    items: readonly ScoringItem[];
    entered: ReadonlyMap<string, string>;
  } | null;
}

// The period another rolls forward from: the one ending in the month it
// starts, a fiscal year when several do. A year to date to June 2025 rolls
// forward from the fiscal year to December 2024.
export function previousPeriod<P extends { periodEnd: string; months: number }>(
  period: P,
  periods: readonly P[],
): P | null {
  const start = monthIndex(period.periodEnd) - period.months;
  const before = periods.filter(
    (p) => p !== period && monthIndex(p.periodEnd) === start,
  );
  return before.find((p) => p.months === 12) ?? before[0] ?? null;
}

// Checks against the statements: net income as printed, an error when the
// spread's differs, since a figure is wrong; and retained earnings rolled
// forward from the period before with net income and the reconciliation's
// lines, a warning when they don't, as scoring systems' often need a plug.
export function checkControls(
  items: readonly ScoringItem[],
  entered: ReadonlyMap<string, string>,
  controls: StatementControls,
): Issue[] {
  const issues: Issue[] = [];
  const { amounts } = effectiveAmounts(items, entered);
  const find = (code: string | null) =>
    code ? items.find((i) => i.code === code && isNumeric(i)) : undefined;
  const netIncome = find(controls.items.netIncome);
  const income = netIncome && amounts.get(netIncome.code);

  if (netIncome && controls.reportedNetIncome !== null) {
    const spread = income ?? new Dec(0);
    const printed = new Dec(controls.reportedNetIncome);
    if (spread.minus(printed).abs().gt(TOLERANCE))
      issues.push({
        severity: "error",
        code: "net_income",
        itemCode: netIncome.code,
        message: `${netIncome.label} is ${format(spread)} in the spread but ${format(printed)} on the statements (difference ${format(spread.minus(printed))}).`,
      });
  }

  const retained = find(controls.items.retainedEarnings);
  const { previous } = controls;
  if (retained && netIncome && previous) {
    const end = amounts.get(retained.code);
    const start = effectiveAmounts(
      previous.items,
      previous.entered,
    ).amounts.get(retained.code);
    if (end && start) {
      const adjusted = controls.reconciliation.reduce(
        (total, line) => total.plus(line.amount),
        new Dec(0),
      );
      const expected = start.plus(income ?? 0).plus(adjusted);
      if (end.minus(expected).abs().gt(TOLERANCE))
        issues.push({
          severity: "warning",
          code: "retained_earnings",
          itemCode: retained.code,
          message: `${retained.label} doesn't roll forward from ${previous.end}: ${format(start)} + net income ${format(income ?? new Dec(0))}${adjusted.isZero() ? "" : ` + adjustments ${format(adjusted)}`} = ${format(expected)}, vs ${format(end)} on the balance sheet (difference ${format(end.minus(expected))}).`,
        });
    }
  }
  return issues;
}

function childrenOf(items: readonly ScoringItem[]) {
  const children = new Map<string, ScoringItem[]>();
  for (const item of items) {
    if (item.parentCode === null) continue;
    children.set(item.parentCode, [
      ...(children.get(item.parentCode) ?? []),
      item,
    ]);
  }
  return children;
}
