"use client";

import type {
  BorrowingBaseRun,
  ChartDefinition,
  ModelLine,
} from "@finance/domain";
import type { BorrowingBaseDefinition } from "@finance/domain/borrowing-bases";
import { useState, useTransition } from "react";
import { ChartBuilder, type ChartDraft } from "@/components/chart-builder";
import {
  MetricChart,
  type ChartFormat,
  type ChartPeriod,
  type ChartSeries,
} from "@/components/metric-chart";
import { Card } from "@/components/page";
import { button } from "@/components/styles";
import { Icon } from "@/components/ui";
import {
  describeMonth,
  fiscalMonths,
  QUALITY,
  type Figure,
} from "@/lib/borrowing-bases";
import { MONTHS } from "@/lib/credit-lines";
import { saveBorrowingBaseChartsAction } from "../actions";

// A borrowing base's charts (borrowing-base-plan.md §6.4): its own, or the
// defaults, month by month, with a threshold read from the figures by
// code, so a seasonal limit steps with its seasons; then two views over
// the business cycle, built in: each fiscal year's line over the calendar
// months, and the margined collateral stacked by line.

const CHARTABLE: readonly string[] = ["amount", "percent", "ratio", "count"];

// "2024-12" → "Dec-24", as spreadsheets label months.
const shortMonth = (month: string) =>
  `${MONTHS[Number(month.slice(5, 7)) - 1]}-${month.slice(2, 4)}`;

// What the stacked view adds up: each collateral line's margined amount,
// or a capped group's, as the gross borrowing base does.
function collateralParts(definition: BorrowingBaseDefinition) {
  const groups = new Set(
    definition.lines.filter((l) => l.kind === "group").map((l) => l.code),
  );
  return definition.lines.flatMap((line) => {
    if (line.kind === "group")
      return line.cap
        ? [{ code: `${line.code}.MARGINED`, label: line.label }]
        : definition.lines
            .filter((x) => x.kind === "collateral" && x.group === line.code)
            .map((x) => ({ code: `${x.code}.MARGINED`, label: x.label }));
    if (line.kind === "collateral" && !(line.group && groups.has(line.group)))
      return [{ code: `${line.code}.MARGINED`, label: line.label }];
    return [];
  });
}

