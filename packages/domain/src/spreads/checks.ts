import { Dec } from "@finance/engine";
import type { Issue } from "../errors";
import type { ScoringItem } from "../scoring-models/types";

// Statement checks (§5.6): subtotals reconcile with their lines, the balance
// sheet balances, and figures carry the sign the scoring model expects. They
// flag problems; they never block entry.

type Amount = InstanceType<typeof Dec>;

// Differences up to this much are rounding, not errors.
const TOLERANCE = new Dec(1);

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
