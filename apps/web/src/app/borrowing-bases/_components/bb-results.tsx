"use client";

import type {
  BorrowingBaseDefinition,
  BorrowingBaseFormat,
  BorrowingBaseIssues,
  BorrowingBaseMonth,
  BorrowingBaseRun,
  CycleSummary,
  LineageRef,
  ResultCell,
  ResultValue,
  Term,
  WaterfallRow,
} from "@finance/domain";
import { monthNumber, termIn } from "@finance/domain/terms";
import { ChevronDown, ChevronRight, ClipboardList } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { IssueList, IssuesSummary } from "@/components/issue-list";
import { Card, EmptyState, Stat, plural } from "@/components/page";
import { badge, button } from "@/components/styles";
import { Modal } from "@/components/ui";
import { describeMonth, QUALITY, showFigure } from "@/lib/borrowing-bases";
import { describeMonths, describeTerm } from "@/lib/credit-lines";
import { formatDate, formatFigure } from "@/lib/format";

const SOURCES: Partial<Record<LineageRef["source"], string>> = {
  calculation: "Calculation",
  assumption: "Assumption",
  entered: "Entered",
  term: "Terms",
  blank: "Blank",
};

type Totals = { code: string; label: string; format: BorrowingBaseFormat }[];

// The built-in tests, as the latest month's cards name them.
const TEST_LABELS: Record<string, string> = {
  margin: "Margin test",
  overline: "Overline test",
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

// The borrowing base's history: the latest month and the last twelve at a
// glance, then the waterfall month by month. Columns group by fiscal year,
// each folding away; a line's detail rows (aging, ineligibles, eligible,
// rate, cap) fold under it. Every figure opens its lineage.
export function BorrowingBaseResults({
  run,
  issues,
  years,
  definition,
  limit,
  totals,
  months,
  last12,
}: {
  run: BorrowingBaseRun;
  issues: BorrowingBaseIssues;
  // Each month's fiscal year, as the columns group.
  years: string[];
  definition: BorrowingBaseDefinition;
  limit: Term;
  totals: Totals;
  months: BorrowingBaseMonth[];
  last12: CycleSummary | null;
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
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 xl:grid-cols-7">
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
          {run.tests
            .filter((t) => t.builtIn)
            .map((test) => {
              const result = test.months[latest];
              return (
                <Stat
                  key={test.id}
                  label={TEST_LABELS[test.id] ?? test.name}
                  value={
                    result?.pass === null || result === undefined
                      ? "–"
                      : result.pass
                        ? "Pass"
                        : "Fail"
                  }
                  tone={
                    result?.pass === true
                      ? "success"
                      : result?.pass === false
                        ? "danger"
                        : undefined
                  }
                  detail={
                    result?.margin
                      ? Number(result.margin) < 0
                        ? `Short by ${amount(String(-Number(result.margin)))}`
                        : `Room of ${amount(result.margin)}`
                      : undefined
                  }
                />
              );
            })}
        </div>
      </Card>

      {last12 && last12.months > 1 && <LastTwelve summary={last12} />}

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

      <MonthlyTable
        run={run}
        issues={issues}
        years={years}
        onOpen={(code, period) => setTrail([{ code, period }])}
      />

      <Lineage
        trail={trail}
        onTrail={setTrail}
        run={run}
        terms={terms}
        totals={totals}
      />
    </div>
  );
}

function LastTwelve({ summary }: { summary: CycleSummary }) {
  const amount = (raw: string | null | undefined) =>
    raw === null || raw === undefined ? "–" : formatFigure(raw, "amount");
  const when = (figure: { month: string } | null) =>
    figure ? describeMonth(figure.month) : undefined;
  const lowest = summary.lowestSurplus;
  return (
    <Card
      title="Last 12 months"
      description={`${describeMonth(summary.from)} to ${describeMonth(summary.to)} · ${plural(summary.months, "certificate")}`}
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Peak usage"
          value={amount(summary.peakUsage?.value)}
          detail={when(summary.peakUsage)}
        />
        <Stat label="Average usage" value={amount(summary.averageUsage)} />
        <Stat
          label="Lowest usage"
          value={amount(summary.lowestUsage?.value)}
          detail={
            summary.lowestUsage && `${when(summary.lowestUsage)} · never repaid`
          }
        />
        <Stat
          label="Lowest surplus"
          value={amount(lowest?.value)}
          detail={when(lowest)}
          tone={lowest && Number(lowest.value) < 0 ? "danger" : undefined}
        />
        <Stat
          label="Months in deficit"
          value={summary.deficitMonths}
          tone={summary.deficitMonths ? "danger" : "success"}
        />
        <Stat
          label="Highest utilization"
          value={
            summary.highestUtilization
              ? formatFigure(summary.highestUtilization.value, "percent")
              : "–"
          }
          detail={when(summary.highestUtilization)}
        />
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
  onOpen,
}: {
  run: BorrowingBaseRun;
  issues: BorrowingBaseIssues;
  years: string[];
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
                  className="sticky left-0 z-20 border-b border-line/60 bg-surface py-1 pr-3 pl-[30px]"
                >
                  {test.name}
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
  totals,
}: {
  trail: { code: string; period: number }[];
  onTrail: (trail: { code: string; period: number }[]) => void;
  run: BorrowingBaseRun;
  terms: Map<string, { term: Term; format: "amount" | "percent" }>;
  totals: Totals;
}) {
  const current = trail.at(-1);
  const rows = new Map(run.rows.map((r) => [r.code, r]));
  const labelOf = (code: string, fallback?: string) =>
    rows.get(code)?.label ??
    totals.find((t) => t.code === code)?.label ??
    fallback ??
    code;
  const formatOf = (code: string): BorrowingBaseFormat =>
    rows.get(code)?.format ??
    totals.find((t) => t.code === code)?.format ??
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
