"use client";

import { Trash2 } from "lucide-react";
import {
  describeMonths,
  MONTHS,
  monthsFrom,
  newKey,
  seasonRun,
  type SeasonDraft,
  type StepDraft,
  type TermDraft,
} from "@/lib/credit-lines";
import { button, input } from "./styles";
import { Icon } from "./ui";

// The changes to a term over time, below its value: seasons, the calendar
// months it differs in every year, and steps from a month, for an
// amendment, each with seasons of its own. A step replaces the value and
// its seasons from its month on. Shared by a borrower's lines of credit and
// a scenario's proposed lines; the value itself sits with the line's other
// fields.

// The input style without its full width, so fields keep their own.
const box = input.replace("w-full ", "");

function Seasons({
  seasons,
  name,
  onChange,
}: {
  seasons: SeasonDraft[];
  name: string;
  onChange: (seasons: SeasonDraft[]) => void;
}) {
  const update = (key: string, patch: Partial<SeasonDraft>) =>
    onChange(seasons.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  return seasons.map((season) => {
    const run = seasonRun(season.months);
    const from = run?.from ?? season.months[0] ?? 1;
    const to = run?.to ?? season.months.at(-1) ?? 1;
    const month = (value: number, label: string, set: (m: number) => void) => (
      <select
        aria-label={`${name}, season ${label}`}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        className={`${box} w-20`}
      >
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
    );
    return (
      <div key={season.key} className="flex flex-wrap items-center gap-2">
        <span className="w-14 text-xs text-muted">Season</span>
        {month(from, "from", (m) =>
          update(season.key, { months: monthsFrom(m, to) }),
        )}
        <span className="text-xs text-muted">to</span>
        {month(to, "to", (m) =>
          update(season.key, { months: monthsFrom(from, m) }),
        )}
        <input
          aria-label={`${name}, ${describeMonths(season.months)}`}
          value={season.value}
          inputMode="decimal"
          onChange={(e) => update(season.key, { value: e.target.value })}
          className={`${box} w-32 text-right tabular-nums`}
        />
        {!run && (
          <span className="text-xs text-muted">
            Now {describeMonths(season.months)}
          </span>
        )}
        <button
          type="button"
          className={button.icon}
          aria-label={`Remove the season ${describeMonths(season.months)}`}
          onClick={() => onChange(seasons.filter((s) => s.key !== season.key))}
        >
          <Trash2 />
        </button>
      </div>
    );
  });
}

const blankSeason = (): SeasonDraft => ({
  key: newKey(),
  months: monthsFrom(10, 3),
  value: "",
});

export function TermChanges({
  draft,
  name,
  onChange,
}: {
  draft: TermDraft;
  // What the term is, for labels: "Operating line, limit".
  name: string;
  onChange: (draft: TermDraft) => void;
}) {
  const updateStep = (key: string, patch: Partial<StepDraft>) =>
    onChange({
      ...draft,
      steps: draft.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    });
  return (
    <div className="flex flex-col gap-2 text-sm">
      <Seasons
        seasons={draft.seasons}
        name={name}
        onChange={(seasons) => onChange({ ...draft, seasons })}
      />
      {draft.steps.map((step) => (
        <div
          key={step.key}
          className="flex flex-col gap-2 border-l-2 border-line pl-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 text-xs text-muted">From</span>
            <input
              type="month"
              aria-label={`${name}, step from`}
              value={step.from}
              placeholder="2026-06"
              onChange={(e) => updateStep(step.key, { from: e.target.value })}
              className={`${box} w-40 tabular-nums`}
            />
            <input
              aria-label={`${name}, from ${step.from || "the step"}`}
              value={step.value}
              inputMode="decimal"
              onChange={(e) => updateStep(step.key, { value: e.target.value })}
              className={`${box} w-32 text-right tabular-nums`}
            />
            <button
              type="button"
              className={button.icon}
              aria-label="Remove the step"
              onClick={() =>
                onChange({
                  ...draft,
                  steps: draft.steps.filter((s) => s.key !== step.key),
                })
              }
            >
              <Trash2 />
            </button>
          </div>
          <Seasons
            seasons={step.seasons}
            name={`${name}, from ${step.from}`}
            onChange={(seasons) => updateStep(step.key, { seasons })}
          />
          <div>
            <button
              type="button"
              className={`${button.ghost} px-2 py-1 text-xs`}
              onClick={() =>
                updateStep(step.key, {
                  seasons: [...step.seasons, blankSeason()],
                })
              }
            >
              <Icon name="plus" />
              Season in this step
            </button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className={`${button.ghost} px-2 py-1 text-xs`}
          onClick={() =>
            onChange({ ...draft, seasons: [...draft.seasons, blankSeason()] })
          }
        >
          <Icon name="plus" />
          Season
        </button>
        <button
          type="button"
          className={`${button.ghost} px-2 py-1 text-xs`}
          onClick={() =>
            onChange({
              ...draft,
              steps: [
                ...draft.steps,
                { key: newKey(), from: "", value: "", seasons: [] },
              ],
            })
          }
        >
          <Icon name="plus" />
          Step from a month
        </button>
      </div>
    </div>
  );
}
