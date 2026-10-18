"use client";

import type { Covenant } from "@finance/domain";
import { Trash2 } from "lucide-react";
import { button, input } from "./styles";
import { Icon } from "./ui";

// Covenants as their editors hold them: each a line of the borrower's
// financial models, at least or at most a threshold that can step by fiscal
// year, with a note for the agreement's wording. Shared by the borrower's
// covenants in force and a scenario's proposed set.

// A line a covenant can test, by its code.
export interface MetricOption {
  code: string;
  label: string;
  format: "amount" | "percent" | "ratio" | "count" | "flag" | "text";
}

export interface CovenantDraft {
  key: string;
  id?: string;
  name: string;
  metric: string;
  test: "min" | "max";
  steps: { key: string; from: string; value: string }[];
  note: string;
}

let counter = 0;
const newKey = () => `covenant-${++counter}`;

// The input style without its full width, which would win over the widths
// fields set here and stack each on a line of its own.
const box = input.replace("w-full ", "");

const grouped = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });

// A threshold as typed back: "75%", "1.25" or "2,000,000".
function editable(value: string, format: MetricOption["format"] | undefined) {
  const n = Number(value);
  if (format === "percent") return `${Math.round(n * 1e6) / 1e4}%`;
  if (format === "amount" || format === "count") return grouped.format(n);
  return value;
}

// A threshold as shown: "1.25x", "75%" or "2,000,000".
export function shownThreshold(
  value: string,
  format: MetricOption["format"] | undefined,
) {
  if (format === "ratio") return `${Number(value).toFixed(2)}x`;
  return editable(value, format);
}

export function covenantDrafts(
  covenants: readonly Covenant[],
  metrics: readonly MetricOption[],
): CovenantDraft[] {
  const format = (code: string) => metrics.find((m) => m.code === code)?.format;
  return covenants.map((c) => ({
    key: c.id,
    id: c.id,
    name: c.name,
    metric: c.metric,
    test: c.test,
    steps: c.thresholds.map((t, i) => ({
      key: `${c.id}-${i}`,
      from: t.from === null ? "" : String(t.from),
      value: editable(t.value, format(c.metric)),
    })),
    note: c.note ?? "",
  }));
}

// What the domain reads back: each covenant's fields as typed.
export const covenantInput = (drafts: readonly CovenantDraft[]) =>
  drafts.map(({ id, name, metric, test, steps, note }) => ({
    id,
    name,
    metric,
    test,
    thresholds: steps.map(({ from, value }) => ({ from, value })),
    note,
  }));

export const blankCovenant = (metric?: MetricOption): CovenantDraft => ({
  key: newKey(),
  name: metric?.label ?? "",
  metric: metric?.code ?? "",
  test: "min",
  steps: [{ key: newKey(), from: "", value: "" }],
  note: "",
});

export function CovenantEditor({
  drafts,
  metrics,
  onChange,
}: {
  drafts: CovenantDraft[];
  metrics: MetricOption[];
  onChange: (drafts: CovenantDraft[]) => void;
}) {
  const update = (key: string, patch: Partial<CovenantDraft>) =>
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  return (
    <div className="flex flex-col gap-3">
      {drafts.map((draft) => {
        const known = metrics.some((m) => m.code === draft.metric);
        return (
          <fieldset
            key={draft.key}
            className="flex flex-col gap-2 rounded-lg border border-line p-3"
          >
            <legend className="sr-only">{draft.name || "Covenant"}</legend>
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label="Name"
                placeholder="Debt service coverage"
                value={draft.name}
                onChange={(e) => update(draft.key, { name: e.target.value })}
                className={`${box} min-w-48 flex-[2]`}
              />
              <select
                aria-label="Line tested"
                value={draft.metric}
                onChange={(e) => {
                  const metric = metrics.find((m) => m.code === e.target.value);
                  const named = metrics.some((m) => m.label === draft.name);
                  update(draft.key, {
                    metric: e.target.value,
                    // A name taken from the previous line follows the new one.
                    ...(metric && (!draft.name || named)
                      ? { name: metric.label }
                      : {}),
                  });
                }}
                className={`${box} min-w-48 flex-[2]`}
              >
                <option value="">Line tested…</option>
                {!known && draft.metric && (
                  <option value={draft.metric}>
                    {draft.metric} (not in a published model)
                  </option>
                )}
                {metrics.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.label} ({m.code})
                  </option>
                ))}
              </select>
              <select
                aria-label="Test"
                value={draft.test}
                onChange={(e) =>
                  update(draft.key, {
                    test: e.target.value === "max" ? "max" : "min",
                  })
                }
                className={`${box} w-32`}
              >
                <option value="min">At least</option>
                <option value="max">At most</option>
              </select>
              <input
                aria-label="Threshold"
                placeholder="1.25"
                inputMode="decimal"
                value={draft.steps[0]?.value ?? ""}
                onChange={(e) =>
                  update(draft.key, {
                    steps: draft.steps.map((s, i) =>
                      i === 0 ? { ...s, value: e.target.value } : s,
                    ),
                  })
                }
                className={`${box} w-28 text-right tabular-nums`}
              />
              <button
                type="button"
                className={button.icon}
                aria-label={`Remove ${draft.name || "the covenant"}`}
                onClick={() =>
                  onChange(drafts.filter((d) => d.key !== draft.key))
                }
              >
                <Trash2 />
              </button>
            </div>
            {draft.steps.slice(1).map((step) => (
              <div
                key={step.key}
                className="flex flex-wrap items-center gap-2 pl-1 text-sm"
              >
                <span className="text-muted">From fiscal year</span>
                <input
                  aria-label="From fiscal year"
                  placeholder="2026"
                  inputMode="numeric"
                  value={step.from}
                  onChange={(e) =>
                    update(draft.key, {
                      steps: draft.steps.map((s) =>
                        s.key === step.key ? { ...s, from: e.target.value } : s,
                      ),
                    })
                  }
                  className={`${box} w-24 tabular-nums`}
                />
                <span className="text-muted">
                  {draft.test === "min" ? "at least" : "at most"}
                </span>
                <input
                  aria-label="Threshold from that year"
                  placeholder="1.30"
                  inputMode="decimal"
                  value={step.value}
                  onChange={(e) =>
                    update(draft.key, {
                      steps: draft.steps.map((s) =>
                        s.key === step.key
                          ? { ...s, value: e.target.value }
                          : s,
                      ),
                    })
                  }
                  className={`${box} w-28 text-right tabular-nums`}
                />
                <button
                  type="button"
                  className={button.icon}
                  aria-label="Remove the step"
                  onClick={() =>
                    update(draft.key, {
                      steps: draft.steps.filter((s) => s.key !== step.key),
                    })
                  }
                >
                  <Trash2 />
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={button.ghost}
                onClick={() =>
                  update(draft.key, {
                    steps: [
                      ...draft.steps,
                      { key: newKey(), from: "", value: "" },
                    ],
                  })
                }
              >
                <Icon name="plus" />
                Step from a year
              </button>
              <input
                aria-label="Note"
                placeholder="The agreement's wording (optional)"
                value={draft.note}
                onChange={(e) => update(draft.key, { note: e.target.value })}
                className={`${box} min-w-48 flex-1 text-xs`}
              />
            </div>
          </fieldset>
        );
      })}
      <div>
        <button
          type="button"
          className={button.secondary}
          onClick={() => onChange([...drafts, blankCovenant()])}
        >
          <Icon name="plus" />
          Covenant
        </button>
      </div>
    </div>
  );
}
