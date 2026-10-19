"use client";

import type {
  AnalysisBorrowingBase,
  BorrowingBasePaste,
  WaterfallRow,
} from "@finance/domain";
import { CircleCheck, TriangleAlert } from "lucide-react";
import {
  startTransition,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { IssueList } from "@/components/issue-list";
import { plural } from "@/components/page";
import { button, card, input } from "@/components/styles";
import { Icon, Modal } from "@/components/ui";
import type { ActionFailure, ActionResult } from "@/lib/action-result";
import { describeMonth, showFigure } from "@/lib/borrowing-bases";
import {
  importProjectedBorrowingBasePasteAction,
  previewProjectedBorrowingBasePasteAction,
} from "../borrowing-base-actions";

// Figures for a line's projected months, laid out as its certificates are
// on the line's Data tab: entered lines as rows, months as columns. The
// base case holds the client's projections, entered or pasted from its
// forecast; a scenario holds its own figures over them, such as an extra
// ineligible from a month. A blank figure shows, greyed, what the
// projection gives without it.

// The rows a certificate lists: entered lines, under the sections and
// lines they belong to.
function gridRows(rows: readonly WaterfallRow[]) {
  return rows.filter((row, i) => {
    if (row.entered) return true;
    if (row.kind !== "section" && row.kind !== "line") return false;
    for (let j = i + 1; j < rows.length; j++) {
      const below = rows[j]!;
      if (below.kind === "section") return false;
      if (row.kind === "line" && below.depth <= row.depth) return false;
      if (below.entered) return true;
    }
    return false;
  });
}

export function ProjectedFigures({
  line,
  title,
  description,
  figures,
  onCommit,
  actions,
}: {
  line: AnalysisBorrowingBase;
  title: string;
  description: string;
  // The figures held, by month then code.
  figures: Record<string, Record<string, string>>;
  onCommit: (month: string, code: string, raw: string) => Promise<ActionResult>;
  actions?: ReactNode;
}) {
  const shown = useMemo(() => gridRows(line.rows), [line.rows]);
  const rowOf = new Map(
    shown.filter((r) => r.entered).map((r, i) => [r.code, i]),
  );
  const months = line.run.months
    .map((m, p) => ({ ...m, p }))
    .filter((m) => m.projected);
  return (
    <section className={`${card} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted">{description}</p>
        </div>
        {actions && <div className="ml-auto flex gap-2">{actions}</div>}
      </div>
      {months.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">
          No month is projected: the line has no certificates to project from,
          or it closes before the projection starts.
        </p>
      ) : (
        <div className="max-h-[min(70vh,48rem)] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="sticky top-0 left-0 z-20 min-w-72 border-b border-line bg-surface px-4 py-2 text-left font-medium whitespace-nowrap">
                  Line
                </th>
                {months.map((m) => (
                  <th
                    key={m.month}
                    className="sticky top-0 z-10 w-28 min-w-28 border-b border-l border-line bg-surface px-2.5 py-2 text-right font-medium whitespace-nowrap text-foreground"
                  >
                    {describeMonth(m.month)}
                  </th>
                ))}
                <th className="sticky top-0 w-full border-b border-line bg-surface" />
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const indent = { paddingLeft: 16 + row.depth * 16 };
                if (row.kind === "section" || !row.entered)
                  return (
                    <tr key={row.code}>
                      <td
                        style={indent}
                        title={row.code}
                        className={`sticky left-0 z-10 border-b border-line/60 bg-surface pr-3 ${row.kind === "section" ? "pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase" : "py-1 font-medium"}`}
                      >
                        {row.label}
                      </td>
                      <td
                        colSpan={months.length + 1}
                        className="border-b border-line/60"
                      />
                    </tr>
                  );
                return (
                  <tr key={row.code}>
                    <td
                      style={indent}
                      title={row.help ? `${row.code} · ${row.help}` : row.code}
                      className="sticky left-0 z-10 border-b border-line/60 bg-surface py-1 pr-3"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="truncate">{row.label}</span>
                        {row.currency && (
                          <span className="rounded bg-surface-2 px-1 text-[11px] text-muted">
                            {row.currency}
                          </span>
                        )}
                      </span>
                    </td>
                    {months.map((m, col) => {
                      const projected = line.run.cells[row.code]?.[m.p]?.value;
                      return (
                        <FigureCell
                          key={m.month}
                          month={m.month}
                          row={row}
                          entered={figures[m.month]?.[row.code]}
                          projected={
                            projected === null || projected === undefined
                              ? ""
                              : showFigure(projected, row.format, row.code)
                          }
                          index={rowOf.get(row.code)!}
                          col={col}
                          onCommit={onCommit}
                        />
                      );
                    })}
                    <td className="border-b border-line/60" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// A figure typed over, as on the Data tab: a click selects it, F2 or a
// double-click edits it, Enter moves down the month, Escape cancels.
function FigureCell({
  month,
  row,
  entered,
  projected,
  index,
  col,
  onCommit,
}: {
  month: string;
  row: WaterfallRow;
  entered: string | undefined;
  // What the projection gives when it's blank.
  projected: string;
  index: number;
  col: number;
  onCommit: (month: string, code: string, raw: string) => Promise<ActionResult>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [shown, setShown] = useOptimistic(entered);
  const [, startSave] = useTransition();
  const cancelled = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const selectOnEdit = useRef(false);
  const keepSelection = useRef(false);
  useLayoutEffect(() => {
    if (draft !== null && selectOnEdit.current) {
      selectOnEdit.current = false;
      keepSelection.current = true;
      field.current?.select();
    }
  }, [draft]);

  function commit() {
    const raw = (draft ?? "").trim();
    setDraft(null);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (raw === (entered ?? "")) return;
    startSave(async () => {
      setShown(raw || undefined);
      const result = await onCommit(month, row.code, raw);
      setFailure(result.ok ? null : result.message);
    });
  }

  function editInPlace(el: HTMLInputElement) {
    keepSelection.current = false;
    el.setSelectionRange(el.value.length, el.value.length);
  }

  function move(step: number) {
    document
      .querySelector<HTMLInputElement>(
        `input[data-bbp-cell][data-row="${index + step}"][data-col="${col}"]`,
      )
      ?.focus();
  }

  return (
    <td className="border-b border-l border-line/60 p-0">
      <input
        data-bbp-cell
        data-row={index}
        data-col={col}
        ref={field}
        value={
          draft ??
          (shown === undefined ? "" : showFigure(shown, row.format, row.code))
        }
        placeholder={projected}
        title={
          failure ??
          (shown === undefined && projected
            ? `Blank: the projection gives ${projected}`
            : undefined)
        }
        aria-label={`${row.label}, ${describeMonth(month)}`}
        onFocus={() => {
          selectOnEdit.current = true;
          setDraft(entered ?? "");
        }}
        onMouseUp={(e) => {
          if (keepSelection.current) e.preventDefault();
          keepSelection.current = false;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onDoubleClick={(e) => editInPlace(e.currentTarget)}
        onKeyDown={(e) => {
          keepSelection.current = false;
          if (e.key === "F2") {
            e.preventDefault();
            editInPlace(e.currentTarget);
          } else if (e.key === "Enter") {
            e.preventDefault();
            move(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        className={`h-7 w-full px-2.5 text-right tabular-nums outline-none placeholder:text-muted/60 placeholder:italic focus:bg-accent-soft/60 ${shown === undefined ? "bg-transparent" : "bg-accent-soft/30"} ${failure ? "ring-2 ring-danger/60" : ""}`}
      />
    </td>
  );
}

// The client's projections pasted out of Excel or a CSV, a column per
// month: check how rows match the lines entered each month, give the month
// of a column whose header isn't one, then import.
export function PasteProjections({
  open,
  onClose,
  analysisId,
  line,
}: {
  open: boolean;
  onClose: () => void;
  analysisId: string;
  line: AnalysisBorrowingBase;
}) {
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<{
    source: string;
    result: BorrowingBasePaste;
  } | null>(null);
  const [months, setMonths] = useState<Record<number, string>>({});
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [checking, startCheck] = useTransition();
  const [importing, startImport] = useTransition();
  const checked = preview?.source === source ? preview.result : null;
  const projected = new Set(
    line.run.months.filter((m) => m.projected).map((m) => m.month),
  );
  const existing = new Set(Object.keys(line.clientFigures));

  function check() {
    setFailure(null);
    startCheck(async () => {
      const result = await previewProjectedBorrowingBasePasteAction(
        analysisId,
        line.key,
        source,
      );
      if (!result.ok) return setFailure(result);
      setPreview({ source, result: result.value });
      setMonths(
        Object.fromEntries(
          result.value.columns.map((c) => [c.index, c.month ?? ""]),
        ),
      );
    });
  }

  function confirmImport() {
    if (!checked) return;
    setFailure(null);
    startImport(async () => {
      const result = await importProjectedBorrowingBasePasteAction(
        analysisId,
        line.key,
        source,
        months,
      );
      if (!result.ok) return setFailure(result);
      startTransition(() => {
        setSource("");
        setPreview(null);
        onClose();
      });
    });
  }

  const columns = checked?.columns ?? [];
  const figures =
    checked?.matched.reduce(
      (n, row) => n + row.cells.filter((cell) => cell.trim()).length,
      0,
    ) ?? 0;
  const ready =
    checked &&
    !checked.issues.some((i) => i.severity === "error") &&
    columns.length > 0 &&
    checked.matched.length > 0 &&
    columns.every((c) => /^\d{4}-\d{2}$/.test(months[c.index] ?? ""));
  const outside = columns.filter(
    (c) => months[c.index] && !projected.has(months[c.index]!),
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Paste the client's projections · ${line.name}`}
      wide
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <p className="text-sm text-muted">
          Copy the client&apos;s monthly forecast from Excel, labels and figures
          together, a column per month. Rows match the lines entered each month
          by code or exact label; headers such as &ldquo;Jan-25&rdquo; or
          &ldquo;2025-01-31&rdquo; give the months. Pasted figures replace those
          entered before for the same months.
        </p>
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={
            "\tJan-25\tFeb-25\nCurrent\t1,250,000\t1,310,000\nLine outstanding\t2,100,000\t2,240,000\n…"
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
                · {plural(figures, "figure")} ·{" "}
                {plural(columns.length, "month")} ·{" "}
                {plural(checked.unmatched.length, "row")} skipped
              </span>
            </p>
            {columns.length > 0 && (
              <div className="overflow-x-auto">
                <table className="text-sm">
                  <thead>
                    <tr className="text-xs text-muted">
                      <th className="sticky left-0 bg-surface-2/40 pr-3 pb-1 text-left font-medium">
                        Line
                      </th>
                      {columns.map((column) => {
                        const month = months[column.index] ?? "";
                        const name =
                          column.header || `Column ${column.index + 1}`;
                        return (
                          <th
                            key={column.index}
                            className="min-w-36 px-1 pb-1 text-right align-bottom font-normal"
                          >
                            <span className="block truncate">{name}</span>
                            <input
                              type="month"
                              value={month}
                              aria-label={`Month of ${name}`}
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
                              className={`${input} mt-1 w-36 py-1 text-xs ${column.guessed || !month ? "border-warning" : ""}`}
                            />
                            {month && !projected.has(month) ? (
                              <span className="mt-1 block text-[11px] text-warning">
                                Not a projected month
                              </span>
                            ) : (
                              existing.has(month) && (
                                <span className="mt-1 block text-[11px] text-accent">
                                  Replaces {describeMonth(month)}
                                </span>
                              )
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
                            className="px-1 py-1 text-right tabular-nums"
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {outside.length > 0 && (
                  <p className="mt-2 text-xs text-warning">
                    {plural(outside.length, "column")} fall outside the months
                    projected: they&apos;re saved, but left out of the
                    projection until it reaches them.
                  </p>
                )}
                {columns.some((c) => !months[c.index]) && (
                  <p className="mt-2 text-xs text-warning">
                    Give the month of each column whose header isn&apos;t one.
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

// The paste's button, for the client's figures' header.
export function PasteButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={button.secondary} onClick={onClick}>
      <Icon name="upload" />
      Paste projections
    </button>
  );
}
