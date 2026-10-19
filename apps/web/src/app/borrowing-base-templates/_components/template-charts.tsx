"use client";

import type { ChartDefinition, ModelLine } from "@finance/domain";
import { ChartColumn, ChartLine } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ChartBuilder, type ChartDraft } from "@/components/chart-builder";
import { ask } from "@/components/confirm";
import { Card } from "@/components/page";
import { button, table } from "@/components/styles";
import { Icon } from "@/components/ui";
import type { Figure } from "@/lib/borrowing-bases";
import { saveBorrowingBaseTemplateChartsAction } from "../actions";

// A template's charts (borrowing-base-plan.md §6.4), which lines started
// from it bring along: series and a threshold over the borrowing base's
// figures. A template has no months to draw them over, so they're listed;
// a line's Charts tab draws them.

const CHARTABLE: readonly string[] = ["amount", "percent", "ratio", "count"];

export function TemplateCharts({
  templateId,
  charts,
  own,
  figures,
}: {
  templateId: string;
  // The draft's charts, or the defaults.
  charts: ChartDefinition[];
  // Whether the draft names its charts, rather than taking the defaults.
  own: boolean;
  figures: Figure[];
}) {
  const [editing, setEditing] = useState<ChartDefinition | "new" | null>(null);
  const [removing, startRemove] = useTransition();
  const byCode = new Map(figures.map((f) => [f.code, f]));
  // The chart builder picks among a model's lines; figures read as such.
  const lines: ModelLine[] = figures
    .filter((f) => CHARTABLE.includes(f.format))
    .map((f) => ({
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
  const labelOf = (code: string) => byCode.get(code)?.label ?? code;

  async function save(chart: ChartDraft) {
    const next =
      editing === "new" || editing === null
        ? [...charts, chart]
        : charts.map((c) => (c.id === chart.id ? chart : c));
    return saveBorrowingBaseTemplateChartsAction(templateId, next);
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
      const result = await saveBorrowingBaseTemplateChartsAction(
        templateId,
        charts.filter((c) => c.id !== chart.id),
      );
      if (result.ok) toast.success("Chart removed.");
      else toast.error(result.message);
    });
  }

  return (
    <Card
      flush
      title="Charts"
      description={
        own
          ? "The draft's charts, which lines started from it draw month by month."
          : "The default charts. Adding, editing or removing one makes the set this template's own."
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
      {charts.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">
          No charts. Add one over any of the borrowing base&apos;s figures.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className={table.table}>
            <thead>
              <tr className={table.head}>
                <th className={table.th}>Chart</th>
                <th className={table.th}>Series</th>
                <th className={table.th}>Threshold</th>
                <th className={table.th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {charts.map((chart) => (
                <tr
                  key={chart.id}
                  className="border-b border-line/70 last:border-b-0"
                >
                  <td className="px-4 py-2 font-medium">{chart.title}</td>
                  <td className="px-4 py-2">
                    <span className="flex flex-wrap gap-1.5">
                      {chart.series.map((s) => (
                        <span
                          key={s.code}
                          title={s.code}
                          className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted"
                        >
                          {s.mark === "bar" ? (
                            <ChartColumn className="size-3" aria-label="Bars" />
                          ) : (
                            <ChartLine className="size-3" aria-label="Line" />
                          )}
                          {labelOf(s.code)}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted">
                    {chart.threshold ? labelOf(chart.threshold) : "None"}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-foreground"
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
      />
    </Card>
  );
}
