"use client";

import type {
  BorrowingBaseCycle,
  BorrowingBaseIssues,
  BorrowingBaseMonth,
  BorrowingBaseRun,
  CycleFigure,
  CycleSummary,
  LineageRef,
  ResultCell,
  ResultValue,
  TestResult,
  WaterfallRow,
} from "@finance/domain";
import {
  TOTALS,
  type BorrowingBaseDefinition,
  type BorrowingBaseFormat,
} from "@finance/domain/borrowing-bases";
import { monthNumber, termIn, type Term } from "@finance/domain/terms";
import { ChevronDown, ChevronRight, ClipboardList } from "lucide-react";
import Link from "next/link";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IssueList, IssuesSummary } from "@/components/issue-list";
import { Badge, Card, EmptyState, Stat, plural } from "@/components/page";
import { badge, button } from "@/components/styles";
import { Modal } from "@/components/ui";
import {
  describeMonth,
  fiscalMonths,
  QUALITY,
  showFigure,
  type Figure,
} from "@/lib/borrowing-bases";
import { describeMonths, describeTerm, MONTHS } from "@/lib/credit-lines";
import { formatDate, formatFigure } from "@/lib/format";

const SOURCES: Partial<Record<LineageRef["source"], string>> = {
  calculation: "Calculation",
  assumption: "Assumption",
  entered: "Entered",
  term: "Terms",
  blank: "Blank",
};

// A term of the line or its borrowing base, by the code the engine reads:
// an advance rate (AR.RATE), a cap, a reserve's amount, or the limit.
function termsOf(definition: BorrowingBaseDefinition, limit: Term) {
  const terms = new Map<string, { term: Term; format: "amount" | "percent" }>([
    ["BB_LIMIT", { term: limit, format: "amount" }],
  ]);
  for (const line of definition.lines) {
    if (line.kind === "collateral") {
      terms.set(`${line.code}.RATE`, { term: line.rate, format: "percent" });
      if (line.cap)
        terms.set(`${line.code}.CAP`, { term: line.cap, format: "amount" });
    }
    if (line.kind === "group" && line.cap)
      terms.set(`${line.code}.CAP`, { term: line.cap, format: "amount" });
    if (line.kind === "reserve" && line.amount)
      terms.set(line.code, { term: line.amount, format: "amount" });
  }
  return terms;
}

// Which step or season of a term applied in a month.
function applied(term: Term, month: string) {
  const { from, season } = termIn(term, monthNumber(month));
  return [
    from ? `from ${describeMonth(from)}` : "from the start",
    ...(season ? [`${describeMonths(season)} season`] : []),
  ].join(" · ");
}

