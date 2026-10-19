"use client";

import type { BorrowingBaseMonth, Issue, WaterfallRow } from "@finance/domain";
import { ClipboardPaste, Trash2 } from "lucide-react";
import {
  startTransition,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { toast } from "sonner";
import { ask } from "@/components/confirm";
import { IssueList } from "@/components/issue-list";
import { button, card, input } from "@/components/styles";
import { Field, Icon, Modal, Segmented } from "@/components/ui";
import {
  addMonths,
  describeMonth,
  lastMonthOf,
  QUALITY,
  QUALITY_HELP,
  showFigure,
  type Quality,
} from "@/lib/borrowing-bases";
import { formatDate } from "@/lib/format";
import {
  removeBorrowingBaseMonthAction,
  setBorrowingBaseMonthAction,
  setBorrowingBaseValuesAction,
} from "../actions";
import { PasteCertificates } from "./bb-paste";

// The rows a certificate lists: the lines entered each month, under the
// sections and lines they belong to, such as an aged line's buckets and its
// ineligibles under it.
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

// The client's certificates laid out like the spread: entered lines as
// rows, months as columns. A click selects a figure to type over, F2 or a
// double-click edits it, and Enter moves down the month. A month's header
// opens its quality, the day it came in and a note.
export function BorrowingBaseData({
  lineId,
  rows,
  months,
  issues,
  today,
}: {
  lineId: string;
  rows: WaterfallRow[];
  months: BorrowingBaseMonth[];
  issues: Record<string, Issue[]>;
  today: string;
}) {
  const [pasting, setPasting] = useState(false);
  const [editing, setEditing] = useState<BorrowingBaseMonth | "new" | null>(
    null,
  );
  const shown = useMemo(() => gridRows(rows), [rows]);
  const rowOf = new Map(
    shown.filter((r) => r.entered).map((r, i) => [r.code, i]),
  );
  const scroller = useRef<HTMLDivElement>(null);
  // The latest months in view, as in the results.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  const latest = months.at(-1)?.month;
  const next = latest ? addMonths(latest, 1) : lastMonthOf(today);

  return (
    <section className={`${card} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Certificates</h2>
          <p className="text-xs text-muted">
            Figures from the client&apos;s certificates, in the line&apos;s
            currency unless a line says otherwise. Limits and advance rates are
            terms, not entered here.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className={button.secondary}
            onClick={() => setEditing("new")}
          >
            <Icon name="plus" />
            Add month
          </button>
          <button
            type="button"
            className={button.primary}
            onClick={() => setPasting(true)}
          >
            <Icon name="upload" />
            Paste certificates
          </button>
        </div>
      </div>

      {months.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <span className="grid size-10 place-items-center rounded-full bg-surface-2 text-muted">
            <ClipboardPaste className="size-5" aria-hidden />
          </span>
          <p className="text-sm font-medium">No months yet.</p>
          <p className="max-w-md text-sm text-muted">
            Paste the client&apos;s certificate copied from Excel, one month or
            a history: lines match by code or label, and each column of figures
            becomes a month. Or add a month and type the figures in.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={button.secondary}
              onClick={() => setEditing("new")}
            >
              Add month
            </button>
            <button
              type="button"
              className={button.primary}
              onClick={() => setPasting(true)}
            >
              Paste certificates
            </button>
          </div>
        </div>
      ) : (
        <div ref={scroller} className="max-h-[min(78vh,64rem)] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="sticky top-0 left-0 z-20 min-w-72 border-b border-line bg-surface px-4 py-2 text-left font-medium whitespace-nowrap">
                  Line
                </th>
                {months.map((m) => {
                  const list = issues[m.month] ?? [];
                  return (
                    <th
                      key={m.month}
                      className="sticky top-0 z-10 w-28 min-w-28 border-b border-l border-line bg-surface p-0 text-right font-normal"
                    >
                      <button
                        type="button"
                        onClick={() => setEditing(m)}
                        className="flex w-full flex-col items-end gap-0.5 px-2.5 py-1.5 hover:bg-surface-2"
                        title={
                          [
                            m.receivedOn &&
                              `Received ${formatDate(m.receivedOn)}`,
                            m.note,
                            ...list.map((i) => i.message),
                          ]
                            .filter(Boolean)
                            .join("\n") || "Edit month"
                        }
                      >
                        <span className="flex items-center gap-1.5 font-medium whitespace-nowrap text-foreground">
                          {list.length > 0 && (
                            <span
                              className={`size-1.5 rounded-full ${list.some((i) => i.severity === "error") ? "bg-danger" : "bg-warning"}`}
                              aria-label="has checks"
                            />
                          )}
                          {describeMonth(m.month)}
                        </span>
                        <span>
                          {QUALITY[m.quality]}
                          {m.note ? " · note" : ""}
                        </span>
                      </button>
                    </th>
                  );
                })}
                <th className="sticky top-0 w-full border-b border-line bg-surface" />
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const indent = { paddingLeft: 16 + row.depth * 16 };
                if (row.kind === "section")
                  return (
                    <tr key={row.code}>
                      <td
                        style={indent}
                        className="sticky left-0 z-10 border-b border-line/60 bg-surface pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase"
                      >
                        {row.label}
                      </td>
                      <td
                        colSpan={months.length + 1}
                        className="border-b border-line/60"
                      />
                    </tr>
                  );
                if (!row.entered)
                  return (
                    <tr key={row.code}>
                      <td
                        style={indent}
                        title={row.code}
                        className="sticky left-0 z-10 border-b border-line/60 bg-surface py-1 pr-3 font-medium"
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
                    {months.map((m, col) => (
                      <FigureCell
                        key={m.month}
                        lineId={lineId}
                        month={m.month}
                        row={row}
                        entered={m.figures[row.code]}
                        issue={issues[m.month]?.find(
                          (i) => i.itemCode === row.code,
                        )}
                        index={rowOf.get(row.code)!}
                        col={col}
                      />
                    ))}
                    <td className="border-b border-line/60" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <PasteCertificates
        open={pasting}
        onClose={() => setPasting(false)}
        lineId={lineId}
        existing={months.map((m) => m.month)}
      />
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing === "new" || !editing
            ? "Add a month"
            : `${describeMonth(editing.month)} certificate`
        }
      >
        {editing && (
          <MonthForm
            key={editing === "new" ? "new" : editing.month}
            lineId={lineId}
            month={editing === "new" ? null : editing}
            suggested={next}
            existing={months.map((m) => m.month)}
            issues={editing === "new" ? [] : (issues[editing.month] ?? [])}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </section>
  );
}

function FigureCell({
  lineId,
  month,
  row,
  entered,
  issue,
  index,
  col,
}: {
  lineId: string;
  month: string;
  row: WaterfallRow;
  entered: string | undefined;
  issue: Issue | undefined;
  index: number;
  col: number;
}) {
  // While focused, the raw figure being typed; otherwise null.
  const [draft, setDraft] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [shown, setShown] = useOptimistic(entered);
  const [, startSave] = useTransition();
  const cancelled = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  // Select the whole figure when editing starts, and keep the mouseup that
  // follows a click from collapsing the selection.
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
      const result = await setBorrowingBaseValuesAction(lineId, [
        { month, code: row.code, value: raw },
      ]);
      setFailure(result.ok ? null : result.message);
    });
  }

  // Editing in place, as F2 or a double-click do in Excel: the cursor at the
  // figure's end, to change part of it rather than type it over.
  function editInPlace(el: HTMLInputElement) {
    keepSelection.current = false;
    el.setSelectionRange(el.value.length, el.value.length);
  }

  function move(step: number) {
    document
      .querySelector<HTMLInputElement>(
        `input[data-bb-cell][data-row="${index + step}"][data-col="${col}"]`,
      )
      ?.focus();
  }

  const tone = failure
    ? "ring-2 ring-danger/60"
    : issue
      ? issue.severity === "error"
        ? "ring-1 ring-danger/50"
        : "ring-1 ring-warning/60"
      : "";

  return (
    <td className="border-b border-l border-line/60 p-0">
      <input
        data-bb-cell
        data-row={index}
        data-col={col}
        ref={field}
        value={
          draft ??
          (shown === undefined ? "" : showFigure(shown, row.format, row.code))
        }
        title={failure ?? issue?.message}
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
        className={`h-7 w-full bg-transparent px-2.5 text-right tabular-nums outline-none focus:bg-accent-soft/60 ${tone}`}
      />
    </td>
  );
}

// A month's details: its quality, the day its certificate came in, a note;
// and removing it, figures and all.
function MonthForm({
  lineId,
  month,
  suggested,
  existing,
  issues,
  onDone,
}: {
  lineId: string;
  month: BorrowingBaseMonth | null;
  suggested: string;
  existing: string[];
  issues: Issue[];
  onDone: () => void;
}) {
  const [value, setValue] = useState(month?.month ?? suggested);
  const [quality, setQuality] = useState<Quality>(month?.quality ?? "reported");
  const [receivedOn, setReceivedOn] = useState(month?.receivedOn ?? "");
  const [note, setNote] = useState(month?.note ?? "");
  const [pending, startSave] = useTransition();
  const [removing, startRemove] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  function save(event: FormEvent) {
    event.preventDefault();
    if (!month && existing.includes(value))
      return setFailure(`${describeMonth(value)} is already there.`);
    setFailure(null);
    startSave(async () => {
      const result = await setBorrowingBaseMonthAction(lineId, value, {
        quality,
        receivedOn,
        note,
      });
      if (!result.ok) return setFailure(result.message);
      toast.success(`${describeMonth(value)} ${month ? "saved" : "added"}.`);
      startTransition(onDone);
    });
  }

  async function remove() {
    if (
      !month ||
      !(await ask({
        title: `Remove ${describeMonth(month.month)}?`,
        body: `Its ${Object.keys(month.figures).length} figures are removed with it.`,
        action: "Remove",
        danger: true,
      }))
    )
      return;
    setFailure(null);
    startRemove(async () => {
      const result = await removeBorrowingBaseMonthAction(lineId, month.month);
      if (!result.ok) return setFailure(result.message);
      toast.success(`${describeMonth(month.month)} removed.`);
      startTransition(onDone);
    });
  }

  return (
    <form onSubmit={save} className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
        {issues.length > 0 && (
          <div
            className={`rounded-lg border p-3 ${issues.some((i) => i.severity === "error") ? "border-danger/30 bg-danger-soft/40" : "border-warning/30 bg-warning-soft/40"}`}
          >
            <IssueList issues={issues} />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          {!month ? (
            <Field label="Month">
              <input
                type="month"
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={input}
              />
            </Field>
          ) : (
            <Field label="Month">
              <span className="py-1.5 text-sm font-medium">
                {describeMonth(month.month)}
              </span>
            </Field>
          )}
          <Field label="Quality" hint={QUALITY_HELP[quality]} group>
            <Segmented
              name="quality"
              options={QUALITY}
              value={quality}
              onChange={setQuality}
            />
          </Field>
        </div>
        <Field
          label="Received on"
          hint="The day the client's certificate came in."
        >
          <input
            type="date"
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
            className={`${input} sm:w-48`}
          />
        </Field>
        <Field label="Note">
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={input}
          />
        </Field>
        {failure && <p className="text-sm text-danger">{failure}</p>}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        {month && (
          <button
            type="button"
            className={button.danger}
            onClick={remove}
            disabled={removing}
          >
            <Trash2 />
            {removing ? "Removing…" : "Remove month"}
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" className={button.ghost} onClick={onDone}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={button.primary}>
            {pending ? "Saving…" : month ? "Save" : "Add month"}
          </button>
        </div>
      </div>
    </form>
  );
}
