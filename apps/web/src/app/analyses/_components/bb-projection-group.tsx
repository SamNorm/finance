"use client";

import type { GroupFigures, GroupMonth, Issue } from "@finance/domain";
import { GROUP_TOTALS } from "@finance/domain/borrowing-bases";
import { Dec } from "@finance/engine";
import { useLayoutEffect, useRef } from "react";
import { IssueList, IssuesSummary } from "@/components/issue-list";
import { badge } from "@/components/styles";
import { describeMonth } from "@/lib/borrowing-bases";
import { formatFigure } from "@/lib/format";
import { scrollToProjection } from "./bb-projection-table";

// A consolidated client's borrowing base in an analysis
// (borrowing-base-plan.md §7.5, §8): its members' margined lines added up
// month by month, the last twelve months of history then their projections,
// with the adjustments and any group certificate as the history has them.

type Row = {
  label: string;
  value: (m: GroupMonth) => string | null;
  format?: "amount" | "percent";
  strong?: boolean;
  short?: boolean;
};

const figure = (key: keyof GroupFigures) => (m: GroupMonth) =>
  m.consolidated[key];

export function GroupProjection({
  name,
  months,
  issues,
  members,
}: {
  name: string;
  months: GroupMonth[];
  issues: Issue[];
  // Members' margined lines by key, as the analysis names them.
  members: { key: string; name: string }[];
}) {
  const first = months.findIndex((m) => m.projected);
  const shown = months.slice(
    Math.max(0, (first === -1 ? months.length : first) - 12),
  );
  const firstAhead = useRef<HTMLTableCellElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    const th = firstAhead.current;
    if (el && th) scrollToProjection(el, th);
  }, []);
  const flagged = shown.filter((m) => m.issues.length);
  const rows: (Row | { section: string })[] = [
    { section: "Members" },
    ...members.map((member): Row => ({
      label: member.name,
      value: (m) => m.members[member.key]?.total ?? null,
    })),
    { section: "The group" },
    ...GROUP_TOTALS.filter((t) =>
      ["receivables", "inventory", "otherCollateral"].includes(t.key),
    ).map((t): Row => ({ label: t.label, value: figure(t.key) })),
    { label: "Gross borrowing base", value: figure("gross"), strong: true },
    { label: "Prior claims", value: figure("priorClaims") },
    { label: "Reserves", value: figure("reserves") },
    { label: "Borrowing base", value: figure("total"), strong: true },
    { label: "Authorized limits", value: figure("limit") },
    { label: "Availability", value: figure("available") },
    { label: "Lines outstanding", value: figure("outstanding") },
    { label: "Other usage", value: figure("otherUsage") },
    { label: "Usage", value: figure("usage"), strong: true },
    {
      label: "Margin surplus (deficit)",
      value: figure("surplus"),
      strong: true,
      short: true,
    },
    { label: "Excess availability", value: figure("excess"), short: true },
    { label: "Utilization", value: figure("utilization"), format: "percent" },
    {
      label: "Adjustments",
      value: (m) =>
        m.adjustments.length
          ? m.adjustments
              .reduce((sum, a) => sum.plus(a.amount), new Dec(0))
              .toFixed()
          : null,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {(issues.length > 0 || flagged.length > 0) && (
        <IssuesSummary
          issues={[...issues, ...flagged.flatMap((m) => m.issues)]}
          note="Checks on the group's months. They flag problems; nothing is blocked."
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
      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
        <div className="flex flex-col gap-0.5 border-b border-line px-4 py-2.5">
          <h3 className="text-sm font-semibold">{name}, month by month</h3>
          <p className="text-xs text-muted">
            Each member&apos;s line on its own terms, added up as totals. The
            group&apos;s adjustments and certificates are entered on its
            borrowing base page; projected months add up the members&apos;
            projections, under this scenario.
          </p>
        </div>
        <div ref={scroller} className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="sticky left-0 z-20 w-64 min-w-64 border-b border-line bg-surface px-4 py-2 text-left font-medium">
                  Total
                </th>
                {shown.map((m, i) => (
                  <th
                    key={m.month}
                    ref={
                      i === shown.findIndex((x) => x.projected)
                        ? firstAhead
                        : undefined
                    }
                    className={`w-28 min-w-28 border-b border-l border-line px-2.5 py-1.5 text-right align-top font-normal ${m.projected ? "bg-accent-soft/40" : "bg-surface"}`}
                  >
                    <span className="block font-medium whitespace-nowrap text-foreground">
                      {describeMonth(m.month)}
                    </span>
                    {m.projected
                      ? "Projected"
                      : m.override
                        ? "Group certificate"
                        : m.adjustments.length
                          ? "Adjusted"
                          : "Summed"}
                  </th>
                ))}
                <th className="w-full border-b border-line bg-surface" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) =>
                "section" in row ? (
                  <tr key={row.section}>
                    <td className="sticky left-0 z-10 border-b border-line/60 bg-surface px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                      {row.section}
                    </td>
                    <td
                      colSpan={shown.length + 1}
                      className="border-b border-line/60"
                    />
                  </tr>
                ) : (
                  <tr
                    key={row.label}
                    className={row.strong ? "bg-surface-2/60 font-medium" : ""}
                  >
                    <td
                      className={`sticky left-0 z-10 border-b border-line/60 px-4 py-1 ${row.strong ? "bg-surface-2" : "bg-surface"}`}
                    >
                      {row.label}
                    </td>
                    {shown.map((m) => {
                      const raw = row.value(m);
                      const short =
                        row.short && raw !== null && Number(raw) < 0;
                      return (
                        <td
                          key={m.month}
                          className={`border-b border-l border-line/60 px-2.5 py-1 text-right whitespace-nowrap tabular-nums ${m.projected ? "bg-accent-soft/40" : ""} ${short ? "text-danger" : ""}`}
                          title={
                            row.label === "Adjustments"
                              ? m.adjustments
                                  .map(
                                    (a) =>
                                      `${a.name}: ${formatFigure(a.amount, "amount")}`,
                                  )
                                  .join("\n") || undefined
                              : undefined
                          }
                        >
                          {raw === null ? (
                            <span className="text-muted">–</span>
                          ) : (
                            formatFigure(raw, row.format ?? "amount")
                          )}
                        </td>
                      );
                    })}
                    <td className="border-b border-line/60" />
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        {shown.some((m) => m.override) && (
          <p className="border-t border-line px-4 py-2 text-xs text-muted">
            <span className={badge("accent")}>Group certificate</span> Months
            with a group certificate take its totals over the members&apos; sum.
          </p>
        )}
      </section>
    </div>
  );
}
