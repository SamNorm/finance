"use client";

import type {
  AnalysisRun,
  LineageRef,
  ModelLine,
  ResultCell,
  ResultValue,
  RunPeriod,
} from "@finance/domain";
import { Dec } from "@finance/engine";
import { TriangleAlert } from "lucide-react";
import {
  useOptimistic,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { button } from "@/components/styles";
import { Modal } from "@/components/ui";
import { formatDate, formatFigure } from "@/lib/format";
import { QUALITY_SHORT } from "@/lib/labels";
import { saveModelInputAction, updateAnalysisAction } from "../actions";

type Format = ModelLine["format"];

const SOURCES: Record<LineageRef["source"], string> = {
  calculation: "Calculation",
  assumption: "Assumption",
  entered: "Entered",
  summed: "Sum of lines",
  adjustment: "Project",
  schedule: "Debt schedule",
  capex: "Capex plan",
  blank: "Blank",
};

type Group = "historical" | "ytd" | "projections";

const GROUPS: Record<Group, string> = {
  historical: "Historical",
  ytd: "Year to date",
  projections: "Projections",
};

const groupOf = (p: RunPeriod): Group =>
  p.projection ? "projections" : p.months === 12 ? "historical" : "ytd";

// Which run a value comes from: the scenario as is, or with its project.
interface Trail {
  code: string;
  period: number;
  post: boolean;
}

interface Column {
  key: string;
  index: number;
  post: boolean;
  period: RunPeriod;
  group: Group;
}

// Folded groups last the session, across scenarios and analyses: a small
// store kept in sessionStorage when it's available.
const COLLAPSED = "results-collapsed-groups";
const listeners = new Set<() => void>();
let folded: string | null = null;
const foldedSnapshot = () => {
  if (folded === null) {
    try {
      folded = sessionStorage.getItem(COLLAPSED) ?? "[]";
    } catch {
      folded = "[]";
    }
  }
  return folded;
};
const subscribeFolded = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
function setFolded(groups: Group[]) {
  folded = JSON.stringify(groups);
  try {
    sessionStorage.setItem(COLLAPSED, folded);
  } catch {}
  for (const listener of listeners) listener();
}

// The model's lines over the analysis's periods. Every value opens its
// lineage: the formula and each value it read, down to the spread. Input
// lines are entered here, in the spread's periods. With a project, a
// post-project column can sit next to the last fiscal year and any later
// period; columns group into historical years, year to date and
// projections, each of which folds away.
export function ResultsTable({
  analysisId,
  lines,
  run,
  base,
  project,
  postProject,
  scenarioName,
  imbalance = null,
}: {
  analysisId: string;
  lines: ModelLine[];
  run: AnalysisRun;
  // The base case, when a scenario is shown, to compare against.
  base: AnalysisRun | null;
  // The scenario with its project, when it has one.
  project: AnalysisRun | null;
  // Periods shown with a post-project column, by key.
  postProject: string[];
  scenarioName: string | null;
  // How the scenario's project is out of balance, when it is.
  imbalance?: string | null;
}) {
  const [trail, setTrail] = useState<Trail[]>([]);
  const [keys, setKeys] = useOptimistic(postProject);
  const [, startTransition] = useTransition();
  const collapsed = JSON.parse(
    useSyncExternalStore(subscribeFolded, foldedSnapshot, () => "[]"),
  ) as Group[];
  const [failure, setFailure] = useState<string | null>(null);
  const formats = new Map(lines.map((l) => [l.code, l.format]));
  const open = (code: string, period: number, post: boolean) =>
    setTrail([{ code, period, post }]);

  // Post-project means something from the last fiscal year on.
  const lastYear = run.periods.findLastIndex(
    (p) => !p.projection && p.months === 12,
  );
  const eligible = (i: number) =>
    project !== null && (run.periods[i]!.projection !== null || i >= lastYear);
  const columns: Column[] = run.periods.flatMap((period, index) => {
    const asIs = {
      key: period.key,
      index,
      post: false,
      period,
      group: groupOf(period),
    };
    return eligible(index) && keys.includes(period.key)
      ? [asIs, { ...asIs, key: `${period.key}:post`, post: true }]
      : [asIs];
  });
  const groups = columns.reduce<{ group: Group; columns: Column[] }[]>(
    (list, column) => {
      const last = list.at(-1);
      if (last?.group === column.group) last.columns.push(column);
      else list.push({ group: column.group, columns: [column] });
      return list;
    },
    [],
  );
  const showGroups = groups.length > 1 || collapsed.length > 0;
  const visible = groups.flatMap((g): (Column | { fold: Group })[] =>
    collapsed.includes(g.group) ? [{ fold: g.group }] : g.columns,
  );

  function toggleGroup(group: Group) {
    setFolded(
      collapsed.includes(group)
        ? collapsed.filter((g) => g !== group)
        : [...collapsed, group],
    );
  }

  function togglePost(key: string) {
    const next = keys.includes(key)
      ? keys.filter((k) => k !== key)
      : [...keys, key];
    setFailure(null);
    startTransition(async () => {
      setKeys(next);
      const result = await updateAnalysisAction(analysisId, {
        postProjectKeys: next,
      });
      if (!result.ok) setFailure(result.message);
    });
  }

  const shade = (column: Column) =>
    column.post
      ? "bg-accent-soft/50"
      : column.period.projection
        ? "bg-surface-2/60"
        : "";

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      {failure && (
        <p className="border-b border-line px-4 py-2 text-sm text-danger">
          {failure}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            {showGroups && (
              <tr className="text-xs">
                <th className="sticky left-0 z-10 border-b border-line bg-surface" />
                {groups.map((g) => {
                  const folded = collapsed.includes(g.group);
                  const periods = g.columns.filter((c) => !c.post).length;
                  return (
                    <th
                      key={g.group}
                      colSpan={folded ? 1 : g.columns.length}
                      className="border-b border-l border-line px-2 py-1 text-left font-medium"
                    >
                      <button
                        type="button"
                        aria-expanded={!folded}
                        onClick={() => toggleGroup(g.group)}
                        className="flex items-center gap-1 rounded px-1 text-muted hover:bg-surface-2 hover:text-foreground"
                        title={
                          folded ? "Show these columns" : "Fold these columns"
                        }
                      >
                        <span aria-hidden>{folded ? "▸" : "▾"}</span>
                        {GROUPS[g.group]}
                        {folded && (
                          <span className="font-normal">({periods})</span>
                        )}
                      </button>
                    </th>
                  );
                })}
                <th className="border-b border-line" />
              </tr>
            )}
            <tr className="text-xs text-muted">
              <th className="sticky left-0 z-10 min-w-64 border-b border-line bg-surface px-4 py-2 text-left font-medium">
                {scenarioName ?? "Base case"}
              </th>
              {visible.map((column) =>
                "fold" in column ? (
                  <th
                    key={`fold:${column.fold}`}
                    className="w-8 min-w-8 border-b border-l border-line bg-surface-2"
                  />
                ) : (
                  <th
                    key={column.key}
                    className={`w-36 min-w-36 border-b border-l border-line px-3 py-2 text-right align-top font-normal ${column.post ? "bg-accent-soft/50" : column.period.projection ? "bg-surface-2" : ""}`}
                  >
                    <span className="block font-medium text-foreground">
                      {formatDate(column.period.end)}
                    </span>
                    {column.post ? (
                      <span
                        className={`flex items-center justify-end gap-1 ${imbalance ? "text-danger" : "text-accent"}`}
                        title={
                          imbalance
                            ? `${imbalance}: these figures don't balance`
                            : undefined
                        }
                      >
                        {imbalance && (
                          <TriangleAlert className="size-3.5" aria-hidden />
                        )}
                        Post-project
                        <button
                          type="button"
                          onClick={() => togglePost(column.period.key)}
                          className="rounded px-0.5 text-muted hover:bg-surface-2 hover:text-foreground"
                          aria-label={`Remove the post-project column for ${formatDate(column.period.end)}`}
                          title="Remove this post-project column"
                        >
                          ×
                        </button>
                      </span>
                    ) : (
                      <>
                        {periodLabel(column.period)}
                        {eligible(column.index) &&
                          !keys.includes(column.period.key) && (
                            <button
                              type="button"
                              onClick={() => togglePost(column.period.key)}
                              className="mt-0.5 block w-full rounded text-right text-[11px] text-accent hover:underline"
                            >
                              + Post-project
                            </button>
                          )}
                      </>
                    )}
                  </th>
                ),
              )}
              <th className="border-b border-line" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              if (line.kind === "header") {
                return (
                  <tr key={line.code}>
                    <td
                      colSpan={visible.length + 2}
                      className="border-b border-line/60 px-4 pt-4 pb-1 text-xs font-semibold tracking-wide text-muted uppercase"
                    >
                      {line.label}
                    </td>
                  </tr>
                );
              }
              const assumption =
                line.kind === "assumption"
                  ? run.assumptions[line.code]
                  : undefined;
              return (
                <tr
                  key={line.code}
                  className={line.kind === "assumption" ? "text-muted" : ""}
                >
                  <td
                    title={line.code}
                    className="sticky left-0 z-10 border-b border-line/60 bg-surface py-1.5 pr-3 pl-4"
                  >
                    {line.label}
                    {line.kind === "input" && (
                      <span
                        className="ml-2 rounded bg-surface-2 px-1 text-[11px] text-muted"
                        title={
                          line.breaksDown
                            ? `Entered for this model; part of ${line.breaksDown}.`
                            : "Entered for this model."
                        }
                      >
                        input
                      </span>
                    )}
                    {assumption?.overridden && (
                      <span className="ml-2 rounded bg-accent-soft px-1 text-[11px] text-accent">
                        scenario
                      </span>
                    )}
                  </td>
                  {visible.map((column) => {
                    if ("fold" in column)
                      return (
                        <td
                          key={`fold:${column.fold}`}
                          className="border-b border-l border-line/60 bg-surface-2"
                        />
                      );
                    const source = column.post ? project! : run;
                    const i = column.index;
                    const p = column.period;
                    const cell = source.cells[line.code]?.[i];
                    const baseCell = column.post
                      ? undefined
                      : base?.cells[line.code]?.[i];
                    return (
                      <td
                        key={column.key}
                        className={`border-b border-l border-line/60 p-0 text-right tabular-nums ${shade(column)}`}
                      >
                        {assumption ? (
                          <span
                            className={`block px-3 py-1.5 ${source.assumptions[line.code]?.byPeriod.includes(p.key) ? "text-accent" : ""}`}
                            title={
                              source.assumptions[line.code]?.byPeriod.includes(
                                p.key,
                              )
                                ? `${scenarioName}'s value for this year`
                                : undefined
                            }
                          >
                            {formatFigure(
                              flag(cell?.value ?? null, line.format),
                              line.format,
                            )}
                          </span>
                        ) : cell &&
                          !column.post &&
                          line.kind === "input" &&
                          p.projection !== "assumptions" ? (
                          <InputCell
                            key={cell.value ?? ""}
                            analysisId={analysisId}
                            period={p}
                            line={line}
                            value={cell.value}
                          />
                        ) : cell ? (
                          <button
                            type="button"
                            onClick={() => open(line.code, i, column.post)}
                            className="flex w-full flex-col items-end px-3 py-1.5 hover:bg-accent-soft/60"
                            title="Show how this was computed"
                          >
                            <Value cell={cell} format={line.format} />
                            {baseCell && differs(baseCell, cell) && (
                              <span className="text-[11px] text-muted">
                                base{" "}
                                <Value
                                  cell={baseCell}
                                  format={line.format}
                                  plain
                                />
                              </span>
                            )}
                          </button>
                        ) : null}
                      </td>
                    );
                  })}
                  <td className="border-b border-line/60" />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Lineage
        trail={trail}
        onTrail={setTrail}
        runs={{ asIs: run, post: project }}
        lines={lines}
        formats={formats}
      />
    </section>
  );
}

// A value as typed: percentages as "5%", the rest as stored.
const typed = (raw: string | null, format: Format) =>
  raw === null
    ? ""
    : format === "percent"
      ? `${new Dec(raw).times(100).toString()}%`
      : format === "flag"
        ? raw.toUpperCase()
        : raw;

// A model input figure, edited in place: Enter or leaving the cell saves,
// Escape cancels, and a blank clears it.
function InputCell({
  analysisId,
  period,
  line,
  value,
}: {
  analysisId: string;
  period: RunPeriod;
  line: ModelLine;
  value: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useOptimistic<string | null>(null);

  function save(raw: string) {
    setEditing(false);
    if (raw.trim() === typed(value, line.format)) return;
    startTransition(async () => {
      setSaving(raw.trim());
      const result = await saveModelInputAction(
        analysisId,
        period.key,
        line.code,
        raw,
      );
      startTransition(() => setFailure(result.ok ? null : result.message));
    });
  }

  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={typed(value, line.format)}
        aria-label={`${line.label}, ${formatDate(period.end)}`}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => save(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
        }}
        className="block w-full bg-surface px-3 py-1.5 text-right tabular-nums ring-2 ring-accent outline-none ring-inset"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={failure ?? `Enter ${line.label.toLowerCase()} for this period`}
      className={`block w-full px-3 py-1.5 text-right hover:bg-accent-soft/60 ${failure ? "text-danger ring-1 ring-danger ring-inset" : ""} ${pending ? "text-muted" : ""}`}
    >
      {pending && saving !== null
        ? saving || "–"
        : formatFigure(flag(value, line.format), line.format) || (
            <span className="text-xs text-muted">Enter</span>
          )}
      {failure && (
        <span className="block text-[11px] whitespace-normal text-danger">
          {failure}
        </span>
      )}
    </button>
  );
}

function periodLabel(period: RunPeriod) {
  if (period.projection === "assumptions") return "Projected";
  if (period.projection === "client")
    return period.months === 12
      ? "Client projection"
      : `${period.months} mo · Client`;
  return `${period.months} mo · ${QUALITY_SHORT[period.quality]}`;
}

const flag = (value: string | null, format: Format) =>
  format === "flag" && value !== null
    ? value === "TRUE"
      ? "true"
      : value === "FALSE"
        ? "false"
        : value
    : value;

const differs = (a: ResultValue, b: ResultValue) =>
  a.value !== b.value || a.error?.code !== b.error?.code;

function Value({
  cell,
  format,
  plain = false,
}: {
  cell: ResultValue;
  format: Format;
  plain?: boolean;
}) {
  if (cell.error) {
    // No earlier period to compare with is expected in the first column.
    if (cell.error.code === "#N/A") {
      return (
        <span className="text-xs text-muted" title={cell.error.message}>
          n/a
        </span>
      );
    }
    return (
      <span
        className="font-mono text-xs text-warning"
        title={cell.error.message}
      >
        {cell.error.code}
      </span>
    );
  }
  const text = formatFigure(cell.value, format);
  if (format === "flag" && !plain && cell.value !== null) {
    const pass = cell.value === "true";
    return (
      <span
        className={`rounded px-1.5 text-xs font-medium ${pass ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}
      >
        {text}
      </span>
    );
  }
  return <span>{text || "–"}</span>;
}

function Lineage({
  trail,
  onTrail,
  runs,
  lines,
  formats,
}: {
  trail: Trail[];
  onTrail: (trail: Trail[]) => void;
  runs: { asIs: AnalysisRun; post: AnalysisRun | null };
  lines: ModelLine[];
  formats: Map<string, Format>;
}) {
  const current = trail.at(-1);
  const run = (current?.post ? runs.post : null) ?? runs.asIs;
  const cell: ResultCell | undefined = current
    ? run.cells[current.code]?.[current.period]
    : undefined;
  const line = current ? lines.find((l) => l.code === current.code) : undefined;
  const period = current ? run.periods[current.period] : undefined;
  const format = line?.format ?? "amount";

  return (
    <Modal
      side
      open={trail.length > 0}
      onClose={() => onTrail([])}
      title="How this was computed"
    >
      {current && cell && line && period && (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          {trail.length > 1 && (
            <button
              type="button"
              className={`${button.ghost} self-start`}
              onClick={() => onTrail(trail.slice(0, -1))}
            >
              ← Back
            </button>
          )}
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted">
              {formatDate(period.end)} · {periodLabel(period)}
              {current.post ? " · Post-project" : ""}
            </p>
            <p className="text-lg font-semibold">{line.label}</p>
            <p className="text-2xl tabular-nums">
              <Value cell={cell} format={format} />
            </p>
            {cell.error && (
              <p className="text-sm text-warning">{cell.error.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted">
              {period.projection === "assumptions" && line.projectionFormula
                ? "Projection formula"
                : "Formula"}
            </p>
            <code className="rounded-md bg-surface-2 px-3 py-2 font-mono text-xs break-words">
              {cell.formula}
            </code>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted">Reads</p>
            {cell.refs.length === 0 ? (
              <p className="text-sm text-muted">
                Nothing: the formula uses constants only.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-md border border-line">
                {cell.refs.map((ref, i) => {
                  const refPeriod = run.periods[ref.period];
                  const drillable =
                    ref.source === "calculation" &&
                    run.cells[ref.code]?.[ref.period];
                  const content = (
                    <>
                      <span className="flex min-w-0 flex-col items-start">
                        <span className="truncate">{ref.label}</span>
                        <span className="text-xs text-muted">
                          <span className="font-mono">{ref.code}</span>
                          {refPeriod && ref.period !== current.period
                            ? ` · ${formatDate(refPeriod.end)}`
                            : ""}{" "}
                          · {SOURCES[ref.source]}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        <Value
                          cell={ref}
                          format={formats.get(ref.code) ?? "amount"}
                          plain
                        />
                      </span>
                    </>
                  );
                  return (
                    <li key={i}>
                      {drillable ? (
                        <button
                          type="button"
                          onClick={() =>
                            onTrail([
                              ...trail,
                              {
                                code: ref.code,
                                period: ref.period,
                                post: current.post,
                              },
                            ])
                          }
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent-soft/60"
                        >
                          {content}
                        </button>
                      ) : (
                        <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          {content}
                        </div>
                      )}
                      {ref.parts && ref.parts.length > 0 && (
                        <ul className="flex flex-col gap-0.5 px-3 pb-2 text-xs text-muted">
                          {ref.parts.map((part) => (
                            <li
                              key={part.id}
                              className="flex justify-between gap-3"
                            >
                              <span className="truncate">{part.name}</span>
                              <span className="tabular-nums">
                                {formatFigure(part.value, "amount")}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
