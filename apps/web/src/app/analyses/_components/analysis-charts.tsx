"use client";

import type {
  AnalysisRun,
  ChartDefinition,
  CovenantResult,
  ModelLine,
  RunPeriod,
} from "@finance/domain";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ChartBuilder, type ChartDraft } from "@/components/chart-builder";
import { ask } from "@/components/confirm";
import {
  MetricChart,
  type ChartFormat,
  type ChartPeriod,
  type ChartSeries,
  type ChartThreshold,
} from "@/components/metric-chart";
import { button } from "@/components/styles";
import { Icon } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { QUALITY_SHORT } from "@/lib/labels";
import { saveAnalysisChartsAction } from "../actions";

// The model's charts and the analysis's own, over the periods shown. Under a
// scenario, a one-line chart also draws the scenario post-project from the
// last fiscal year on, or else the base case, so the effect shows at a
// glance.
export function AnalysisCharts({
  analysisId,
  lines,
  run,
  base,
  scenarioName,
  modelCharts,
  charts,
  project,
  covenants,
}: {
  analysisId: string;
  lines: ModelLine[];
  run: AnalysisRun;
  base: AnalysisRun | null;
  // The scenario with its project.
  project: AnalysisRun | null;
  scenarioName: string | null;
  modelCharts: ChartDefinition[];
  charts: ChartDefinition[];
  // The covenants tested in `run`, whose thresholds charts on their lines
  // draw.
  covenants: CovenantResult[];
}) {
  const [editing, setEditing] = useState<ChartDefinition | "new" | null>(null);
  const [removing, startRemove] = useTransition();
  const periods = chartPeriods(run.periods);
  const byCode = new Map(lines.map((l) => [l.code, l]));

  function chartProps(chart: ChartDraft) {
    const format = (byCode.get(chart.series[0]?.code ?? "")?.format ??
      "amount") as ChartFormat;
    const single = chart.series.length === 1;
    const series: ChartSeries[] = chart.series.map((s) => ({
      label:
        (byCode.get(s.code)?.label ?? s.code) +
        (single && project ? " · as is" : "") +
        (single && base && !project ? ` · ${scenarioName}` : ""),
      mark: s.mark,
      values: valuesOf(run, s.code),
    }));
    if (single && project) {
      // Post-project from the last fiscal year on, whatever the table shows.
      const lastYear = project.periods.findLastIndex(
        (p) => !p.projection && p.months === 12,
      );
      series.push({
        label: `${byCode.get(chart.series[0]!.code)?.label ?? chart.series[0]!.code} · post-project`,
        mark: "line",
        values: valuesOf(project, chart.series[0]!.code).map((v, i) =>
          i >= lastYear || project.periods[i]!.projection ? v : null,
        ),
      });
    } else if (single && base) {
      series.push({
        label: "Base case",
        mark: "line",
        values: valuesOf(base, chart.series[0]!.code),
        reference: true,
      });
    }
    // An assumption's value in each period, which a scenario can set year
    // by year.
    const assumed = chart.threshold ? valuesOf(run, chart.threshold) : [];
    // On one line a covenant tests, the covenant's threshold in each period
    // it's tested: the deal's term, before any assumption the chart names.
    const covenant =
      single &&
      covenants.find(
        (c) =>
          c.label !== null &&
          c.covenant.metric.toUpperCase() ===
            chart.series[0]!.code.toUpperCase(),
      );
    const threshold: ChartThreshold | null = covenant
      ? {
          label: covenant.covenant.name,
          values: covenant.periods.map((p) =>
            p.threshold === null ? null : Number(p.threshold),
          ),
        }
      : chart.threshold && assumed.some((v) => v !== null)
        ? {
            label: byCode.get(chart.threshold)?.label ?? chart.threshold,
            values: assumed,
          }
        : null;
    return { format, periods, series, threshold };
  }

  async function save(chart: ChartDraft) {
    const next =
      editing === "new" || editing === null
        ? [...charts, chart]
        : charts.map((c) => (c.id === chart.id ? chart : c));
    return saveAnalysisChartsAction(analysisId, next);
  }

  async function remove(chart: ChartDefinition) {
    if (
      !(await ask({
        title: `Remove the chart "${chart.title}"?`,
        action: "Remove",
        danger: true,
      }))
    )
      return;
    startRemove(async () => {
      const result = await saveAnalysisChartsAction(
        analysisId,
        charts.filter((c) => c.id !== chart.id),
      );
      if (!result.ok) toast.error(result.message);
    });
  }

  const all = [
    ...modelCharts.map((chart) => ({ chart, own: false })),
    ...charts.map((chart) => ({ chart, own: true })),
  ];

  return (
    <section className="flex flex-col gap-3" aria-label="Charts">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">
          Charts{" "}
          {base && (
            <span className="font-normal text-muted">
              ·{" "}
              {project
                ? `${scenarioName}, as is and post-project`
                : `${scenarioName} against the base case`}
            </span>
          )}
        </h2>
        <button
          type="button"
          className={button.ghost}
          onClick={() => setEditing("new")}
        >
          <Icon name="plus" />
          Chart
        </button>
      </div>
      {all.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {all.map(({ chart, own }) => (
            <MetricChart
              key={chart.id}
              title={
                <>
                  {chart.title}
                  {!own && (
                    <span
                      className="ml-2 rounded bg-surface-2 px-1 text-[11px] font-normal text-muted"
                      title="Defined in the financial model"
                    >
                      model
                    </span>
                  )}
                </>
              }
              {...chartProps(chart)}
              actions={
                own && (
                  <>
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-foreground"
                      onClick={() => setEditing(chart)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-danger-soft hover:text-danger"
                      disabled={removing}
                      onClick={() => remove(chart)}
                    >
                      Remove
                    </button>
                  </>
                )
              }
            />
          ))}
        </div>
      )}
      <ChartBuilder
        open={editing !== null}
        onClose={() => setEditing(null)}
        lines={lines}
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
    </section>
  );
}

function valuesOf(run: AnalysisRun, code: string) {
  return (run.cells[code] ?? []).map((cell) =>
    cell.error || cell.value === null ? null : Number(cell.value),
  );
}

// Years when every period is a fiscal year ending on the same day; dates
// otherwise.
function chartPeriods(periods: RunPeriod[]): ChartPeriod[] {
  const years = periods.map((p) => p.end.slice(0, 4));
  const yearly =
    periods.every(
      (p) => p.months === 12 && p.end.slice(5) === periods[0]!.end.slice(5),
    ) && new Set(years).size === years.length;
  return periods.map((p, i) => ({
    label: yearly ? years[i]! : formatDate(p.end),
    detail: `${formatDate(p.end)} · ${
      p.projection === "assumptions"
        ? "Projected"
        : p.projection === "client"
          ? "Client projection"
          : `${p.months} mo · ${QUALITY_SHORT[p.quality]}`
    }`,
    projected: p.projection !== null,
  }));
}
