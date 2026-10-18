"use client";

import type {
  Issue,
  ReconciliationLine,
  ScoringItem,
  Statement,
  StatementQuality,
} from "@finance/domain";
import { ClipboardPaste } from "lucide-react";
import Link from "next/link";
import {
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { button, card } from "@/components/styles";
import { Icon } from "@/components/ui";
import { formatDate, formatFigure } from "@/lib/format";
import { QUALITY_SHORT, STATEMENTS } from "@/lib/labels";
import { setValueAction } from "../actions";
import { PasteDialog } from "./paste-dialog";
import { PeriodDialog, type Checked } from "./period-dialog";

export interface GridPeriod {
  id: string;
  periodEnd: string;
  months: number;
  quality: StatementQuality;
  currency: string;
  consolidated: boolean;
  // What the statements say beyond the figures, which the checks compare
  // the spread with.
  reportedNetIncome: string | null;
  reconciliation: ReconciliationLine[];
}

// The spread laid out like the scoring model: one row per item, one column per
// period. Figures are typed in place; Enter moves down a column, as analysts
// enter one period at a time. The header row and the labels stay in view
// while the grid scrolls, like frozen panes.
export function SpreadGrid({
  entityId,
  items,
  periods,
  values,
  computed,
  checks,
  checked,
  statement,
}: {
  entityId: string;
  items: ScoringItem[];
  periods: GridPeriod[];
  values: Record<string, Record<string, string>>;
  computed: Record<string, Record<string, string>>;
  checks: Record<string, Issue[]>;
  // Which checks against the statements the scoring model turns on.
  checked: Checked;
  statement: Statement;
}) {
  const [pasting, setPasting] = useState(false);
  const [period, setPeriod] = useState<GridPeriod | "new" | null>(null);
  const depth = useMemo(() => depths(items), [items]);
  const rows = items.filter((item) => item.statement === statement);
  const flagged = (periodId: string, code: string) =>
    checks[periodId]?.find((issue) => issue.itemCode === code);
  // Row numbers of the cells, for moving down a column with Enter.
  const rowOf = new Map(
    rows
      .filter((item) => item.kind !== "header")
      .map((item, i) => [item.code, i]),
  );

  return (
    <section className={`${card} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-x-2 border-b border-line px-2">
        <nav className="flex overflow-x-auto" aria-label="Statements">
          {STATEMENTS.map(({ value, label }) => (
            <Link
              key={value}
              href={`?statement=${value}`}
              aria-current={value === statement ? "page" : undefined}
              className="border-b-2 border-transparent px-3 py-2.5 text-sm whitespace-nowrap text-muted hover:text-foreground aria-[current=page]:border-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex gap-2 py-2">
          <button
            type="button"
            className={button.secondary}
            onClick={() => setPeriod("new")}
          >
            <Icon name="plus" />
            Add period
          </button>
          <button
            type="button"
            className={button.primary}
            onClick={() => setPasting(true)}
          >
            <Icon name="upload" />
            Paste spread
          </button>
        </div>
      </div>

      {periods.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <span className="grid size-10 place-items-center rounded-full bg-surface-2 text-muted">
            <ClipboardPaste className="size-5" aria-hidden />
          </span>
          <p className="text-sm font-medium">No periods yet.</p>
          <p className="max-w-md text-sm text-muted">
            Paste the spread copied from the scoring system: lines match by code
            or label, and each column of figures becomes a period. Or add a
            period and type the figures in.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={button.secondary}
              onClick={() => setPeriod("new")}
            >
              Add period
            </button>
            <button
              type="button"
              className={button.primary}
              onClick={() => setPasting(true)}
            >
              Paste spread
            </button>
          </div>
        </div>
      ) : (
        <div className="max-h-[min(78vh,64rem)] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="sticky top-0 left-0 z-20 min-w-64 border-b border-line bg-surface px-4 py-2 text-left font-medium">
                  Line
                </th>
                {periods.map((p) => (
                  <th
                    key={p.id}
                    className="sticky top-0 z-10 w-36 min-w-36 border-b border-l border-line bg-surface p-0 text-right font-normal"
                  >
                    <button
                      type="button"
                      onClick={() => setPeriod(p)}
                      className="flex w-full flex-col items-end gap-0.5 px-3 py-2 hover:bg-surface-2"
                      title="Edit period"
                    >
                      <span className="flex items-center gap-1.5 font-medium text-foreground">
                        {checks[p.id]?.some((i) => i.severity === "error") && (
                          <span
                            className="size-1.5 rounded-full bg-danger"
                            aria-label="has errors"
                          />
                        )}
                        {formatDate(p.periodEnd)}
                      </span>
                      <span>
                        {p.months} mo · {QUALITY_SHORT[p.quality]}
                      </span>
                    </button>
                  </th>
                ))}
                <th className="sticky top-0 border-b border-line bg-surface" />
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const indent = {
                  paddingLeft: 16 + (depth.get(item.code) ?? 0) * 18,
                };
                if (item.kind === "header") {
                  return (
                    <tr key={item.code}>
                      <td
                        colSpan={periods.length + 2}
                        style={indent}
                        className="border-b border-line/60 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase"
                      >
                        {item.label}
                      </td>
                    </tr>
                  );
                }
                const row = rowOf.get(item.code)!;
                const subtotal = item.kind === "subtotal";
                return (
                  <tr
                    key={item.code}
                    className={subtotal ? "bg-surface-2/60 font-medium" : ""}
                  >
                    <td
                      style={indent}
                      title={item.code}
                      className={`sticky left-0 z-10 border-b border-line/60 py-1 pr-3 ${subtotal ? "bg-surface-2" : "bg-surface"}`}
                    >
                      {item.label}
                    </td>
                    {periods.map((p, col) => (
                      <FigureCell
                        key={p.id}
                        periodId={p.id}
                        item={item}
                        entered={values[p.id]?.[item.code]}
                        computed={computed[p.id]?.[item.code]}
                        issue={flagged(p.id, item.code)}
                        row={row}
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

      <PasteDialog
        open={pasting}
        onClose={() => setPasting(false)}
        entityId={entityId}
      />
      <PeriodDialog
        period={period}
        entityId={entityId}
        checked={checked}
        checks={period && period !== "new" ? (checks[period.id] ?? []) : []}
        onClose={() => setPeriod(null)}
      />
    </section>
  );
}

function FigureCell({
  periodId,
  item,
  entered,
  computed,
  issue,
  row,
  col,
}: {
  periodId: string;
  item: ScoringItem;
  entered: string | undefined;
  computed: string | undefined;
  issue: Issue | undefined;
  row: number;
  col: number;
}) {
  // While focused, the raw figure being typed; otherwise null.
  const [draft, setDraft] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [shown, setShown] = useOptimistic(entered);
  const [, startTransition] = useTransition();
  const cancelled = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  // Select the whole figure when editing starts, before the next keystroke,
  // and keep the mouseup that follows a click from collapsing the selection.
  const selectOnEdit = useRef(false);
  const keepSelection = useRef(false);
  useLayoutEffect(() => {
    if (draft !== null && selectOnEdit.current) {
      selectOnEdit.current = false;
      keepSelection.current = true;
      field.current?.select();
    }
  }, [draft]);
  const numeric = item.dataType !== "text" && item.dataType !== "date";

  function commit() {
    const raw = (draft ?? "").trim();
    setDraft(null);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (raw === (entered ?? "")) return;
    startTransition(async () => {
      setShown(raw || undefined);
      const result = await setValueAction(periodId, item.code, raw);
      setFailure(result.ok ? null : result.message);
    });
  }

  function move(step: number) {
    const next = document.querySelector<HTMLInputElement>(
      `input[data-cell][data-row="${row + step}"][data-col="${col}"]`,
    );
    next?.focus();
  }

  const display = shown === undefined ? "" : formatFigure(shown, item.dataType);
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
        data-cell
        data-row={row}
        data-col={col}
        value={draft ?? display}
        placeholder={
          shown === undefined && computed
            ? formatFigure(computed, item.dataType)
            : ""
        }
        title={
          failure ??
          issue?.message ??
          (shown === undefined && computed ? "Sum of the lines" : undefined)
        }
        aria-label={`${item.label}, ${col + 1}`}
        ref={field}
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
        onKeyDown={(e) => {
          keepSelection.current = false;
          if (e.key === "Enter") {
            e.preventDefault();
            move(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        className={`h-8 w-full bg-transparent px-3 outline-none placeholder:text-muted placeholder:italic focus:bg-accent-soft/60 ${numeric ? "text-right tabular-nums" : "text-left"} ${tone}`}
      />
    </td>
  );
}

function depths(items: ScoringItem[]) {
  const parentOf = new Map(items.map((item) => [item.code, item.parentCode]));
  const depth = new Map<string, number>();
  for (const item of items) {
    let d = 0;
    let code = item.parentCode;
    while (code && d < items.length) {
      d++;
      code = parentOf.get(code) ?? null;
    }
    depth.set(item.code, d);
  }
  return depth;
}
