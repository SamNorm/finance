import type {
  AnalysisResults,
  AnalysisRun,
  CovenantPeriod,
  CovenantResult,
} from "@finance/domain";
import Link from "next/link";
import { Badge, Card } from "@/components/page";
import { formatFigure } from "@/lib/format";

// The covenants tested in the analysis, year by year: the scenario's
// proposed for its deal, or the borrower's in force. Each fiscal year shows
// the figure against its threshold and the room left; post-project columns
// sit where the results table puts them. The last column says how much the
// latest year (post-project, with a project) can give before a breach.

type Format = "amount" | "percent" | "ratio" | "count";

const asFormat = (format: CovenantResult["format"]): Format =>
  format === "percent" || format === "ratio" || format === "count"
    ? format
    : "amount";

const signed = (value: string, format: Format) => {
  const shown = formatFigure(value.replace(/^-/, ""), format);
  return value.startsWith("-") ? `−${shown}` : `+${shown}`;
};

export function CovenantResults({
  covenants,
  run,
  project,
  postProject,
  scenarioName,
  entity,
}: {
  covenants: AnalysisResults["covenants"];
  run: AnalysisRun;
  project: AnalysisRun | null;
  postProject: string[];
  scenarioName: string | null;
  entity: { id: string; name: string };
}) {
  const edit = `/borrowers/${entity.id}?tab=covenants`;
  if (!covenants.run.length)
    return (
      <p className="text-sm text-muted">
        No covenants in force for {entity.name}.{" "}
        <Link href={edit} className="text-accent hover:underline">
          Add them on its page
        </Link>
        : every analysis tests them, year by year.
      </p>
    );

  // Fiscal years, each followed by its post-project column when shown.
  const columns = run.periods.flatMap((period, p) => {
    if (period.months !== 12) return [];
    const own = {
      key: period.key,
      label: period.end.slice(0, 4),
      p,
      post: false,
    };
    return project && postProject.includes(period.key)
      ? [own, { ...own, key: `${period.key}:post`, post: true }]
      : [own];
  });
  const reference =
    columns.findLast((c) => c.post) ??
    columns.findLast((c) => !run.periods[c.p]!.projection);
  const pick = (index: number, column: (typeof columns)[number]) =>
    (column.post ? covenants.project : covenants.run)?.[index]?.periods[
      column.p
    ];

  return (
    <Card
      flush
      title={
        <span className="flex flex-wrap items-center gap-2">
          Covenants
          {covenants.source === "scenario" ? (
            <Badge tone="accent">Proposed for {scenarioName}</Badge>
          ) : (
            <Badge>In force</Badge>
          )}
        </span>
      }
      description={
        covenants.source === "scenario" ? (
          "The deal's covenants, set under Assumptions & project, instead of those in force."
        ) : (
          <>
            {entity.name}&apos;s covenants in force,{" "}
            <Link href={edit} className="text-accent hover:underline">
              set on its page
            </Link>
            . Each year shows the figure, its threshold and the room left.
          </>
        )
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2/50 text-xs text-muted">
              <th className="px-4 py-2.5 text-left font-medium">Covenant</th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`px-3 py-2.5 text-right font-medium whitespace-nowrap ${c.post ? "bg-accent-soft/40" : run.periods[c.p]!.projection ? "bg-surface-2" : ""}`}
                >
                  {c.label}
                  {c.post && " post-project"}
                  {!c.post && run.periods[c.p]!.projection && " projected"}
                </th>
              ))}
              <th className="px-4 py-2.5 text-left font-medium">
                Room
                {reference &&
                  ` · ${reference.label}${reference.post ? " post-project" : ""}`}
              </th>
            </tr>
          </thead>
          <tbody>
            {covenants.run.map((result, index) => {
              const format = asFormat(result.format);
              const room = reference && pick(index, reference);
              return (
                <tr
                  key={result.covenant.id}
                  className="border-b border-line/70 align-top last:border-b-0"
                >
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{result.covenant.name}</span>
                    <span className="block text-xs text-muted">
                      {result.label === null
                        ? `${result.covenant.metric} isn't a line of this model`
                        : `${result.label} ${result.covenant.test === "min" ? "at least" : "at most"} ${
                            result.covenant.thresholds.length > 1
                              ? "a threshold by year"
                              : formatFigure(
                                  result.covenant.thresholds[0]!.value,
                                  format,
                                )
                          }`}
                    </span>
                  </td>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2.5 text-right tabular-nums ${c.post ? "bg-accent-soft/20" : ""}`}
                    >
                      <Tested period={pick(index, c)} format={format} />
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-xs text-muted">
                    <Room
                      period={room}
                      format={format}
                      test={result.covenant.test}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Tested({
  period,
  format,
}: {
  period: CovenantPeriod | undefined;
  format: Format;
}) {
  if (!period || period.threshold === null)
    return <span className="text-muted">–</span>;
  if (period.actual === null)
    return (
      <span className="text-xs text-muted">
        No figure · {formatFigure(period.threshold, format)}
      </span>
    );
  return (
    <span className="flex flex-col items-end">
      <span
        className={`font-medium ${period.pass ? "text-success" : "text-danger"}`}
      >
        {formatFigure(period.actual, format)}
      </span>
      <span className="text-xs whitespace-nowrap text-muted">
        {formatFigure(period.threshold, format)} ·{" "}
        {signed(period.margin!, format)}
      </span>
    </span>
  );
}

// The room left, in the ratio's own dollars when it divides two lines, and
// how far the line it rests on can fall; in breach, how far off it is. A
// minimum needs more of its numerator (cash flow short); a maximum allows
// more of it (debt still allowed).
function Room({
  period,
  format,
  test,
}: {
  period: CovenantPeriod | undefined;
  format: Format;
  test: "min" | "max";
}) {
  if (!period || period.actual === null) return <>–</>;
  const { cushion } = period;
  const margin = signed(period.margin!, format).slice(1);
  if (!cushion)
    return period.pass ? (
      <>{margin} to spare</>
    ) : (
      <span className="text-danger">In breach by {margin}</span>
    );
  const amount = formatFigure(cushion.amount.replace(/^-/, ""), "amount");
  const line = cushion.line;
  if (!period.pass)
    return (
      <span className="text-danger">
        In breach: {amount}{" "}
        {test === "min" ? `of ${line} short` : `of ${line} too many`}
      </span>
    );
  return (
    <>
      {cushion.fall !== null &&
        `${cushion.fallLine} can fall ${formatFigure(cushion.fall, "percent")} before a breach`}
      <span className="block">
        {test === "min"
          ? `${amount} of ${line} to spare`
          : `${amount} more ${line} allowed`}
      </span>
    </>
  );
}