// The borrowing base's history: the latest month at a glance, its tests,
// the business cycle by fiscal year and over the last twelve months, the
// seasonal profile, then the waterfall month by month. Columns group by
// fiscal year, each folding away; a line's detail rows (aging,
// ineligibles, eligible, rate, cap) fold under it. Every figure opens its
// lineage.
export function BorrowingBaseResults({
  run,
  issues,
  years,
  definition,
  limit,
  months,
  cycle,
  yearEndMonth,
  figures,
}: {
  run: BorrowingBaseRun;
  issues: BorrowingBaseIssues;
  // Each month's fiscal year, as the columns group.
  years: string[];
  definition: BorrowingBaseDefinition;
  limit: Term;
  months: BorrowingBaseMonth[];
  cycle: BorrowingBaseCycle;
  // The borrower's fiscal year end, 1 to 12.
  yearEndMonth: number;
  figures: Figure[];
}) {
  const [trail, setTrail] = useState<{ code: string; period: number }[]>([]);
  const terms = useMemo(() => termsOf(definition, limit), [definition, limit]);
  const latest = run.months.findLastIndex((m) => m.quality !== null);
  const flagged = run.months.filter((m) => issues.byMonth[m.month]?.length);

  if (latest === -1)
    return (
      <EmptyState
        icon={<ClipboardList />}
        title="No certificates yet."
        actions={
          <Link href="?tab=data" className={button.primary}>
            Enter the first month
          </Link>
        }
      >
        Paste the client&apos;s certificates, one month or a history, or type
        the figures in. Results show here month by month.
      </EmptyState>
    );

  const value = (code: string, p: number) => run.cells[code]?.[p]?.value;
  const month = run.months[latest]!;
  const received = months.find((m) => m.month === month.month)?.receivedOn;
  const surplus = value("BB_SURPLUS", latest);
  const amount = (raw: string | null | undefined) =>
    raw === null || raw === undefined ? "–" : formatFigure(raw, "amount");

  return (
    <div className="flex flex-col gap-4">
      <Card
        title={`${describeMonth(month.month)} · ${QUALITY[month.quality!]}`}
        description={
          received
            ? `The latest certificate, received ${formatDate(received)}.`
            : "The latest certificate."
        }
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-5">
          <Stat
            label="Borrowing base"
            value={amount(value("BB_TOTAL", latest))}
            detail={`Limit ${amount(value("BB_LIMIT", latest))}`}
          />
          <Stat label="Usage" value={amount(value("BB_USAGE", latest))} />
          <Stat
            label="Margin surplus (deficit)"
            value={amount(surplus)}
            tone={
              surplus === null || surplus === undefined
                ? undefined
                : Number(surplus) < 0
                  ? "danger"
                  : "success"
            }
          />
          <Stat
            label="Excess availability"
            value={amount(value("BB_EXCESS", latest))}
            detail="Availability less usage"
          />
          <Stat
            label="Utilization"
            value={
              value("BB_UTILIZATION", latest)
                ? formatFigure(value("BB_UTILIZATION", latest)!, "percent")
                : "–"
            }
            detail="Usage over the limit"
          />
        </div>
      </Card>

      {(issues.general.length > 0 || flagged.length > 0) && (
        <IssuesSummary
          issues={[
            ...issues.general,
            ...flagged.flatMap((m) => issues.byMonth[m.month]!),
          ]}
          note="Checks on the certificates. They flag problems; nothing is blocked."
        >
          <div className="flex flex-col gap-4">
            {issues.general.length > 0 && <IssueList issues={issues.general} />}
            {flagged.map((m) => (
              <div key={m.month} className="flex flex-col gap-1.5">
                <p className="text-xs font-semibold text-muted">
                  {describeMonth(m.month)}
                </p>
                <IssueList issues={issues.byMonth[m.month]!} />
              </div>
            ))}
          </div>
        </IssuesSummary>
      )}

      <TestsCard
        tests={run.tests}
        latest={latest}
        month={month.month}
        last12={cycle.last12}
        figures={figures}
      />

      <CycleCard cycle={cycle} tests={run.tests} yearEndMonth={yearEndMonth} />

      <SeasonalCard cycle={cycle} yearEndMonth={yearEndMonth} />

      <MonthlyTable
        run={run}
        issues={issues}
        years={years}
        failed={cycle.last12?.failed ?? {}}
        onOpen={(code, period) => setTrail([{ code, period }])}
      />

      <Lineage trail={trail} onTrail={setTrail} run={run} terms={terms} />
    </div>
  );
}

const amountOf = (raw: string | null | undefined) =>
  raw === null || raw === undefined ? "–" : formatFigure(raw, "amount");

