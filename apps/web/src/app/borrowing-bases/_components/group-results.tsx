"use client";

import type { GroupMonth, Issue } from "@finance/domain";
import { ClipboardList } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { IssueList, IssuesSummary } from "@/components/issue-list";
import {
  MetricChart,
  type ChartPeriod,
  type ChartSeries,
} from "@/components/metric-chart";
import { Card, EmptyState, Stat } from "@/components/page";
import {
  describeMonth,
  GROUP_FIGURES,
  type GroupFigureKey,
} from "@/lib/borrowing-bases";
import { MONTHS } from "@/lib/credit-lines";
import { formatFigure } from "@/lib/format";

// A consolidated client's borrowing base month by month: its members'
// lines added up, adjusted, or replaced by a certificate for the group
// (borrowing-base-plan.md §7.5). Its latest month, its checks, and its
// figures over the months.

export interface GroupMember {
  key: string;
  name: string;
  member: { id: string; name: string };
  lineId: string;
}

// Where a month's figures come from.
export const sourceOf = (m: GroupMonth) =>
  m.override
    ? "Group certificate"
    : m.adjustments.length
      ? "Adjusted"
      : "Summed";

const figure = (m: GroupMonth, key: GroupFigureKey) =>
  m.consolidated[key] ?? null;

const amount = (raw: string | null | undefined) =>
  raw === null || raw === undefined ? "–" : formatFigure(raw, "amount");

export function GroupResults({
  months,
  members,
  issues,
}: {
  months: GroupMonth[];
  members: GroupMember[];
  // About the group as a whole, such as mixed currencies.
  issues: Issue[];
}) {
  const latest = months.at(-1);
  const flagged = months.filter((m) => m.issues.length);
  if (!latest)
    return (
      <EmptyState icon={<ClipboardList />} title="No certificates yet.">
        The group adds up its members&apos; certificates month by month. Enter
        them on each member line&apos;s page.
      </EmptyState>
    );
  const reported = Object.values(latest.members).filter(Boolean).length;
  const surplus = figure(latest, "surplus");
  return (
    <div className="flex flex-col gap-4">
      <Card
        title={`${describeMonth(latest.month)} · ${sourceOf(latest)}`}
        description={`The latest month: ${reported} of ${members.length} member ${members.length === 1 ? "line" : "lines"} with a certificate.`}
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-5">
          <Stat
            label="Borrowing base"
            value={amount(figure(latest, "total"))}
            detail={`Limits ${amount(figure(latest, "limit"))}`}
          />
          <Stat label="Usage" value={amount(figure(latest, "usage"))} />
          <Stat
            label="Margin surplus (deficit)"
            value={amount(surplus)}
            tone={
              surplus === null
                ? undefined
                : Number(surplus) < 0
                  ? "danger"
                  : "success"
            }
          />
          <Stat
            label="Excess availability"
            value={amount(figure(latest, "excess"))}
            detail="Availability less usage"
          />
          <Stat
            label="Utilization"
            value={
              figure(latest, "utilization") === null
                ? "–"
                : formatFigure(figure(latest, "utilization"), "percent")
            }
            detail="Usage over the limits"
          />
        </div>
      </Card>

      {(issues.length > 0 || flagged.length > 0) && (
        <IssuesSummary
          issues={[...issues, ...flagged.flatMap((m) => m.issues)]}
          note="Checks on the group. They flag problems; nothing is blocked."
        >
          <div className="flex flex-col gap-4">
            {issues.length > 0 && <IssueList issues={issues} />}
            {flagged.map((m) => (
              <div key={m.month} className="flex flex-col gap-1.5">
                <p className="text-xs font-semibold text-muted">
                  {describeMonth(m.month)}
                </p>
                <IssueList issues={m.issues} />
              </div>
            ))}
          </div>
        </IssuesSummary>
      )}

      <GroupTable months={months} />
    </div>
  );
}

