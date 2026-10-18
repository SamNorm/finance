"use client";

import { CalendarRange, ChevronDown, TrendingUp } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { Popover } from "@/components/menu";
import { button } from "@/components/styles";
import { Segmented } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { PROJECTION_MODES, QUALITY_SHORT } from "@/lib/labels";
import { updateAnalysisAction } from "../actions";

type ProjectionMode = keyof typeof PROJECTION_MODES;

interface Settings {
  periodIds?: string[];
  projectionMode?: ProjectionMode;
  projectionYears?: number;
}

// Which periods the analysis covers, and where its projections come from:
// years computed from assumptions, or the client's own projected periods.
// Each sits behind a button that says what's chosen; changes save at once.
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
    quality: keyof typeof QUALITY_SHORT;
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
  const shown = periods.filter((p) => client || p.quality !== "projected");
  const included = shown.filter((p) => chosen.includes(p.id));
  const clientPeriods = periods.filter((p) => p.quality === "projected").length;

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

  const trigger = `${button.secondary} gap-2 pr-2`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover
        trigger={
          <button type="button" className={trigger}>
            <CalendarRange className="text-muted" />
            <span>
              Periods{" "}
              <span className="font-normal text-muted">
                {included.length} of {shown.length}
              </span>
            </span>
            <ChevronDown className="text-muted" />
          </button>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium">Periods</p>
            <p className="text-xs text-muted">
              The borrower&apos;s statements this analysis reads. At least one
              stays in.
            </p>
          </div>
          <ul className="flex flex-col gap-0.5">
            {shown.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={chosen.includes(p.id)}
                    onChange={() => toggle(p.id)}
                    className="size-4 accent-accent"
                  />
                  <span className="font-medium tabular-nums">
                    {formatDate(p.periodEnd)}
                  </span>
                  <span className="ml-auto text-xs text-muted">
                    {p.months} mo ·{" "}
                    {p.quality === "projected"
                      ? "Client"
                      : QUALITY_SHORT[p.quality]}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </Popover>

      <Popover
        trigger={
          <button type="button" className={trigger}>
            <TrendingUp className="text-muted" />
            <span>
              Projections{" "}
              <span className="font-normal text-muted">
                {client
                  ? "client's"
                  : years
                    ? `${years} ${years === 1 ? "year" : "years"}`
                    : "none"}
              </span>
            </span>
            <ChevronDown className="text-muted" />
          </button>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium">Projections</p>
            <p className="text-xs text-muted">
              Years computed from the model&apos;s assumptions, or the
              client&apos;s own projections as spread.
            </p>
          </div>
          <Segmented
            name="projectionMode"
            options={PROJECTION_MODES}
            value={mode}
            onChange={(value) => save({ projectionMode: value })}
          />
          {client ? (
            clientPeriods === 0 && (
              <p className="text-sm text-warning">
                No projected periods in the spread yet.
              </p>
            )
          ) : (
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted">Years after the last period</span>
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
      </Popover>
      {failure && <span className="text-sm text-danger">{failure}</span>}
    </div>
  );
}