// Each test at the latest month: the figure, the threshold that applied,
// the room left and whether it passed; and how many months it failed over
// the last twelve.
function TestsCard({
  tests,
  latest,
  month,
  last12,
  figures,
}: {
  tests: TestResult[];
  latest: number;
  month: string;
  last12: CycleSummary | null;
  figures: Figure[];
}) {
  const figure = (code: string) => figures.find((f) => f.code === code);
  return (
    <Card
      flush
      title="Tests"
      description={`${describeMonth(month)}, and months failed over the last 12 with a certificate. Custom tests are set in Terms.`}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2/50 text-left text-xs text-muted">
              <th className="px-4 py-2 font-medium">Test</th>
              <th className="px-3 py-2 font-medium">Figure</th>
              <th className="px-3 py-2 text-right font-medium">Actual</th>
              <th className="px-3 py-2 text-right font-medium">Threshold</th>
              <th className="px-3 py-2 text-right font-medium">Room</th>
              <th className="px-3 py-2 font-medium">Result</th>
              <th className="px-4 py-2 text-right font-medium">
                Failed, 12 mo
              </th>
            </tr>
          </thead>
          <tbody>
            {tests.map((test) => {
              const result = test.months[latest];
              const f = figure(test.metric);
              const format = f?.format ?? "amount";
              const failed = last12?.failed[test.id] ?? 0;
              const show = (raw: string | null | undefined) =>
                raw === null || raw === undefined
                  ? "–"
                  : showFigure(raw, format, test.metric);
              return (
                <tr
                  key={test.id}
                  className="border-b border-line/70 last:border-b-0"
                >
                  <td className="px-4 py-2 font-medium whitespace-nowrap">
                    {test.name}
                    {test.builtIn && (
                      <span className="ml-2 text-xs font-normal text-muted">
                        Built in
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {f?.label ?? test.metric}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {show(result?.value)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    <span className="text-xs text-muted">
                      {test.test === "min" ? "at least " : "at most "}
                    </span>
                    {show(result?.threshold)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${result?.margin && Number(result.margin) < 0 ? "text-danger" : ""}`}
                  >
                    {show(result?.margin)}
                  </td>
                  <td className="px-3 py-2">
                    {result?.pass === true && (
                      <Badge tone="success">Pass</Badge>
                    )}
                    {result?.pass === false && (
                      <Badge tone="danger">Fail</Badge>
                    )}
                  </td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums ${failed ? "font-medium text-danger" : "text-muted"}`}
                  >
                    {failed}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Months from one to another: "Jan–Dec 2024", "Apr 2024–Mar 2025".
const span = (from: string, to: string) =>
  from.slice(0, 4) === to.slice(0, 4)
    ? `${MONTHS[Number(from.slice(5, 7)) - 1]}–${describeMonth(to)}`
    : `${describeMonth(from)}–${describeMonth(to)}`;

// Fiscal years as "FY2024", or "2024" when the year ends in December.
const yearLabel = (label: string, yearEndMonth: number) =>
  yearEndMonth === 12 ? label.replace(/^FY/, "") : label;

// The business cycle (borrowing-base-plan.md §6.2): by fiscal year and over
// the last twelve months, how high usage peaked, how low it fell, how thin
// the margin got. The lowest usage over a year is the part of the line
// never repaid.
function CycleCard({
  cycle,
  tests,
  yearEndMonth,
}: {
  cycle: BorrowingBaseCycle;
  tests: TestResult[];
  yearEndMonth: number;
}) {
  const columns = [
    ...cycle.years.map((y) => ({
      summary: y,
      label: yearLabel(y.label, yearEndMonth),
      last: false,
    })),
    ...(cycle.last12
      ? [{ summary: cycle.last12, label: "Last 12 months", last: true }]
      : []),
  ];
  const when = (figure: CycleFigure | null) =>
    figure && (
      <span className="block text-[11px] text-muted">
        {describeMonth(figure.month)}
      </span>
    );
  const rows: {
    label: string;
    help?: string;
    cell: (s: CycleSummary) => ReactNode;
    tone?: (s: CycleSummary) => string;
  }[] = [
    {
      label: "Peak usage",
      cell: (s) => (
        <>
          {amountOf(s.peakUsage?.value)}
          {when(s.peakUsage)}
        </>
      ),
    },
    { label: "Average usage", cell: (s) => amountOf(s.averageUsage) },
    {
      label: "Lowest usage",
      help: "The part of the line never repaid over the period. When it stays high, the line funds permanent working capital.",
      cell: (s) => (
        <>
          {amountOf(s.lowestUsage?.value)}
          {when(s.lowestUsage)}
        </>
      ),
    },
    {
      label: "Highest utilization",
      cell: (s) => (
        <>
          {s.highestUtilization
            ? formatFigure(s.highestUtilization.value, "percent")
            : "–"}
          {when(s.highestUtilization)}
        </>
      ),
    },
    {
      label: "Average borrowing base",
      cell: (s) => amountOf(s.averageBorrowingBase),
    },
    {
      label: "Lowest borrowing base",
      cell: (s) => (
        <>
          {amountOf(s.lowestBorrowingBase?.value)}
          {when(s.lowestBorrowingBase)}
        </>
      ),
    },
    {
      label: "Lowest surplus",
      cell: (s) => (
        <>
          {amountOf(s.lowestSurplus?.value)}
          {when(s.lowestSurplus)}
        </>
      ),
      tone: (s) =>
        s.lowestSurplus && Number(s.lowestSurplus.value) < 0
          ? "text-danger"
          : "",
    },
    ...tests.map((test) => ({
      label:
        test.id === "margin"
          ? "Months in deficit"
          : `Months failed: ${test.name}`,
      cell: (s: CycleSummary) => s.failed[test.id] ?? 0,
      tone: (s: CycleSummary) =>
        s.failed[test.id] ? "font-medium text-danger" : "text-muted",
    })),
  ];
  if (!columns.length) return null;
  return (
    <Card
      flush
      title="Business cycle"
      description="By fiscal year, and over the last 12 months. Months without a certificate aren't counted."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2/50 text-xs text-muted">
              <th className="min-w-56 px-4 py-2 text-left font-medium" />
              {columns.map((c) => (
                <th
                  key={c.label}
                  className={`min-w-36 px-3 py-2 text-right align-top font-normal whitespace-nowrap ${c.last ? "bg-accent-soft/40" : ""}`}
                >
                  <span className="block font-medium text-foreground">
                    {c.label}
                  </span>
                  {span(c.summary.from, c.summary.to)}
                  <span className="block">
                    {plural(c.summary.months, "certificate")}
                  </span>
                </th>
              ))}
              <th className="w-full" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.label}
                className="border-b border-line/70 last:border-b-0"
              >
                <td className="px-4 py-1.5 whitespace-nowrap" title={row.help}>
                  {row.label}
                </td>
                {columns.map((c) => (
                  <td
                    key={c.label}
                    className={`px-3 py-1.5 text-right align-top tabular-nums ${c.last ? "bg-accent-soft/40" : ""} ${row.tone?.(c.summary) ?? ""}`}
                  >
                    {row.cell(c.summary)}
                  </td>
                ))}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Each calendar month's average over the years with a certificate that
// month, in fiscal year order: where the line peaks in the year.
function SeasonalCard({
  cycle,
  yearEndMonth,
}: {
  cycle: BorrowingBaseCycle;
  yearEndMonth: number;
}) {
  const order = fiscalMonths(yearEndMonth);
  const byMonth = new Map(cycle.seasonal.map((m) => [m.month, m]));
  const rows = [
    { label: "Usage", pick: (m: (typeof cycle.seasonal)[number]) => m.usage },
    {
      label: "Borrowing base",
      pick: (m: (typeof cycle.seasonal)[number]) => m.borrowingBase,
    },
    {
      label: "Surplus",
      pick: (m: (typeof cycle.seasonal)[number]) => m.surplus,
    },
  ];
  if (!cycle.seasonal.some((m) => m.years > 0)) return null;
  return (
    <Card
      flush
      title="Seasonal profile"
      description="Each calendar month's average over the years with a certificate that month."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line bg-surface-2/50 text-muted">
              <th className="px-4 py-2 text-left font-medium" />
              {order.map((m) => (
                <th key={m} className="px-2 py-2 text-right font-medium">
                  {MONTHS[m - 1]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-line/70">
                <td className="px-4 py-1.5 text-sm whitespace-nowrap">
                  {row.label}
                </td>
                {order.map((m) => {
                  const raw = byMonth.get(m) && row.pick(byMonth.get(m)!);
                  return (
                    <td
                      key={m}
                      className={`px-2 py-1.5 text-right ${raw && Number(raw) < 0 ? "text-danger" : ""}`}
                    >
                      {amountOf(raw)}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="text-muted">
              <td className="px-4 py-1.5 whitespace-nowrap">Years</td>
              {order.map((m) => (
                <td key={m} className="px-2 py-1.5 text-right">
                  {byMonth.get(m)?.years ?? 0}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Each detail row's line: the nearest line above it, less indented, in its
// section. Rows with none, such as collateral before ineligibles, always
// show.
function parentsOf(rows: readonly WaterfallRow[]) {
  const parents = new Map<string, string>();
  rows.forEach((row, i) => {
    if (row.kind !== "detail") return;
    for (let j = i - 1; j >= 0; j--) {
      const above = rows[j]!;
      if (above.kind === "section") break;
      if (above.kind === "line" && above.depth < row.depth) {
        parents.set(row.code, above.code);
        break;
      }
    }
  });
  return parents;
}

type Column = { p: number } | { fold: string; count: number };

function MonthlyTable({
  run,
  issues,
  years,
  failed,
  onOpen,
}: {
  run: BorrowingBaseRun;
  issues: BorrowingBaseIssues;
  years: string[];
  // Months each test failed over the last twelve, by test id.
  failed: Record<string, number>;
  onOpen: (code: string, period: number) => void;
}) {
  const parents = useMemo(() => parentsOf(run.rows), [run.rows]);
  const foldable = useMemo(() => new Set(parents.values()), [parents]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [folded, setFolded] = useState<string[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  // The latest months in view: the history scrolls back to the left.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  const groups = years.reduce<{ label: string; indexes: number[] }[]>(
    (list, label, p) => {
      const last = list.at(-1);
      if (last?.label === label) last.indexes.push(p);
      else list.push({ label, indexes: [p] });
      return list;
    },
    [],
  );
  const columns = groups.flatMap((g): Column[] =>
    folded.includes(g.label)
      ? [{ fold: g.label, count: g.indexes.length }]
      : g.indexes.map((p) => ({ p })),
  );
  const formats = new Map(run.rows.map((r) => [r.code, r.format]));
  const allOpen = open.size === foldable.size && foldable.size > 0;

  const toggleYear = (label: string) =>
    setFolded((list) =>
      list.includes(label) ? list.filter((l) => l !== label) : [...list, label],
    );
  const toggleLine = (code: string) =>
    setOpen((set) => {
      const next = new Set(set);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const shown = run.rows.filter((row) => {
    const parent = parents.get(row.code);
    return !parent || open.has(parent);
  });
  const foldCell = (key: string) => (
    <td
      key={key}
      className="w-6 min-w-6 border-b border-l border-line/60 bg-surface-2"
    />
  );

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">Month by month</h2>
        <p className="text-xs text-muted">
          Click a figure to see how it was computed.
        </p>
        {foldable.size > 0 && (
          <button
            type="button"
            className={`${button.ghost} ml-auto px-2 py-1 text-xs`}
            onClick={() => setOpen(allOpen ? new Set() : new Set(foldable))}
          >
            {allOpen ? "Hide details" : "Show details"}
          </button>
        )}
      </div>
      <div ref={scroller} className="max-h-[min(78vh,64rem)] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-xs">
              <th className="sticky top-0 left-0 z-30 h-7 border-b border-line bg-surface" />
              {groups.map((g) => {
                const isFolded = folded.includes(g.label);
                return (
                  <th
                    key={g.label}
                    colSpan={isFolded ? 1 : g.indexes.length}
                    className="sticky top-0 z-10 h-7 border-b border-l border-line bg-surface px-1.5 text-left font-medium"
                  >
                    <button
                      type="button"
                      aria-expanded={!isFolded}
                      onClick={() => toggleYear(g.label)}
                      className="sticky left-[12.75rem] flex items-center gap-1 rounded px-1 whitespace-nowrap text-muted hover:bg-surface-2 hover:text-foreground sm:left-[20.75rem]"
                      title={
                        isFolded ? "Show these months" : "Fold these months"
                      }
                    >
                      <span aria-hidden>{isFolded ? "▸" : "▾"}</span>
                      {g.label}
                      {isFolded && (
                        <span className="font-normal">
                          ({g.indexes.length})
                        </span>
                      )}
                    </button>
                  </th>
                );
              })}
              <th className="sticky top-0 border-b border-line bg-surface" />
            </tr>
            <tr className="text-xs text-muted">
              <th className="sticky top-7 left-0 z-30 w-48 max-w-48 min-w-48 border-b border-line bg-surface px-4 py-2 text-left font-medium sm:w-80 sm:max-w-80 sm:min-w-80">
                Line
              </th>
              {columns.map((column) => {
                if ("fold" in column)
                  return (
                    <th
                      key={`fold:${column.fold}`}
                      className="sticky top-7 z-10 w-6 min-w-6 border-b border-l border-line bg-surface-2"
                    />
                  );
                const m = run.months[column.p]!;
                const list = issues.byMonth[m.month] ?? [];
                return (
                  <th
                    key={m.month}
                    title={list.map((i) => i.message).join("\n") || undefined}
                    className="sticky top-7 z-10 w-28 min-w-28 border-b border-l border-line bg-surface px-2.5 py-1.5 text-right align-top font-normal"
                  >
                    <span className="flex items-center justify-end gap-1.5 font-medium whitespace-nowrap text-foreground">
                      {list.length > 0 && (
                        <span
                          className={`size-1.5 rounded-full ${list.some((i) => i.severity === "error") ? "bg-danger" : "bg-warning"}`}
                          aria-label="has checks"
                        />
                      )}
                      {describeMonth(m.month)}
                    </span>
                    <span className={m.quality ? "" : "italic"}>
                      {m.quality ? QUALITY[m.quality] : "No certificate"}
                    </span>
                  </th>
                );
              })}
              <th className="sticky top-7 w-full border-b border-line bg-surface" />
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              if (row.kind === "section")
                return (
                  <tr key={row.code}>
                    <td className="sticky left-0 z-20 border-b border-line/60 bg-surface px-4 pt-4 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                      {row.label}
                    </td>
                    <td
                      colSpan={columns.length + 1}
                      className="border-b border-line/60"
                    />
                  </tr>
                );
              const group = row.kind === "line" && row.lineKind === "group";
              const strong = row.kind === "subtotal" || row.kind === "total";
              const band =
                row.kind === "total"
                  ? "bg-surface-2 font-semibold"
                  : row.kind === "subtotal"
                    ? "bg-surface-2/60 font-medium"
                    : "";
              const sticky = strong ? "bg-surface-2" : "bg-surface";
              const canFold = foldable.has(row.code);
              const isOpen = open.has(row.code);
              return (
                <tr key={row.code} className={band}>
                  <td
                    title={row.help ? `${row.code} · ${row.help}` : row.code}
                    style={{ paddingLeft: 12 + row.depth * 16 }}
                    className={`sticky left-0 z-20 max-w-48 border-b border-line/60 py-1 pr-3 sm:max-w-80 ${sticky} ${row.kind === "detail" ? "text-muted" : ""} ${group ? "font-medium" : ""}`}
                  >
                    <span className="flex min-w-0 items-center gap-1">
                      {canFold ? (
                        <button
                          type="button"
                          onClick={() => toggleLine(row.code)}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Hide" : "Show"} ${row.label}'s details`}
                          className="-ml-1 rounded text-muted hover:bg-surface-2 hover:text-foreground"
                        >
                          {isOpen ? (
                            <ChevronDown className="size-3.5" aria-hidden />
                          ) : (
                            <ChevronRight className="size-3.5" aria-hidden />
                          )}
                        </button>
                      ) : (
                        <span className="w-3.5 shrink-0" />
                      )}
                      <span className="truncate">{row.label}</span>
                      {row.currency && (
                        <span className="rounded bg-surface-2 px-1 text-[11px] font-normal text-muted">
                          {row.currency}
                        </span>
                      )}
                    </span>
                  </td>
                  {columns.map((column) => {
                    if ("fold" in column)
                      return foldCell(`fold:${column.fold}`);
                    const p = column.p;
                    const m = run.months[p]!;
                    const cell = run.cells[row.code]?.[p];
                    const gap = m.quality === null;
                    return (
                      <td
                        key={m.month}
                        className={`border-b border-l border-line/60 p-0 text-right tabular-nums ${gap ? "bg-surface-2/50" : ""}`}
                      >
                        {group || !cell ? null : (
                          <button
                            type="button"
                            onClick={() => onOpen(row.code, p)}
                            className="block w-full px-2.5 py-1 text-right whitespace-nowrap hover:bg-accent-soft/60"
                            title="Show how this was computed"
                          >
                            <Figure
                              cell={cell}
                              format={row.format}
                              code={row.code}
                              entered={row.entered}
                            />
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="border-b border-line/60" />
                </tr>
              );
            })}
            {run.tests.length > 0 && (
              <tr>
                <td className="sticky left-0 z-20 border-b border-line/60 bg-surface px-4 pt-4 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                  Tests
                </td>
                <td
                  colSpan={columns.length + 1}
                  className="border-b border-line/60"
                />
              </tr>
            )}
            {run.tests.map((test) => (
              <tr key={test.id}>
                <td
                  title={test.metric}
                  className="sticky left-0 z-20 max-w-48 border-b border-line/60 bg-surface py-1 pr-3 pl-[30px] sm:max-w-80"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{test.name}</span>
                    {(failed[test.id] ?? 0) > 0 && (
                      <span
                        className={badge("danger")}
                        title="Months failed over the last 12"
                      >
                        {failed[test.id]} in 12 mo
                      </span>
                    )}
                  </span>
                </td>
                {columns.map((column) => {
                  if ("fold" in column) return foldCell(`fold:${column.fold}`);
                  const result = test.months[column.p];
                  const format = formats.get(test.metric) ?? "amount";
                  return (
                    <td
                      key={run.months[column.p]!.month}
                      title={
                        result?.threshold
                          ? `${test.test === "min" ? "At least" : "At most"} ${formatFigure(result.threshold, format)}${result.margin ? ` · room ${formatFigure(result.margin, format)}` : ""}`
                          : undefined
                      }
                      className="border-b border-l border-line/60 px-2.5 py-1 text-right text-xs"
                    >
                      {result?.pass === true && (
                        <span className="text-success">Pass</span>
                      )}
                      {result?.pass === false && (
                        <span className={badge("danger")}>Fail</span>
                      )}
                    </td>
                  );
                })}
                <td className="border-b border-line/60" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Surpluses and availability below zero show in red: the line is short.
const SHORT = new Set(["BB_SURPLUS", "BB_EXCESS"]);

function Figure({
  cell,
  format,
  code,
  entered = false,
  plain = false,
}: {
  cell: ResultValue;
  format: BorrowingBaseFormat;
  code: string;
  entered?: boolean;
  plain?: boolean;
}) {
  if (cell.error) {
    return (
      <span
        className="font-mono text-xs text-warning"
        title={cell.error.message}
      >
        {cell.error.code === "#N/A" ? "n/a" : cell.error.code}
      </span>
    );
  }
  if (cell.value === null)
    return <span className="text-muted">{entered ? "" : "–"}</span>;
  const short = !plain && SHORT.has(code) && Number(cell.value) < 0;
  return (
    <span className={short ? "text-danger" : ""}>
      {showFigure(cell.value, format, code)}
    </span>
  );
}

function Lineage({
  trail,
  onTrail,
  run,
  terms,
}: {
  trail: { code: string; period: number }[];
  onTrail: (trail: { code: string; period: number }[]) => void;
  run: BorrowingBaseRun;
  terms: Map<string, { term: Term; format: "amount" | "percent" }>;
}) {
  const current = trail.at(-1);
  const rows = new Map(run.rows.map((r) => [r.code, r]));
  const labelOf = (code: string, fallback?: string) =>
    rows.get(code)?.label ?? fallback ?? code;
  const formatOf = (code: string): BorrowingBaseFormat =>
    rows.get(code)?.format ??
    TOTALS.find((t) => t.code === code)?.format ??
    (code.endsWith(".RATE") ? "percent" : "amount");
  const cell: ResultCell | undefined = current
    ? run.cells[current.code]?.[current.period]
    : undefined;
  const month = current ? run.months[current.period] : undefined;
  const term = current ? terms.get(current.code) : undefined;
  const row = current ? rows.get(current.code) : undefined;

  return (
    <Modal
      side
      open={trail.length > 0}
      onClose={() => onTrail([])}
      title="How this was computed"
    >
      {current && cell && month && (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          {trail.length > 1 && (
            <button
              type="button"
              className={`${button.ghost} self-start`}
              onClick={() => onTrail(trail.slice(0, -1))}
            >
              ← Back
            </button>
          )}
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted">
              {describeMonth(month.month)} ·{" "}
              {month.quality ? QUALITY[month.quality] : "No certificate"}
            </p>
            <p className="text-lg font-semibold">{labelOf(current.code)}</p>
            <p className="font-mono text-xs text-muted">{current.code}</p>
            <p className="text-2xl tabular-nums">
              <Figure
                cell={cell}
                format={formatOf(current.code)}
                code={current.code}
                plain
              />
            </p>
            {cell.error && (
              <p className="text-sm text-warning">{cell.error.message}</p>
            )}
            {row?.help && <p className="text-sm text-muted">{row.help}</p>}
          </div>
          {term ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted">From the terms</p>
              <p className="rounded-md bg-surface-2 px-3 py-2 text-sm tabular-nums">
                {describeTerm(term.term, term.format)}
              </p>
              <p className="text-xs text-muted">
                In force {applied(term.term, month.month)}.
              </p>
            </div>
          ) : cell.formula ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted">Formula</p>
              <code className="rounded-md bg-surface-2 px-3 py-2 font-mono text-xs break-words">
                {cell.formula}
              </code>
            </div>
          ) : row?.entered ? (
            <p className="text-sm text-muted">
              {cell.value === null
                ? "Not entered for this month."
                : "Entered from the client's certificate."}
            </p>
          ) : null}
          {cell.refs.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted">Reads</p>
              <ul className="divide-y divide-line rounded-md border border-line">
                {cell.refs.map((ref, i) => {
                  const refMonth = run.months[ref.period];
                  const refTerm = terms.get(ref.code);
                  const drillable =
                    (ref.source === "calculation" || ref.source === "term") &&
                    run.cells[ref.code]?.[ref.period];
                  const content = (
                    <>
                      <span className="flex min-w-0 flex-col items-start">
                        <span className="truncate">
                          {labelOf(ref.code, ref.label)}
                        </span>
                        <span className="text-xs text-muted">
                          <span className="font-mono">{ref.code}</span>
                          {refMonth && ref.period !== current.period
                            ? ` · ${describeMonth(refMonth.month)}`
                            : ""}{" "}
                          · {SOURCES[ref.source] ?? ref.source}
                          {refTerm && refMonth
                            ? `, ${applied(refTerm.term, refMonth.month)}`
                            : ""}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        <Figure
                          cell={ref}
                          format={formatOf(ref.code)}
                          code={ref.code}
                          plain
                        />
                      </span>
                    </>
                  );
                  return (
                    <li key={i}>
                      {drillable ? (
                        <button
                          type="button"
                          onClick={() =>
                            onTrail([
                              ...trail,
                              { code: ref.code, period: ref.period },
                            ])
                          }
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent-soft/60"
                        >
                          {content}
                        </button>
                      ) : (
                        <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          {content}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
