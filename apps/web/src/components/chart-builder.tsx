"use client";

import type { ChartDefinition, ModelLine } from "@finance/domain";
import { useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { button, input } from "./styles";
import { Field, Modal } from "./ui";

// Picks what a chart shows from a model's lines. A chart has one axis, so
// once a line is chosen only lines of the same format can join it.

export type ChartDraft = Omit<ChartDefinition, "id"> & { id?: string };
type Format = "amount" | "percent" | "ratio" | "count";

const GROUPS: Record<Format, string> = {
  amount: "Amounts",
  percent: "Percentages",
  ratio: "Ratios",
  count: "Counts",
};
const MAX_SERIES = 8;

const chartable = (line: ModelLine) =>
  (line.kind === "calculation" || line.kind === "input") &&
  Object.hasOwn(GROUPS, line.format);

export function ChartBuilder({
  open,
  onClose,
  lines,
  initial,
  onSave,
  preview,
}: {
  open: boolean;
  onClose: () => void;
  lines: ModelLine[];
  initial: ChartDefinition | null;
  onSave: (chart: ChartDraft) => Promise<ActionResult>;
  // A live rendering of the chart being built, when there is data.
  preview?: (chart: ChartDraft) => ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? "Edit chart" : "New chart"}
    >
      {open && (
        <BuilderForm
          key={initial?.id ?? "new"}
          lines={lines}
          initial={initial}
          onSave={onSave}
          onClose={onClose}
          preview={preview}
        />
      )}
    </Modal>
  );
}

function BuilderForm({
  lines,
  initial,
  onSave,
  onClose,
  preview,
}: {
  lines: ModelLine[];
  initial: ChartDefinition | null;
  onSave: (chart: ChartDraft) => Promise<ActionResult>;
  onClose: () => void;
  preview?: (chart: ChartDraft) => ReactNode;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [marks, setMarks] = useState<Record<string, "bar" | "line">>(() =>
    Object.fromEntries(initial?.series.map((s) => [s.code, s.mark]) ?? []),
  );
  const [threshold, setThreshold] = useState(initial?.threshold ?? "");
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const options = lines.filter(chartable);
  // Series follow the model's line order, so colors are stable.
  const series = options
    .filter((l) => marks[l.code])
    .map((l) => ({ code: l.code, mark: marks[l.code]! }));
  const format = options.find((l) => marks[l.code])?.format as
    Format | undefined;
  const thresholds = lines.filter(
    (l) => l.kind === "assumption" && l.format === format,
  );
  const draft: ChartDraft = {
    id: initial?.id,
    title:
      title.trim() ||
      options
        .filter((l) => marks[l.code])
        .slice(0, 2)
        .map((l) => l.label)
        .join(" and "),
    series,
    threshold: thresholds.some((t) => t.code === threshold) ? threshold : null,
  };

  function toggle(line: ModelLine) {
    setMarks((current) => {
      const next = { ...current };
      if (next[line.code]) delete next[line.code];
      else next[line.code] = line.format === "amount" ? "bar" : "line";
      return next;
    });
  }

  function save() {
    setFailure(null);
    startTransition(async () => {
      const result = await onSave(draft);
      if (result.ok) onClose();
      else setFailure(result.message);
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
        <Field label="Title">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={draft.title || "Debt service coverage"}
            className={input}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted">
            Lines{" "}
            <span className="font-normal">
              · one kind of figure per chart, so they share one axis
            </span>
          </p>
          {options.length === 0 && (
            <p className="text-sm text-muted">
              The model has no calculations or inputs to chart.
            </p>
          )}
          {(Object.keys(GROUPS) as Format[]).map((group) => {
            const groupLines = options.filter((l) => l.format === group);
            if (!groupLines.length) return null;
            const disabled = format !== undefined && format !== group;
            return (
              <fieldset
                key={group}
                disabled={disabled}
                className="flex flex-col rounded-md border border-line disabled:opacity-50"
              >
                <legend className="sr-only">{GROUPS[group]}</legend>
                <p className="border-b border-line bg-surface-2 px-3 py-1 text-xs text-muted">
                  {GROUPS[group]}
                </p>
                {groupLines.map((line) => {
                  const mark = marks[line.code];
                  const full = !mark && series.length >= MAX_SERIES;
                  return (
                    <div
                      key={line.code}
                      className="flex items-center justify-between gap-3 border-b border-line/60 px-3 py-1.5 last:border-b-0"
                    >
                      <label className="flex min-w-0 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(mark)}
                          disabled={full}
                          onChange={() => toggle(line)}
                        />
                        <span className="truncate">{line.label}</span>
                        <span className="font-mono text-xs text-muted">
                          {line.code}
                        </span>
                      </label>
                      {mark && (
                        <div
                          role="radiogroup"
                          aria-label={`${line.label} as`}
                          className="flex shrink-0 rounded border border-line text-xs"
                        >
                          {(["bar", "line"] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              role="radio"
                              aria-checked={mark === m}
                              onClick={() =>
                                setMarks((c) => ({ ...c, [line.code]: m }))
                              }
                              className="px-2 py-0.5 text-muted aria-checked:bg-accent-soft aria-checked:text-accent"
                            >
                              {m === "bar" ? "Bars" : "Line"}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </fieldset>
            );
          })}
        </div>

        <Field
          label="Threshold (optional)"
          hint="An assumption drawn across the chart, such as a covenant minimum."
        >
          <select
            value={draft.threshold ?? ""}
            onChange={(e) => setThreshold(e.target.value)}
            disabled={!thresholds.length}
            className={input}
          >
            <option value="">None</option>
            {thresholds.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>

        {preview && series.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted">Preview</p>
            {preview(draft)}
          </div>
        )}
        {failure && <p className="text-sm text-danger">{failure}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button type="button" className={button.ghost} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={button.primary}
          disabled={pending || !series.length}
          onClick={save}
        >
          {pending ? "Saving…" : initial ? "Save chart" : "Add chart"}
        </button>
      </div>
    </div>
  );
}
