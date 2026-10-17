"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Segmented } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { PROJECTION_MODES } from "@/lib/labels";
import { updateAnalysisAction } from "../actions";

type ProjectionMode = keyof typeof PROJECTION_MODES;

interface Settings {
  periodIds?: string[];
  projectionMode?: ProjectionMode;
  projectionYears?: number;
}

// Which periods the analysis covers, and where its projections come from:
// years computed from assumptions, or the client's own projected periods.
export function AnalysisSettings({
  analysisId,
  periods,
  selected,
  projectionMode,
  projectionYears,
}: {
  analysisId: string;
  periods: {
    id: string;
    periodEnd: string;
    months: number;
    projected: boolean;
  }[];
  // Empty means every period of the borrower.
  selected: string[];
  projectionMode: ProjectionMode;
  projectionYears: number;
}) {
  const all = periods.map((p) => p.id);
  const [chosen, setChosen] = useOptimistic(selected.length ? selected : all);
  const [mode, setMode] = useOptimistic(projectionMode);
  const [years, setYears] = useOptimistic(projectionYears);
  const [, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const client = mode === "client";
  // The client's periods only count when projections come from the client.
  const shown = periods.filter((p) => client || !p.projected);
  const clientPeriods = periods.filter((p) => p.projected).length;

  function save(patch: Settings) {
    setFailure(null);
    startTransition(async () => {
      if (patch.periodIds) setChosen(patch.periodIds);
      if (patch.projectionMode) setMode(patch.projectionMode);
      if (patch.projectionYears !== undefined) setYears(patch.projectionYears);
      const result = await updateAnalysisAction(analysisId, patch);
      if (!result.ok) setFailure(result.message);
    });
  }

  function toggle(id: string) {
    const next = chosen.includes(id)
      ? chosen.filter((c) => c !== id)
      : [...chosen, id];
    if (!shown.some((p) => next.includes(p.id))) return;
    save({ periodIds: all.filter((p) => next.includes(p)) });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-muted">Periods</span>
        {shown.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={chosen.includes(p.id)}
            onClick={() => toggle(p.id)}
            className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent"
          >
            {formatDate(p.periodEnd)}
            {p.months !== 12 ? ` · ${p.months} mo` : ""}
            {p.projected ? " · client" : ""}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Projections</span>
        <Segmented
          name="projectionMode"
          options={PROJECTION_MODES}
          value={mode}
          onChange={(value) => save({ projectionMode: value })}
        />
        {client ? (
          clientPeriods === 0 && (
            <span className="text-warning">
              No projected periods in the spread yet.
            </span>
          )
        ) : (
          <label className="flex items-center gap-2">
            <span className="text-muted">Years</span>
            <select
              value={years}
              onChange={(e) =>
                save({ projectionYears: Number(e.target.value) })
              }
              className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
            >
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "None" : n}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {failure && <span className="text-danger">{failure}</span>}
    </div>
  );
}
