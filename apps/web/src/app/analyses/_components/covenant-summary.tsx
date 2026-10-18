import type { AnalysisRun, ModelLine, ResultValue } from "@finance/domain";
import type { ReactNode } from "react";
import { Card } from "@/components/page";
import { formatDate } from "@/lib/format";

// The model's pass/fail tests at a glance, before the full table: the latest
// statements, post-project when the scenario finances one, and the projected
// years, where a single failing year shows.
export function CovenantSummary({
  lines,
  run,
  project,
}: {
  lines: ModelLine[];
  run: AnalysisRun;
  // The scenario with its project.
  project: AnalysisRun | null;
}) {
  const tests = lines.filter(
    (l) => l.kind === "calculation" && l.format === "flag",
  );
  const latest = run.periods.findLastIndex((p) => !p.projection);
  // Post-project columns sit next to the last fiscal year by default.
  const lastYear = run.periods.findLastIndex(
    (p) => !p.projection && p.months === 12,
  );
  const projected = run.periods.flatMap((p, i) => (p.projection ? [i] : []));
  if (!tests.length || latest < 0) return null;

  const year = (i: number) => run.periods[i]!.end.slice(0, 4);
  const th = "px-4 py-2.5 text-left font-medium whitespace-nowrap";

  return (
    <Card
      title="Covenants and tests"
      description="Each test in the latest statements, post-project and over the projections."
      flush
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2/50 text-xs text-muted">
              <th className={th}>Test</th>
              <th className={th}>{formatDate(run.periods[latest]!.end)}</th>
              {project && lastYear >= 0 && (
                <th className={th}>Post-project · {year(lastYear)}</th>
              )}
              {projected.length > 0 && (
                <th className={th}>
                  Projections · {year(projected[0]!)}
                  {projected.length > 1 && `–${year(projected.at(-1)!)}`}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {tests.map((test) => {
              const cells = run.cells[test.code] ?? [];
              const failing = projected.filter(
                (i) => cells[i]?.value === "false",
              );
              const unknown = projected.some(
                (i) => !cells[i] || cells[i]!.error || cells[i]!.value === null,
              );
              return (
                <tr
                  key={test.code}
                  className="border-b border-line/70 last:border-b-0"
                >
                  <td className="px-4 py-2.5">{test.label}</td>
                  <td className="px-4 py-2.5">
                    <Result cell={cells[latest]} />
                  </td>
                  {project && lastYear >= 0 && (
                    <td className="px-4 py-2.5">
                      <Result cell={project.cells[test.code]?.[lastYear]} />
                    </td>
                  )}
                  {projected.length > 0 && (
                    <td className="px-4 py-2.5">
                      {failing.length ? (
                        <Pill pass={false}>
                          Fails in {failing.map(year).join(", ")}
                        </Pill>
                      ) : unknown ? (
                        <span className="text-xs text-muted">Incomplete</span>
                      ) : (
                        <Pill pass>Passes every year</Pill>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Result({ cell }: { cell: ResultValue | undefined }) {
  if (!cell || cell.error || cell.value === null)
    return (
      <span className="text-xs text-muted" title={cell?.error?.message}>
        –
      </span>
    );
  return (
    <Pill pass={cell.value === "true"}>
      {cell.value === "true" ? "Pass" : "Fail"}
    </Pill>
  );
}

function Pill({ pass, children }: { pass: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium ${pass ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}
    >
      <span
        className={`size-1.5 rounded-full ${pass ? "bg-success" : "bg-danger"}`}
      />
      {children}
    </span>
  );
}
