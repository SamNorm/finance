"use client";

import { useOptimistic, useState, useTransition } from "react";
import { formatDate } from "@/lib/format";
import { updateAnalysisAction } from "../actions";

// Which periods the analysis covers, and how many years it projects.
export function AnalysisSettings({
  analysisId,
  periods,
  selected,
  projectionYears,
}: {
  analysisId: string;
  periods: { id: string; periodEnd: string; months: number }[];
  // Empty means every period of the borrower.
  selected: string[];
  projectionYears: number;
}) {
  const all = periods.map((p) => p.id);
  const [chosen, setChosen] = useOptimistic(selected.length ? selected : all);
  const [years, setYears] = useOptimistic(projectionYears);
  const [, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  function save(patch: { periodIds?: string[]; projectionYears?: number }) {
    setFailure(null);
    startTransition(async () => {
      if (patch.periodIds) setChosen(patch.periodIds);
      if (patch.projectionYears !== undefined) setYears(patch.projectionYears);
      const result = await updateAnalysisAction(analysisId, patch);
      if (!result.ok) setFailure(result.message);
    });
  }

  function toggle(id: string) {
    const next = chosen.includes(id)
      ? chosen.filter((c) => c !== id)
      : [...chosen, id];
    if (!next.length) return;
    save({ periodIds: all.filter((p) => next.includes(p)) });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-muted">Periods</span>
        {periods.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={chosen.includes(p.id)}
            onClick={() => toggle(p.id)}
            className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent"
          >
            {formatDate(p.periodEnd)}
            {p.months !== 12 ? ` · ${p.months} mo` : ""}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2">
        <span className="text-muted">Projected years</span>
        <select
          value={years}
          onChange={(e) => save({ projectionYears: Number(e.target.value) })}
          className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
        >
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "None" : n}
            </option>
          ))}
        </select>
      </label>
      {failure && <span className="text-danger">{failure}</span>}
    </div>
  );
}
