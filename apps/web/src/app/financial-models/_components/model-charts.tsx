"use client";

import type { ChartDefinition, ModelLine } from "@finance/domain";
import { useState, useTransition } from "react";
import { ChartBuilder, type ChartDraft } from "@/components/chart-builder";
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
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <p className="text-sm">
          <span className="font-semibold">Charts</span>{" "}
          <span className="text-muted">
            Shown in every analysis on this version, next to charts analysts add
            themselves.
          </span>
        </p>
        {editable && (
          <button
            type="button"
            className={button.secondary}
            onClick={() => setEditing("new")}
          >
            <Icon name="plus" />
            Add chart
          </button>
        )}
      </div>
      {failure && <p className="px-4 pt-3 text-sm text-danger">{failure}</p>}
      {charts.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">
          No charts yet.
          {editable &&
            " Chart lines that tell the story, such as debt service coverage against its covenant."}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {charts.map((chart) => (
            <li
              key={chart.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
            >
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
                    <span className="px-1.5 py-0.5">
                      threshold:{" "}
                      {labels.get(chart.threshold) ?? chart.threshold}
                    </span>
                  )}
                </span>
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
    </section>
  );
}