export function BorrowingBaseCharts({
  lineId,
  run,
  definition,
  charts,
  years,
  yearEndMonth,
  figures,
}: {
  lineId: string;
  run: BorrowingBaseRun;
  definition: BorrowingBaseDefinition;
  // The definition's charts, or the defaults.
  charts: ChartDefinition[];
  // Each month's fiscal year.
  years: string[];
  yearEndMonth: number;
  figures: Figure[];
}) {
  const [editing, setEditing] = useState<ChartDefinition | "new" | null>(null);
  const [removing, startRemove] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const [overlaid, setOverlaid] = useState("BB_USAGE");
  // An empty list is the borrowing base's own: no charts.
  const own = definition.charts !== undefined;
  const byCode = new Map(figures.map((f) => [f.code, f]));
  const chartable = figures.filter((f) => CHARTABLE.includes(f.format));
  // The chart builder picks among a model's lines; figures read as such.
  const lines: ModelLine[] = chartable.map((f) => ({
    code: f.code,
    label: f.label,
    kind: "calculation",
    format: f.format,
    formula: null,
    projectionFormula: null,
    defaultValue: null,
    breaksDown: null,
    description: null,
  }));
  const periods: ChartPeriod[] = run.months.map((m) => ({
    label: shortMonth(m.month),
    detail: `${describeMonth(m.month)} · ${m.quality ? QUALITY[m.quality] : "No certificate"}`,
    projected: false,
  }));
  const valuesOf = (code: string) =>
    run.months.map((_, p) => {
      const cell = run.cells[code]?.[p];
      return !cell || cell.error || cell.value === null
        ? null
        : Number(cell.value);
    });
  const formatOf = (code: string) =>
    (byCode.get(code)?.format ?? "amount") as ChartFormat;

  function chartProps(chart: ChartDraft) {
    const series: ChartSeries[] = chart.series.map((s) => ({
      label: byCode.get(s.code)?.label ?? s.code,
      mark: s.mark,
      values: valuesOf(s.code),
    }));
    return {
      format: formatOf(chart.series[0]?.code ?? ""),
      periods,
      series,
      threshold: chart.threshold
        ? {
            label: byCode.get(chart.threshold)?.label ?? chart.threshold,
            values: valuesOf(chart.threshold),
          }
        : null,
      steps: "by month",
    };
  }

  async function save(chart: ChartDraft) {
    const next =
      editing === "new" || editing === null
        ? [...charts, chart]
        : charts.map((c) => (c.id === chart.id ? chart : c));
    return saveBorrowingBaseChartsAction(lineId, next);
  }

  function remove(chart: ChartDefinition) {
    if (!confirm(`Remove the chart "${chart.title}"?`)) return;
    setFailure(null);
    startRemove(async () => {
      const result = await saveBorrowingBaseChartsAction(
        lineId,
        charts.filter((c) => c.id !== chart.id),
      );
      if (!result.ok) setFailure(result.message);
    });
  }

  // Each fiscal year's figure over its calendar months, in fiscal order.
  const order = fiscalMonths(yearEndMonth);
  const compared = valuesOf(overlaid);
  const overlay: ChartSeries[] = [...new Set(years)]
    .map((year) => ({
      label: year,
      mark: "line" as const,
      values: order.map((m) => {
        const p = run.months.findIndex(
          (rm, i) => years[i] === year && Number(rm.month.slice(5, 7)) === m,
        );
        return p === -1 ? null : (compared[p] ?? null);
      }),
    }))
    .filter((s) => s.values.some((v) => v !== null));
  const parts = collateralParts(definition)
    .map((part) => ({ ...part, values: valuesOf(part.code) }))
    .filter((part) => part.values.some((v) => v !== null && v !== 0));

  const linkButton =
    "rounded px-1.5 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-foreground";

  return (
    <div className="flex flex-col gap-4">
      <Card
        flush
        title="Charts"
        description={
          own
            ? "This borrowing base's charts, month by month."
            : "The default charts. Adding or editing one makes the set this borrowing base's own."
        }
        actions={
          <button
            type="button"
            className={button.secondary}
            onClick={() => setEditing("new")}
          >
            <Icon name="plus" />
            Chart
          </button>
        }
      >
        {failure && (
          <p className="border-b border-line px-4 py-2 text-sm text-danger">
            {failure}
          </p>
        )}
        {charts.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted">
            No charts. Add one over any of the borrowing base&apos;s figures.
          </p>
        )}
        <div className="grid gap-3 p-3 empty:hidden lg:grid-cols-2">
          {charts.map((chart) => (
            <MetricChart
              key={chart.id}
              title={chart.title}
              {...chartProps(chart)}
              actions={
                <>
                  <button
                    type="button"
                    className={linkButton}
                    onClick={() => setEditing(chart)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-40"
                    disabled={removing}
                    onClick={() => remove(chart)}
                  >
                    Remove
                  </button>
                </>
              }
            />
          ))}
        </div>
      </Card>

      <Card
        flush
        title="Over the business cycle"
        description="Built-in views: each fiscal year side by side, and the borrowing base by collateral."
      >
        <div className="grid gap-3 p-3 lg:grid-cols-2">
          <MetricChart
            title={`${byCode.get(overlaid)?.label ?? overlaid}, year over year`}
            format={formatOf(overlaid)}
            periods={order.map((m) => ({
              label: MONTHS[m - 1]!,
              detail: MONTHS[m - 1]!,
              projected: false,
            }))}
            series={overlay}
            actions={
              <select
                value={overlaid}
                onChange={(e) => setOverlaid(e.target.value)}
                aria-label="Figure compared year over year"
                className="max-w-44 rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-muted"
              >
                {chartable.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.label}
                  </option>
                ))}
              </select>
            }
          />
          <MetricChart
            title="Margined collateral, usage and the limit"
            format="amount"
            periods={periods}
            stacked
            steps="by month"
            series={[
              ...parts.map((part) => ({
                label: part.label,
                mark: "bar" as const,
                values: part.values,
              })),
              {
                label: byCode.get("BB_TOTAL")?.label ?? "Borrowing base",
                mark: "line",
                values: valuesOf("BB_TOTAL"),
              },
              {
                label: byCode.get("BB_USAGE")?.label ?? "Usage",
                mark: "line",
                values: valuesOf("BB_USAGE"),
              },
            ]}
            threshold={{
              label: byCode.get("BB_LIMIT")?.label ?? "Authorized limit",
              values: valuesOf("BB_LIMIT"),
            }}
          />
        </div>
      </Card>

      <ChartBuilder
        open={editing !== null}
        onClose={() => setEditing(null)}
        lines={lines}
        thresholds={{
          lines,
          hint: "A figure drawn across the chart, month by month, such as the authorized limit.",
        }}
        initial={editing === "new" ? null : editing}
        onSave={save}
        preview={(chart) => (
          <MetricChart
            title={chart.title}
            height={180}
            {...chartProps(chart)}
          />
        )}
      />
    </div>
  );
}
