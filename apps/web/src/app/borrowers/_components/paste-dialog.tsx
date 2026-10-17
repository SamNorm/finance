"use client";

import type { PastePreview, StatementQuality } from "@finance/domain";
import { startTransition, useState, useTransition } from "react";
import { IssueList } from "@/components/issue-list";
import { button, input } from "@/components/styles";
import { Modal } from "@/components/ui";
import type { ActionFailure } from "@/lib/action-result";
import { QUALITIES } from "@/lib/labels";
import { pasteSpreadAction, previewPasteAction } from "../actions";

interface ColumnChoice {
  include: boolean;
  periodEnd: string;
  months: number;
  quality: StatementQuality;
}

// Paste cells copied from the scoring system's spread, check how they match,
// set each column's period, then import.
export function PasteDialog({
  open,
  onClose,
  entityId,
}: {
  open: boolean;
  onClose: () => void;
  entityId: string;
}) {
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<{
    source: string;
    result: PastePreview;
  } | null>(null);
  const [choices, setChoices] = useState<ColumnChoice[]>([]);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [checking, startCheck] = useTransition();
  const [importing, startImport] = useTransition();
  const checked = preview?.source === source ? preview.result : null;

  function check() {
    setFailure(null);
    startCheck(async () => {
      const result = await previewPasteAction(entityId, source);
      if (!result.ok) return setFailure(result);
      setPreview({ source, result: result.value });
      setChoices(
        result.value.columns.map((c) => ({
          include: true,
          periodEnd: c.periodEnd ?? "",
          months: c.months ?? 12,
          quality: "audited",
        })),
      );
    });
  }

  function confirmImport() {
    if (!checked) return;
    setFailure(null);
    const targets = checked.columns
      .map((column, i) => ({ index: column.index, ...choices[i]! }))
      .filter((t) => t.include)
      .map(({ index, periodEnd, months, quality }) => ({
        index,
        periodEnd,
        months,
        quality,
      }));
    startImport(async () => {
      const result = await pasteSpreadAction(entityId, source, targets);
      if (!result.ok) return setFailure(result);
      startTransition(() => {
        setSource("");
        setPreview(null);
        onClose();
      });
    });
  }

  const update = (i: number, patch: Partial<ColumnChoice>) =>
    setChoices((all) => all.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const ready =
    checked?.canImport &&
    choices.some((c) => c.include) &&
    choices.every((c) => !c.include || /^\d{4}-\d{2}-\d{2}$/.test(c.periodEnd));

  return (
    <Modal open={open} onClose={onClose} title="Paste spread">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <p className="text-sm text-muted">
          Copy the spread from the scoring system, labels and figures together,
          and paste it here. Lines match by code or exact label; each column of
          figures becomes a period. Pasted figures replace the ones entered
          before.
        </p>
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={
            "\tDec 31, 2023\tDec 31, 2024\nCash and equivalents\t120\t145\n…"
          }
          className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={button.secondary}
            disabled={!source.trim() || checking}
            onClick={check}
          >
            {checking ? "Checking…" : "Check"}
          </button>
          {preview && !checked && source.trim() && (
            <span className="text-xs text-muted">
              The text changed. Check it again.
            </span>
          )}
        </div>

        {checked && (
          <div className="flex flex-col gap-4 rounded-md border border-line p-3">
            <p className="text-sm">
              <span className="font-medium">
                {checked.matched} lines matched
              </span>
              <span className="text-muted">
                {" "}
                · {checked.figures} figures · {checked.unmatched.length} skipped
              </span>
            </p>
            {checked.columns.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="pr-2 pb-1 font-medium">Import</th>
                      <th className="pr-2 pb-1 font-medium">Column</th>
                      <th className="pr-2 pb-1 font-medium">Period end</th>
                      <th className="pr-2 pb-1 font-medium">Months</th>
                      <th className="pb-1 font-medium">Quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checked.columns.map((column, i) => {
                      const choice = choices[i]!;
                      return (
                        <tr key={column.index}>
                          <td className="py-1 pr-2">
                            <input
                              type="checkbox"
                              checked={choice.include}
                              onChange={(e) =>
                                update(i, { include: e.target.checked })
                              }
                              aria-label={`Import column ${column.index + 1}`}
                            />
                          </td>
                          <td className="py-1 pr-2 text-muted">
                            {column.header || `Column ${column.index + 1}`}
                            {column.existingPeriodId && (
                              <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">
                                existing period
                              </span>
                            )}
                          </td>
                          <td className="py-1 pr-2">
                            <input
                              type="date"
                              value={choice.periodEnd}
                              onChange={(e) =>
                                update(i, { periodEnd: e.target.value })
                              }
                              className={`${input} w-40 ${column.guessed ? "border-warning" : ""}`}
                              title={
                                column.guessed
                                  ? "Only a year was given; December 31 is assumed."
                                  : undefined
                              }
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <input
                              type="number"
                              min={1}
                              max={24}
                              value={choice.months}
                              onChange={(e) =>
                                update(i, { months: Number(e.target.value) })
                              }
                              className={`${input} w-20`}
                            />
                          </td>
                          <td className="py-1">
                            <select
                              value={choice.quality}
                              onChange={(e) =>
                                update(i, {
                                  quality: e.target.value as StatementQuality,
                                })
                              }
                              className={`${input} w-44`}
                            >
                              {Object.entries(QUALITIES).map(
                                ([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                ),
                              )}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {checked.columns.some((c) => c.guessed) && (
                  <p className="mt-2 text-xs text-warning">
                    Some headers only give a year; December 31 is assumed. Check
                    the dates.
                  </p>
                )}
              </div>
            )}
            {checked.issues.length > 0 && (
              <IssueList issues={checked.issues} limit={12} />
            )}
          </div>
        )}
        {failure && (
          <div className="flex flex-col gap-2 rounded-md bg-danger-soft p-3">
            <p className="text-sm font-medium text-danger">{failure.message}</p>
            {failure.issues.length > 0 && (
              <IssueList issues={failure.issues} limit={10} />
            )}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button type="button" className={button.ghost} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={button.primary}
          disabled={!ready || importing}
          onClick={confirmImport}
        >
          {importing ? "Importing…" : "Import"}
        </button>
      </div>
    </Modal>
  );
}
