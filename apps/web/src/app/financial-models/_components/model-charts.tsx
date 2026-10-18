"use client";

import type { ChartDefinition, ModelLine } from "@finance/domain";
import { ChartColumn, ChartLine } from "lucide-react";
import { useState, useTransition } from "react";
import { ChartBuilder, type ChartDraft } from "@/components/chart-builder";
import { Card } from "@/components/page";
import { button } from "@/components/styles";
import { Icon } from "@/components/ui";
import { saveModelChartsAction } from "../actions";

// The charts every analysis on this version shows, defined over its lines.
export function ModelCharts({
  versionId,
  editable,
  lines,
  charts,
}: {
  versionId: string;
  editable: boolean;
  lines: ModelLine[];
  charts: ChartDefinition[];
}) {
  const [editing, setEditing] = useState<ChartDefinition | "new" | null>(null);
  const [removing, startRemove] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const labels = new Map(lines.map((l) => [l.code, l.label]));

  async function save(chart: ChartDraft) {
    const next =
      editing === "new" || editing === null
        ? [...charts, chart]
        : charts.map((c) => (c.id === chart.id ? chart : c));
    return saveModelChartsAction(versionId, next);
  }

  function remove(chart: ChartDefinition) {
    if (!confirm(`Remove the chart "${chart.title}"?`)) return;
    setFailure(null);
    startRemove(async () => {
      const result = await saveModelChartsAction(
        versionId,
        charts.filter((c) => c.id !== chart.id),
      );
      if (!result.ok) setFailure(result.message);
    });
  }

  return (
    <Card
      flush
      title="Charts"
      description="Shown in every analysis on this version, next to charts analysts add themselves."
      actions={
        editable && (
          <button
            type="button"
            className={button.secondary}
            onClick={() => setEditing("new")}
          >
            <Icon name="plus" />
            Add chart
          </button>
        )
      }
    >
      {failure && <p className="px-4 pt-3 text-sm text-danger">{failure}</p>}
      {charts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <span className="grid size-10 place-items-center rounded-full bg-surface-2 text-muted">
            <ChartLine className="size-5" aria-hidden />
          </span>
          <p className="text-sm font-medium">No charts yet.</p>
          {editable && (
            <p className="max-w-md text-sm text-muted">
              Chart lines that tell the story, such as debt service coverage
              against its covenant.
            </p>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {charts.map((chart) => (
            <li
              key={chart.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
                  {chart.series.every((s) => s.mark === "bar") ? (
                    <ChartColumn className="size-4" aria-hidden />
                  ) : (
                    <ChartLine className="size-4" aria-hidden />
                  )}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-medium">{chart.title}</span>
                  <span className="flex flex-wrap gap-1.5 text-xs text-muted">
                    {chart.series.map((s) => (
                      <span
                        key={s.code}
                        className="rounded bg-surface-2 px-1.5 py-0.5"
                      >
                        {labels.get(s.code) ?? s.code} ·{" "}
                        {s.mark === "bar" ? "bars" : "line"}
                      </span>
                    ))}
                    {chart.threshold && (
                      <span className="rounded border border-dashed border-line-strong px-1.5 py-0.5">
                        threshold:{" "}
                        {labels.get(chart.threshold) ?? chart.threshold}
                      </span>
                    )}
                  </span>
                </div>
              </div>
              {editable && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={button.ghost}
                    onClick={() => setEditing(chart)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={button.ghost}
                    disabled={removing}
                    onClick={() => remove(chart)}
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <ChartBuilder
        open={editing !== null}
        onClose={() => setEditing(null)}
        lines={lines}
        initial={editing === "new" ? null : editing}
        onSave={save}
      />
    </Card>
  );
}
