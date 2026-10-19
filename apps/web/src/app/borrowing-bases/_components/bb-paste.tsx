"use client";

import type { BorrowingBasePaste } from "@finance/domain";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { startTransition, useState, useTransition } from "react";
import { toast } from "sonner";
import { IssueList } from "@/components/issue-list";
import { plural } from "@/components/page";
import { button, input } from "@/components/styles";
import { Modal } from "@/components/ui";
import type { ActionFailure } from "@/lib/action-result";
import { describeMonth } from "@/lib/borrowing-bases";
import {
  importBorrowingBasePasteAction,
  previewBorrowingBasePasteAction,
} from "../actions";

// Paste a certificate, or a history of them, out of Excel or a CSV: check
// how its rows match the lines entered each month, confirm or give the
// month of each column, or leave it out, then import
// (borrowing-base-plan.md §7.2).
export function PasteCertificates({
  open,
  onClose,
  lineId,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  lineId: string;
  // Months already entered, whose figures a paste replaces.
  existing: string[];
}) {
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<{
    source: string;
    result: BorrowingBasePaste;
  } | null>(null);
  // Each column's month, and the columns left out, by column index.
  const [months, setMonths] = useState<Record<number, string>>({});
  const [skipped, setSkipped] = useState<number[]>([]);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [checking, startCheck] = useTransition();
  const [importing, startImport] = useTransition();
  const checked = preview?.source === source ? preview.result : null;

  function check() {
    setFailure(null);
    startCheck(async () => {
      const result = await previewBorrowingBasePasteAction(lineId, source);
      if (!result.ok) return setFailure(result);
      setPreview({ source, result: result.value });
      setMonths(
        Object.fromEntries(
          result.value.columns.map((c) => [c.index, c.month ?? ""]),
        ),
      );
      setSkipped([]);
    });
  }

  function confirmImport() {
    if (!checked) return;
    setFailure(null);
    startImport(async () => {
      const result = await importBorrowingBasePasteAction(
        lineId,
        source,
        months,
        skipped,
      );
      if (!result.ok) return setFailure(result);
      toast.success(`${plural(kept.length, "month")} imported.`);
      startTransition(() => {
        setSource("");
        setPreview(null);
        onClose();
      });
    });
  }

  const kept = (checked?.columns ?? []).filter(
    (c) => !skipped.includes(c.index),
  );
  const figures =
    checked?.matched.reduce(
      (n, row) =>
        n +
        row.cells.filter(
          (cell, i) =>
            cell.trim() && !skipped.includes(checked.columns[i]!.index),
        ).length,
      0,
    ) ?? 0;
  const errors = checked?.issues.some((i) => i.severity === "error");
  const ready =
    checked &&
    !errors &&
    kept.length > 0 &&
    checked.matched.length > 0 &&
    kept.every((c) => /^\d{4}-\d{2}$/.test(months[c.index] ?? ""));

  return (
    <Modal open={open} onClose={onClose} title="Paste certificates" wide>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <p className="text-sm text-muted">
          Copy the certificate from Excel, labels and figures together: one
          month, or a history with a column per month. Rows match the lines
          entered each month by code or exact label, in order; headers such as
          &ldquo;Dec-24&rdquo; or &ldquo;2024-12-31&rdquo; give the months.
          Pasted figures replace those entered before.
        </p>
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={
            "\tJan-25\tFeb-25\nCurrent\t1,250,000\t1,310,000\n31–60 days\t420,000\t398,000\n…"
          }
          className="w-full shrink-0 rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
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
          <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface-2/40 p-3">
            <p className="flex items-center gap-2 text-sm">
              {ready ? (
                <CircleCheck className="size-4 text-success" aria-hidden />
              ) : (
                <TriangleAlert className="size-4 text-warning" aria-hidden />
              )}
              <span className="font-medium">
                {plural(checked.matched.length, "line")} matched
              </span>
              <span className="text-muted">
                · {plural(figures, "figure")} · {plural(kept.length, "month")}
                {skipped.length > 0 && ` (${skipped.length} left out)`} ·{" "}
                {plural(checked.unmatched.length, "row")} skipped
              </span>
            </p>

            {checked.columns.length > 0 && (
              <div className="overflow-x-auto">
                <table className="text-sm">
                  <thead>
                    <tr className="text-xs text-muted">
                      <th className="sticky left-0 bg-surface-2/40 pr-3 pb-1 text-left font-medium">
                        Line
                      </th>
                      {checked.columns.map((column) => {
                        const month = months[column.index] ?? "";
                        const out = skipped.includes(column.index);
                        const name =
                          column.header || `column ${column.index + 1}`;
                        return (
                          <th
                            key={column.index}
                            className={`min-w-36 px-1 pb-1 text-right align-bottom font-normal ${out ? "opacity-50" : ""}`}
                          >
                            <label className="flex items-center justify-end gap-1.5">
                              <input
                                type="checkbox"
                                checked={!out}
                                onChange={(e) =>
                                  setSkipped(
                                    e.target.checked
                                      ? skipped.filter(
                                          (i) => i !== column.index,
                                        )
                                      : [...skipped, column.index],
                                  )
                                }
                                aria-label={`Import ${name}`}
                              />
                              <span className="truncate">
                                {column.header || `Column ${column.index + 1}`}
                              </span>
                            </label>
                            <input
                              type="month"
                              value={month}
                              disabled={out}
                              aria-label={`Month of ${column.header || `column ${column.index + 1}`}`}
                              onChange={(e) =>
                                setMonths({
                                  ...months,
                                  [column.index]: e.target.value,
                                })
                              }
                              title={
                                column.guessed
                                  ? "Day and month order assumed: check it."
                                  : undefined
                              }
                              className={`${input} mt-1 w-36 py-1 text-xs ${!out && (column.guessed || !month) ? "border-warning" : ""}`}
                            />
                            {!out && existing.includes(month) && (
                              <span className="mt-1 block text-[11px] text-accent">
                                Replaces {describeMonth(month)}
                              </span>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {checked.matched.map((row) => (
                      <tr key={row.row} className="border-t border-line/60">
                        <td className="sticky left-0 bg-surface-2/40 py-1 pr-3 whitespace-nowrap">
                          {row.label}
                          <span className="ml-2 font-mono text-[11px] text-muted">
                            {row.code}
                          </span>
                        </td>
                        {row.cells.map((cell, i) => (
                          <td
                            key={i}
                            className={`px-1 py-1 text-right tabular-nums ${skipped.includes(checked.columns[i]!.index) ? "text-muted line-through" : ""}`}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {checked.columns.some((c) => c.guessed) && (
                  <p className="mt-2 text-xs text-warning">
                    Some headers could be read day first or month first; the
                    months shown are assumed. Check them.
                  </p>
                )}
                {kept.some((c) => !months[c.index]) && (
                  <p className="mt-2 text-xs text-warning">
                    Give the month of each column whose header isn&apos;t one,
                    or leave the column out.
                  </p>
                )}
              </div>
            )}
            {/* Rows that match no line come back as warnings. */}
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
