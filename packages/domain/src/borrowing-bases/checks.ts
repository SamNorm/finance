import { Dec } from "@finance/engine";
import type { Issue } from "../errors";
import { TOLERANCE } from "../spreads/checks";
import type { CompiledBorrowingBase } from "./compile";
import { fxCode, type BorrowingBaseDefinition } from "./definition";
import type { BorrowingBaseMonthInput, BorrowingBaseRun } from "./run";

// A borrowing base's checks (borrowing-base-plan.md §7.4). They flag rather
// than block, as the spread's statement checks do; only a missing exchange
// rate is an error, since the month can't be computed without it.

export interface BorrowingBaseIssues {
  // About the history as a whole, such as months missing.
  general: Issue[];
  // By month, "YYYY-MM".
  byMonth: Record<string, Issue[]>;
}

// A spread period the history can be compared with, at its end.
export interface SpreadFigures {
  end: string;
  figure: (code: string) => string | undefined;
}

// A month's figures as far apart from the spread's as this share, or more,
// are flagged. Receivables in the spread are net of the allowance for
// doubtful accounts, so some gap is normal.
export const RECONCILE_SHARE = new Dec("0.05");

const show = (value: InstanceType<typeof Dec>) =>
  Number(value.toFixed(2)).toLocaleString("en-CA", {
    maximumFractionDigits: 2,
  });

export function borrowingBaseIssues(input: {
  definition: BorrowingBaseDefinition;
  compiled: CompiledBorrowingBase;
  months: readonly BorrowingBaseMonthInput[];
  run: BorrowingBaseRun;
  spread?: readonly SpreadFigures[];
  labels?: ReadonlyMap<string, string>;
}): BorrowingBaseIssues {
  const { definition, compiled, run } = input;
  const general: Issue[] = [];
  const byMonth: Record<string, Issue[]> = {};
  const flag = (month: string, issue: Issue) =>
    (byMonth[month] ??= []).push(issue);

  const missing = run.months
    .filter((m) => !m.quality && !m.projected)
    .map((m) => m.month);
  if (missing.length)
    general.push({
      severity: "warning",
      code: "months_missing",
      message: `No certificate for ${missing.join(", ")}, between the first month and the last.`,
    });

  const foreign = new Map(
    compiled.inputs.filter((r) => r.currency).map((r) => [r.code, r.currency!]),
  );
  const amounts = compiled.inputs.filter((r) => !r.code.startsWith("FX."));
  for (const month of input.months) {
    const figures = month.figures;
    const needed = new Set(
      Object.keys(figures)
        .filter((code) => foreign.has(code))
        .map((code) => foreign.get(code)!),
    );
    for (const currency of needed)
      if (figures[fxCode(currency)] === undefined)
        flag(month.month, {
          severity: "error",
          code: "fx_missing",
          itemCode: fxCode(currency),
          message: `No ${currency} rate for ${month.month}: its ${currency} figures can't be converted, so its borrowing base can't be relied on.`,
        });
    for (const row of amounts) {
      const raw = figures[row.code];
      if (raw !== undefined && new Dec(raw).isNegative())
        flag(month.month, {
          severity: "warning",
          code: "negative",
          itemCode: row.code,
          message: `${row.label} is negative in ${month.month}.`,
        });
    }
  }

  // Against the spread: lines naming the item they're part of, added up in
  // the line's currency, at a month ending on a spread period's end.
  const parts = new Map<string, string[]>();
  for (const line of definition.lines)
    if (
      (line.kind === "collateral" || line.kind === "usage") &&
      line.reconcilesWith
    )
      parts.set(line.reconcilesWith, [
        ...(parts.get(line.reconcilesWith) ?? []),
        line.code,
      ]);
  if (definition.outstandingReconcilesWith)
    parts.set(definition.outstandingReconcilesWith, [
      ...(parts.get(definition.outstandingReconcilesWith) ?? []),
      "BB_OUTSTANDING",
    ]);
  const currencyOf = new Map(
    definition.lines.flatMap((l) =>
      "currency" in l && l.currency ? [[l.code, l.currency] as const] : [],
    ),
  );
  for (const period of input.spread ?? []) {
    const p = run.months.findIndex(
      (m) => m.end === period.end && m.quality !== null,
    );
    if (p === -1) continue;
    const month = run.months[p]!.month;
    for (const [item, codes] of parts) {
      const figure = period.figure(item);
      if (figure === undefined) continue;
      let total = new Dec(0);
      for (const code of codes) {
        const value = run.cells[code]?.[p]?.value;
        if (value === null || value === undefined) continue;
        const currency = currencyOf.get(code);
        const rate = currency ? run.cells[fxCode(currency)]?.[p]?.value : "1";
        total = total.plus(new Dec(value).times(rate ?? 0));
      }
      const spread = new Dec(figure);
      const gap = total.minus(spread);
      if (
        gap.abs().gt(TOLERANCE) &&
        gap.abs().gt(spread.abs().times(RECONCILE_SHARE))
      )
        flag(month, {
          severity: "warning",
          code: "spread_gap",
          itemCode: item,
          message: `The lines that are part of ${input.labels?.get(item) ?? item} add up to ${show(total)} at ${period.end}, but the spread's is ${show(spread)}${spread.isZero() ? "" : `, ${gap.div(spread.abs()).times(100).abs().toFixed(1)}% apart`}.`,
        });
    }
  }
  return { general, byMonth };
}