// The consolidated figures, months as columns; a month opens its worksheet.
function GroupTable({ months }: { months: GroupMonth[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  // The latest months in view, as in a line's results.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">Month by month</h2>
        <p className="text-xs text-muted">
          The consolidated figures. Click a month to see what it adds up.
        </p>
      </div>
      <div ref={scroller} className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="sticky left-0 z-20 w-56 min-w-56 border-b border-line bg-surface px-4 py-2 text-left font-medium">
                Figure
              </th>
              {months.map((m) => (
                <th
                  key={m.month}
                  className="w-28 min-w-28 border-b border-l border-line p-0 text-right font-normal"
                >
                  <Link
                    href={`?tab=worksheet&month=${m.month}`}
                    className="flex flex-col items-end px-2.5 py-1.5 hover:bg-surface-2"
                    title="Open this month's worksheet"
                  >
                    <span className="flex items-center gap-1.5 font-medium whitespace-nowrap text-foreground">
                      {m.issues.length > 0 && (
                        <span
                          className="size-1.5 rounded-full bg-warning"
                          aria-label="has checks"
                        />
                      )}
                      {describeMonth(m.month)}
                    </span>
                    <span
                      className={
                        m.override
                          ? "text-accent"
                          : m.adjustments.length
                            ? "text-foreground"
                            : ""
                      }
                    >
                      {m.override
                        ? "Certificate"
                        : m.adjustments.length
                          ? "Adjusted"
                          : "Summed"}
                    </span>
                  </Link>
                </th>
              ))}
              <th className="w-full border-b border-line" />
            </tr>
          </thead>
          <tbody>
            {GROUP_FIGURES.map((row) => {
              const strong = row.kind !== "line";
              return (
                <tr
                  key={row.key}
                  className={
                    row.kind === "total"
                      ? "bg-surface-2 font-semibold"
                      : row.kind === "subtotal"
                        ? "bg-surface-2/60 font-medium"
                        : ""
                  }
                >
                  <td
                    className={`sticky left-0 z-10 border-b border-line/60 px-4 py-1 whitespace-nowrap ${strong ? "bg-surface-2" : "bg-surface"}`}
                  >
                    {row.label}
                  </td>
                  {months.map((m) => {
                    const raw = figure(m, row.key);
                    const short =
                      (row.key === "surplus" || row.key === "excess") &&
                      raw !== null &&
                      Number(raw) < 0;
                    return (
                      <td
                        key={m.month}
                        className={`border-b border-l border-line/60 px-2.5 py-1 text-right whitespace-nowrap tabular-nums ${short ? "text-danger" : ""}`}
                      >
                        {raw === null ? "–" : formatFigure(raw, row.format)}
                      </td>
                    );
                  })}
                  <td className="border-b border-line/60" />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// "2024-12" → "Dec-24".
const shortMonth = (month: string) =>
  `${MONTHS[Number(month.slice(5, 7)) - 1]}-${month.slice(2, 4)}`;

// The consolidated figures over the months, and the borrowing base by
// member line, as a line's charts show its own.
export function GroupCharts({
  months,
  members,
}: {
  months: GroupMonth[];
  members: GroupMember[];
}) {
  if (!months.length)
    return (
      <EmptyState icon={<ClipboardList />} title="No certificates yet.">
        Charts show once members&apos; certificates are in.
      </EmptyState>
    );
  const periods: ChartPeriod[] = months.map((m) => ({
    label: shortMonth(m.month),
    detail: `${describeMonth(m.month)} · ${sourceOf(m)}`,
    projected: false,
  }));
  const values = (key: GroupFigureKey) =>
    months.map((m) => {
      const raw = figure(m, key);
      return raw === null ? null : Number(raw);
    });
  const series = (
    keys: GroupFigureKey[],
    mark: "bar" | "line",
  ): ChartSeries[] =>
    keys.map((key) => ({
      label: GROUP_FIGURES.find((f) => f.key === key)!.label,
      mark,
      values: values(key),
    }));
  const limits = { label: "Authorized limits", values: values("limit") };
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <MetricChart
        title="Borrowing base and usage"
        format="amount"
        periods={periods}
        series={series(["total", "usage"], "bar")}
        threshold={limits}
        steps="by month"
      />
      <MetricChart
        title="Margin surplus and excess availability"
        format="amount"
        periods={periods}
        series={series(["surplus", "excess"], "line")}
      />
      <MetricChart
        title="Utilization"
        format="percent"
        periods={periods}
        series={series(["utilization"], "line")}
      />
      <MetricChart
        title="Borrowing base by member line"
        format="amount"
        periods={periods}
        stacked
        steps="by month"
        series={[
          ...members.map((member) => ({
            label: member.name,
            mark: "bar" as const,
            values: months.map((m) => {
              const raw = m.members[member.key]?.total;
              return raw === null || raw === undefined ? null : Number(raw);
            }),
          })),
          ...series(["usage"], "line"),
        ]}
        threshold={limits}
      />
    </div>
  );
}
