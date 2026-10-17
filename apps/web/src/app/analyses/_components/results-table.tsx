"use client";

import type {
  AnalysisRun,
  LineageRef,
  ModelLine,
  ResultCell,
  ResultValue,
} from "@finance/domain";
import { useState } from "react";
import { button } from "@/components/styles";
import { Modal } from "@/components/ui";
import { formatDate, formatFigure } from "@/lib/format";
import { QUALITY_SHORT } from "@/lib/labels";

type Format = ModelLine["format"];

const SOURCES: Record<LineageRef["source"], string> = {
  calculation: "Calculation",
  assumption: "Assumption",
  entered: "Entered",
  summed: "Sum of lines",
  blank: "Blank",
};

// The model's lines over the analysis's periods. Every value opens its
// lineage: the formula and each value it read, down to the spread.
export function ResultsTable({
  lines,
  run,
  base,
  scenarioName,
}: {
  lines: ModelLine[];
  run: AnalysisRun;
  // The base case, when a scenario is shown, to compare against.
  base: AnalysisRun | null;
  scenarioName: string | null;
}) {
  const [trail, setTrail] = useState<{ code: string; period: number }[]>([]);
  const formats = new Map(lines.map((l) => [l.code, l.format]));
  const open = (code: string, period: number) => setTrail([{ code, period }]);

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="sticky left-0 z-10 min-w-64 border-b border-line bg-surface px-4 py-2 text-left font-medium">
                {scenarioName ?? "Base case"}
              </th>
              {run.periods.map((p) => (
                <th
                  key={p.key}
                  className={`w-36 min-w-36 border-b border-l border-line px-3 py-2 text-right font-normal ${p.projected ? "bg-surface-2" : ""}`}
                >
                  <span className="block font-medium text-foreground">
                    {formatDate(p.end)}
                  </span>
                  {p.projected
                    ? "Projected"
                    : `${p.months} mo · ${QUALITY_SHORT[p.quality]}`}
                </th>
              ))}
              <th className="border-b border-line" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              if (line.kind === "header") {
                return (
                  <tr key={line.code}>
                    <td
                      colSpan={run.periods.length + 2}
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
                    {assumption?.overridden && (
                      <span className="ml-2 rounded bg-accent-soft px-1 text-[11px] text-accent">
                        scenario
                      </span>
                    )}
                  </td>
                  {run.periods.map((p, i) => {
                    const cell = run.cells[line.code]?.[i];
                    const baseCell = base?.cells[line.code]?.[i];
                    return (
                      <td
                        key={p.key}
                        className={`border-b border-l border-line/60 p-0 text-right tabular-nums ${p.projected ? "bg-surface-2/60" : ""}`}
                      >
                        {assumption ? (
                          <span className="block px-3 py-1.5">
                            {formatFigure(
                              flag(assumption.value, line.format),
                              line.format,
                            )}
                          </span>
                        ) : cell ? (
                          <button
                            type="button"
                            onClick={() => open(line.code, i)}
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
        run={run}
        lines={lines}
        formats={formats}
      />
    </section>
  );
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
  run,
  lines,
  formats,
}: {
  trail: { code: string; period: number }[];
  onTrail: (trail: { code: string; period: number }[]) => void;
  run: AnalysisRun;
  lines: ModelLine[];
  formats: Map<string, Format>;
}) {
  const current = trail.at(-1);
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
              {formatDate(period.end)} ·{" "}
              {period.projected ? "Projected" : `${period.months} months`}
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
              {period.projected && line.projectionFormula
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
                              { code: ref.code, period: ref.period },
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
