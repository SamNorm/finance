import { Dec } from "@finance/engine";
import { monthOf } from "../financing/amortization";
import { monthNumber } from "../credit-lines/terms";
import { monthEnd, type BorrowingBaseRun } from "./run";

// A line over its business cycle (borrowing-base-plan.md §6.2): by fiscal
// year and over the last twelve months, how high usage peaked, how low it
// fell, how thin the margin got; and each calendar month's average over the
// years, the seasonal profile.

export interface CycleFigure {
  value: string;
  month: string;
}

export interface CycleSummary {
  // "FY2024", or "Last 12 months".
  label: string;
  from: string;
  to: string;
  // Months with a certificate.
  months: number;
  peakUsage: CycleFigure | null;
  averageUsage: string | null;
  // The part of the line never repaid: when it stays high, the line funds
  // permanent working capital.
  lowestUsage: CycleFigure | null;
  lowestSurplus: CycleFigure | null;
  deficitMonths: number;
  highestUtilization: CycleFigure | null;
  averageBorrowingBase: string | null;
  lowestBorrowingBase: CycleFigure | null;
  // Months each test failed, by test id.
  failed: Record<string, number>;
}

export interface SeasonalMonth {
  // Calendar month, 1 to 12.
  month: number;
  // Fiscal years with a certificate that month.
  years: number;
  usage: string | null;
  borrowingBase: string | null;
  surplus: string | null;
}

export interface BorrowingBaseCycle {
  years: CycleSummary[];
  last12: CycleSummary | null;
  seasonal: SeasonalMonth[];
}

const mean = (values: InstanceType<typeof Dec>[]) =>
  values.length
    ? values
        .reduce((a, b) => a.plus(b), new Dec(0))
        .div(values.length)
        .toFixed()
    : null;

function summarize(
  run: BorrowingBaseRun,
  indexes: number[],
  label: string,
): CycleSummary {
  const at = (code: string, p: number) => {
    const raw = run.cells[code]?.[p]?.value;
    return raw === null || raw === undefined ? null : new Dec(raw);
  };
  const counted = indexes.filter((p) => run.months[p]!.quality);
  const extreme = (code: string, pick: "min" | "max"): CycleFigure | null => {
    let best: { value: InstanceType<typeof Dec>; p: number } | null = null;
    for (const p of counted) {
      const value = at(code, p);
      if (!value) continue;
      if (
        !best ||
        (pick === "max" ? value.gt(best.value) : value.lt(best.value))
      )
        best = { value, p };
    }
    return (
      best && { value: best.value.toFixed(), month: run.months[best.p]!.month }
    );
  };
  const values = (code: string) => counted.flatMap((p) => at(code, p) ?? []);
  const failed = Object.fromEntries(
    run.tests.map((t) => [
      t.id,
      counted.filter((p) => t.months[p]?.pass === false).length,
    ]),
  );
  return {
    label,
    from: run.months[indexes[0]!]!.month,
    to: run.months[indexes.at(-1)!]!.month,
    months: counted.length,
    peakUsage: extreme("BB_USAGE", "max"),
    averageUsage: mean(values("BB_USAGE")),
    lowestUsage: extreme("BB_USAGE", "min"),
    lowestSurplus: extreme("BB_SURPLUS", "min"),
    deficitMonths: failed.margin ?? 0,
    highestUtilization: extreme("BB_UTILIZATION", "max"),
    averageBorrowingBase: mean(values("BB_TOTAL")),
    lowestBorrowingBase: extreme("BB_TOTAL", "min"),
    failed,
  };
}

// The fiscal year a month falls in, by its end month: with a March year end,
// April 2024 to March 2025 is FY2025.
export const fiscalYearOf = (month: string, yearEndMonth: number) => {
  const year = Number(month.slice(0, 4));
  return Number(month.slice(5, 7)) > yearEndMonth ? year + 1 : year;
};

export function borrowingBaseCycle(
  run: BorrowingBaseRun,
  // The borrower's fiscal year end month, 1 to 12.
  yearEndMonth = 12,
): BorrowingBaseCycle {
  const byYear = new Map<number, number[]>();
  run.months.forEach((m, p) => {
    const year = fiscalYearOf(m.month, yearEndMonth);
    byYear.set(year, [...(byYear.get(year) ?? []), p]);
  });
  const years = [...byYear.entries()]
    .filter(([, indexes]) => indexes.some((p) => run.months[p]!.quality))
    .map(([year, indexes]) => summarize(run, indexes, `FY${year}`));
  const last = run.months.findLastIndex((m) => m.quality);
  const last12 =
    last === -1
      ? null
      : summarize(
          run,
          run.months.map((_, p) => p).filter((p) => p > last - 12 && p <= last),
          "Last 12 months",
        );
  const seasonal = Array.from({ length: 12 }, (_, i): SeasonalMonth => {
    const indexes = run.months
      .map((m, p) => ({ m, p }))
      .filter(({ m }) => m.quality && Number(m.month.slice(5, 7)) === i + 1)
      .map(({ p }) => p);
    const average = (code: string) =>
      mean(
        indexes.flatMap((p) => {
          const raw = run.cells[code]?.[p]?.value;
          return raw === null || raw === undefined ? [] : [new Dec(raw)];
        }),
      );
    return {
      month: i + 1,
      years: indexes.length,
      usage: average("BB_USAGE"),
      borrowingBase: average("BB_TOTAL"),
      surplus: average("BB_SURPLUS"),
    };
  });
  return { years, last12, seasonal };
}

// The months whose certificate is late on a day: due `days` after each
// month's end, after the last month received, up to twelve.
export function overdueMonths(
  lastMonth: string | null,
  days: number | null,
  asOf: string,
): string[] {
  if (!lastMonth || days === null) return [];
  const overdue: string[] = [];
  for (let m = monthNumber(lastMonth) + 1; overdue.length < 12; m++) {
    const month = monthOf(m);
    const due = new Date(`${monthEnd(month)}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + days);
    if (due.toISOString().slice(0, 10) >= asOf) break;
    overdue.push(month);
  }
  return overdue;
}

// Each calendar month's share of a typical month for a figure, from its
// last `years` years of certificates: the month's average over the year's,
// so 1.1 is a month 10% above. Null for a month never reported. It fills a
// seasonal assumption once, for the analyst to review (§8.3).
export function seasonalProfile(
  run: BorrowingBaseRun,
  code: string,
  years = 3,
): (string | null)[] {
  const reported = run.months
    .map((m, p) => ({ m, p }))
    .filter(({ m }) => m.quality)
    .slice(-12 * years);
  const byMonth = Array.from({ length: 12 }, (_, i) =>
    reported.flatMap(({ m, p }) => {
      const raw = run.cells[code]?.[p]?.value;
      return Number(m.month.slice(5, 7)) === i + 1 &&
        raw !== null &&
        raw !== undefined
        ? [new Dec(raw)]
        : [];
    }),
  ).map((values) => (values.length ? mean(values) : null));
  const known = byMonth.flatMap((v) => (v === null ? [] : [new Dec(v)]));
  const typical = mean(known);
  if (typical === null || new Dec(typical).isZero())
    return byMonth.map(() => null);
  return byMonth.map((v) =>
    v === null ? null : new Dec(v).div(typical).toDecimalPlaces(4).toFixed(),
  );
}
