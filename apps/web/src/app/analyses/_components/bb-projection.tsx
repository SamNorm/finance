"use client";

import type {
  AnalysisBorrowingBase,
  BorrowingBaseRun,
  GroupMonth,
  Issue,
  LineUsage,
  ProposedLine,
  ScenarioBorrowingBase,
} from "@finance/domain";
import type { Term } from "@finance/domain/terms";
import { Dec } from "@finance/engine";
import { Gauge, History, TrendingUp, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Fragment, useState, useTransition, type ReactNode } from "react";
import { IssueList, IssuesSummary } from "@/components/issue-list";
import { Badge, Card, EmptyState, Stat, plural } from "@/components/page";
import { button } from "@/components/styles";
import { Segmented } from "@/components/ui";
import { describeMonth, showFigure } from "@/lib/borrowing-bases";
import { describeTerm } from "@/lib/credit-lines";
import { formatDate, formatFigure } from "@/lib/format";
import {
  fillLineUsageAction,
  setProjectedBorrowingBaseValuesAction,
  setScenarioBorrowingBaseAction,
} from "../borrowing-base-actions";
import { GroupProjection } from "./bb-projection-group";
import {
  PasteButton,
  PasteProjections,
  ProjectedFigures,
} from "./bb-projection-figures";
import {
  ProjectionSettings,
  scenarioAssumptionsInput,
  scenarioDraft,
  ScenarioProjection,
} from "./bb-projection-settings";
import {
  ProjectionTable,
  termsLookup,
  type DealTerms,
  type FigureOrigin,
} from "./bb-projection-table";

// The analysis's Borrowing base tab (borrowing-base-plan.md §8, §10): each
// margined line of the borrower, or of a consolidated client's members,
// projected in the base case or the scenario open: how it's projected, the
// client's figures, the last twelve months then the projection with its
// tests, the deal's terms against the line as is, and the balance projected
// against the usage the analysis assumes for interest. A consolidated
// client also adds its members' lines up, month by month.

export interface ProjectionSetup {
  analysisId: string;
  // The scenario open; null for the base case.
  scenario: {
    id: string;
    name: string;
    // The project's closing, when it finances one.
    closing: string | null;
    // Its proposed lines; null keeps the lines in force.
    lines: ProposedLine[] | null;
    // Its own changes to each line's projection, by key.
    borrowingBases: Record<string, ScenarioBorrowingBase>;
  } | null;
  lines: AnalysisBorrowingBase[];
  // Each line's limit in force (a new line's, as proposed), by key.
  limits: Record<string, Term>;
  // The usage the shown run assumes for interest, the scenario's over the
  // analysis's.
  usage: LineUsage;
  group: { name: string; months: GroupMonth[]; issues: Issue[] } | null;
  // Margined lines only scenarios propose, for the base case to point to.
  proposedIn: { scenarioId: string; scenarioName: string; line: string }[];
  // Where the usage assumed for interest is entered.
  usageHref: string;
}

const GROUP = "group";

export function ProjectedBorrowingBases({ setup }: { setup: ProjectionSetup }) {
  const choices = [
    ...setup.lines.map((l) => ({ key: l.key, label: l.name, line: l })),
    ...(setup.group
      ? [{ key: GROUP, label: `${setup.group.name}: the group`, line: null }]
      : []),
  ];
  const [selected, setSelected] = useState(choices[0]?.key ?? "");
  const current = choices.find((c) => c.key === selected) ?? choices[0] ?? null;

  if (!current)
    return (
      <EmptyState icon={<Gauge />} title="No margined line to project.">
        {setup.proposedIn.length ? (
          <>
            Only a scenario proposes one:{" "}
            {setup.proposedIn.map((p, i) => (
              <span key={p.scenarioId}>
                {i > 0 && ", "}
                <Link
                  href={`?scenario=${p.scenarioId}&tab=borrowing-base`}
                  className="text-accent hover:underline"
                >
                  {p.line} in {p.scenarioName}
                </Link>
              </span>
            ))}
            .
          </>
        ) : (
          "The borrower has no margined line of credit."
        )}
      </EmptyState>
    );

  return (
    <div className="flex flex-col gap-5">
      {choices.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs font-medium tracking-wide text-muted uppercase">
            Line
          </span>
          <div
            role="tablist"
            aria-label="Margined lines"
            className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-line bg-surface p-1 shadow-xs [scrollbar-width:none]"
          >
            {choices.map((c) => {
              const flagged = c.line
                ? c.line.issues.some((i) => i.severity === "error")
                  ? "bg-danger"
                  : c.line.issues.length
                    ? "bg-warning"
                    : null
                : null;
              return (
                <button
                  key={c.key}
                  type="button"
                  role="tab"
                  aria-selected={c.key === current.key}
                  onClick={() => setSelected(c.key)}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted hover:bg-surface-2 hover:text-foreground aria-selected:bg-surface-2 aria-selected:font-medium aria-selected:text-foreground"
                >
                  {c.label}
                  {flagged && (
                    <span
                      className={`size-1.5 rounded-full ${flagged}`}
                      aria-label="Has checks"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {current.line ? (
        <LineProjection
          key={`${current.key}:${setup.scenario?.id ?? "base"}`}
          setup={setup}
          line={current.line}
        />
      ) : (
        <GroupProjection
          name={setup.group!.name}
          months={setup.group!.months}
          issues={setup.group!.issues}
          members={setup.lines
            .filter((l) => l.member)
            .map((l) => ({ key: l.key, name: l.name }))}
        />
      )}
    </div>
  );
}

// The deal's terms for a line, from the scenario's proposed line.
function dealOf(
  setup: ProjectionSetup,
  line: AnalysisBorrowingBase,
): DealTerms | null {
  const proposed = setup.scenario?.lines?.find((l) => l.id === line.key);
  if (!proposed || !line.proposedAfter || line.proposedNew) return null;
  return {
    after: line.proposedAfter,
    limit: proposed.limit,
    closed: proposed.closed === true,
    terms: proposed.terms ?? {},
  };
}

// The lowest or highest of a figure over the projected months, and when.
function extreme(
  run: BorrowingBaseRun,
  code: string,
  pick: "min" | "max",
): { value: string; month: string } | null {
  let best: { value: string; month: string } | null = null;
  for (const [p, m] of run.months.entries()) {
    const value = run.cells[code]?.[p]?.value;
    if (!m.projected || value === null || value === undefined) continue;
    const better =
      !best ||
      (pick === "min"
        ? new Dec(value).lt(best.value)
        : new Dec(value).gt(best.value));
    if (better) best = { value, month: m.month };
  }
  return best;
}

function LineProjection({
  setup,
  line,
}: {
  setup: ProjectionSetup;
  line: AnalysisBorrowingBase;
}) {
  const { scenario, analysisId } = setup;
  const deal = dealOf(setup, line);
  const [view, setView] = useState<"deal" | "as-is">("deal");
  const run = view === "as-is" && line.asIs ? line.asIs : line.run;
  const limit = setup.limits[line.key] ?? { value: "0" };
  const terms = termsLookup(
    line.definition,
    limit,
    view === "as-is" ? null : deal,
  );
  const own = scenario?.borrowingBases[line.key];
  const client = line.settings.source === "client";
  const originOf = (code: string, month: string): FigureOrigin =>
    own?.figures?.[month]?.[code] !== undefined
      ? "scenario"
      : client && line.clientFigures[month]?.[code] !== undefined
        ? "client"
        : client
          ? "estimated"
          : null;
  const ahead = line.run.months.filter((m) => m.projected);
  const dealFrom = deal
    ? ahead.find((m) => m.month > deal.after)?.month
    : undefined;
  const errors = line.issues.some((i) => i.severity === "error");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold tracking-tight">{line.name}</h2>
          <Badge>{line.currency}</Badge>
          {line.proposedNew && (
            <Badge tone="accent">New line, proposed by {scenario?.name}</Badge>
          )}
          {deal && (
            <Badge tone="accent">
              {deal.closed ? "Closed at the deal" : "Changed at the deal"}
            </Badge>
          )}
          {line.until && (
            <Badge>Projected to {describeMonth(line.until)}</Badge>
          )}
        </div>
        <p className="text-sm text-muted">
          {client
            ? "Projected from the client's figures, lines it leaves out from their projection formulas"
            : "Projected from assumptions, by each line's projection formula"}
          {ahead.length
            ? `, ${describeMonth(ahead[0]!.month)} to ${describeMonth(ahead.at(-1)!.month)}`
            : ""}
          .
          {deal &&
            dealFrom &&
            ` ${scenario!.name}'s terms apply from ${describeMonth(dealFrom)}${scenario!.closing ? `, after closing on ${formatDate(scenario!.closing)}` : ", the first projected month"}: limit ${deal.closed ? "0, closed" : describeTerm(deal.limit)}${Object.keys(deal.terms).length ? `, and the borrowing base terms of ${plural(Object.keys(deal.terms).length, "line")}` : ""}.`}
          {line.proposedNew &&
            " A new line has no history: it's projected from its definition and assumptions alone."}
        </p>
      </div>

      <ProjectionSummary run={line.run} asIs={line.asIs} />

      {line.issues.length > 0 && (
        <IssuesSummary
          issues={line.issues}
          note={
            errors
              ? "Some months can't be computed."
              : "Checks on the projection and the months shown. They flag problems; nothing is blocked."
          }
        >
          <IssueList issues={line.issues} />
        </IssuesSummary>
      )}

      {/* A new line only its scenario proposes has no base case to set
          its source, assumptions and the client's figures in: they're set
          here, beside the scenario's own. */}
      {(!scenario || line.proposedNew) && (
        <ProjectionSettings analysisId={analysisId} line={line} />
      )}
      {scenario && (
        <ScenarioProjection scenario={scenario} line={line} own={own} />
      )}

      {(!scenario || line.proposedNew) && (
        <ClientFigures analysisId={analysisId} line={line} />
      )}
      {scenario && (
        <ScenarioFigures scenario={scenario} line={line} own={own} />
      )}

      <ProjectionTable
        key={view}
        run={run}
        from={line.from}
        deal={view === "as-is" ? null : deal}
        terms={terms}
        estimated={view === "as-is" ? [] : line.estimated}
        originOf={originOf}
        title={
          view === "as-is"
            ? `${line.name} as is, with the terms in force`
            : "Month by month"
        }
        toolbar={
          line.asIs && (
            <div className="w-56">
              <Segmented
                name={`view-${line.key}`}
                options={{ deal: "With the deal", "as-is": "As is" }}
                value={view}
                onChange={setView}
              />
            </div>
          )
        }
      />

      {line.asIs && (
        <DealAgainstAsIs
          run={line.run}
          asIs={line.asIs}
          scenarioName={scenario?.name ?? "The deal"}
        />
      )}

      <UsageCheck setup={setup} line={line} />
    </div>
  );
}

// The projected months at a glance: how thin the margin gets, how high
// usage goes, and how often the tests fail.
function ProjectionSummary({
  run,
  asIs,
}: {
  run: BorrowingBaseRun;
  asIs: BorrowingBaseRun | null;
}) {
  const ahead = run.months.filter((m) => m.projected).length;
  if (!ahead) return null;
  const surplus = extreme(run, "BB_SURPLUS", "min");
  const excess = extreme(run, "BB_EXCESS", "min");
  const usage = extreme(run, "BB_USAGE", "max");
  const utilization = extreme(run, "BB_UTILIZATION", "max");
  const failed = (r: BorrowingBaseRun, id: string) =>
    r.tests
      .find((t) => t.id === id)
      ?.months.filter((m, p) => r.months[p]!.projected && m.pass === false)
      .length ?? 0;
  const when = (x: { month: string } | null) =>
    x ? describeMonth(x.month) : undefined;
  const custom = run.tests.filter((t) => !t.builtIn);
  const customFailed = custom.reduce((n, t) => n + failed(run, t.id), 0);
  const deficit = failed(run, "margin");
  return (
    <Card
      title={`The ${plural(ahead, "month")} projected`}
      description={
        asIs
          ? `With the deal's terms. As is, with the terms in force: ${plural(failed(asIs, "margin"), "month")} in deficit, ${failed(asIs, "overline")} over the limit.`
          : undefined
      }
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Lowest surplus"
          value={surplus ? formatFigure(surplus.value, "amount") : "–"}
          detail={when(surplus)}
          tone={
            surplus
              ? new Dec(surplus.value).isNegative()
                ? "danger"
                : "success"
              : undefined
          }
        />
        <Stat
          label="Lowest excess availability"
          value={excess ? formatFigure(excess.value, "amount") : "–"}
          detail={when(excess)}
          tone={
            excess && new Dec(excess.value).isNegative() ? "danger" : undefined
          }
        />
        <Stat
          label="Peak usage"
          value={usage ? formatFigure(usage.value, "amount") : "–"}
          detail={when(usage)}
        />
        <Stat
          label="Highest utilization"
          value={utilization ? formatFigure(utilization.value, "percent") : "–"}
          detail={when(utilization)}
        />
        <Stat
          label="Months in deficit"
          value={deficit}
          detail={`Overline ${failed(run, "overline")}`}
          tone={deficit ? "danger" : "success"}
        />
        <Stat
          label="Custom tests failed"
          value={custom.length ? customFailed : "–"}
          detail={
            custom.length
              ? `${plural(custom.length, "test")}, month by month`
              : "None set in its terms"
          }
          tone={customFailed ? "danger" : undefined}
        />
      </div>
    </Card>
  );
}

// The deal's main figures against the line as is, over the projected
// months.
function DealAgainstAsIs({
  run,
  asIs,
  scenarioName,
}: {
  run: BorrowingBaseRun;
  asIs: BorrowingBaseRun;
  scenarioName: string;
}) {
  const months = run.months
    .map((m, p) => ({ m, p }))
    .filter(({ m }) => m.projected);
  const asIsAt = new Map(asIs.months.map((m, p) => [m.month, p]));
  const rows: { code: string; label: string }[] = [
    { code: "BB_LIMIT", label: "Authorized limit" },
    { code: "BB_TOTAL", label: "Borrowing base" },
    { code: "BB_AVAILABLE", label: "Availability" },
    { code: "BB_SURPLUS", label: "Margin surplus (deficit)" },
    { code: "BB_EXCESS", label: "Excess availability" },
  ];
  const cell = (r: BorrowingBaseRun, code: string, p: number | undefined) =>
    p === undefined ? undefined : r.cells[code]?.[p]?.value;
  const show = (raw: string | null | undefined) =>
    raw === null || raw === undefined ? (
      <span className="text-muted">–</span>
    ) : (
      <span className={new Dec(raw).isNegative() ? "text-danger" : ""}>
        {formatFigure(raw, "amount")}
      </span>
    );
  return (
    <Card
      flush
      title={`${scenarioName} against the line as is`}
      description="The projected months with the deal's terms, and with the terms in force."
    >
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="sticky left-0 z-10 min-w-64 border-b border-line bg-surface px-4 py-2 text-left font-medium">
                Figure
              </th>
              {months.map(({ m }) => (
                <th
                  key={m.month}
                  className="w-28 min-w-28 border-b border-l border-line bg-accent-soft/25 px-2.5 py-2 text-right font-medium whitespace-nowrap text-foreground"
                >
                  {describeMonth(m.month)}
                </th>
              ))}
              <th className="w-full border-b border-line" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.code}>
                <tr>
                  <td className="sticky left-0 z-10 border-t border-line/60 bg-surface px-4 py-1 font-medium whitespace-nowrap">
                    {row.label}
                    <span className="ml-2 text-xs font-normal text-muted">
                      with the deal
                    </span>
                  </td>
                  {months.map(({ m, p }) => (
                    <td
                      key={m.month}
                      className="border-t border-l border-line/60 px-2.5 py-1 text-right whitespace-nowrap tabular-nums"
                    >
                      {show(cell(run, row.code, p))}
                    </td>
                  ))}
                  <td className="border-t border-line/60" />
                </tr>
                <tr className="text-muted">
                  <td className="sticky left-0 z-10 bg-surface px-4 py-1 pl-8 text-xs">
                    as is
                  </td>
                  {months.map(({ m }) => (
                    <td
                      key={m.month}
                      className="border-l border-line/60 px-2.5 py-1 text-right text-xs whitespace-nowrap tabular-nums"
                    >
                      {show(cell(asIs, row.code, asIsAt.get(m.month)))}
                    </td>
                  ))}
                  <td />
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// The client's projected figures, entered or pasted, in the base case.
function ClientFigures({
  analysisId,
  line,
}: {
  analysisId: string;
  line: AnalysisBorrowingBase;
}) {
  const client = line.settings.source === "client";
  const count = Object.values(line.clientFigures).reduce(
    (n, codes) => n + Object.keys(codes).length,
    0,
  );
  // Always shown when they're the projection's source.
  const [opened, setShown] = useState(false);
  const shown = client || opened;
  const [pasting, setPasting] = useState(false);
  if (!shown)
    return (
      <Collapsed
        title="The client's projected figures"
        detail={
          count
            ? `${plural(count, "figure")} entered, not used: the line is projected from assumptions.`
            : "None entered. They count once the projection's source is the client's figures."
        }
        onShow={() => setShown(true)}
      />
    );
  return (
    <>
      <ProjectedFigures
        line={line}
        title="The client's projected figures"
        description={`From the client's monthly forecast, in ${line.currency} unless a line says otherwise. ${client ? "A blank figure comes from the line's projection formula, shown in grey." : "Not used while the line is projected from assumptions."}`}
        figures={line.clientFigures}
        onCommit={(month, code, raw) =>
          setProjectedBorrowingBaseValuesAction(analysisId, line.key, [
            { month, code, value: raw },
          ])
        }
        actions={
          <>
            {!client && (
              <button
                type="button"
                className={button.ghost}
                onClick={() => setShown(false)}
              >
                Hide
              </button>
            )}
            <PasteButton onClick={() => setPasting(true)} />
          </>
        }
      />
      <PasteProjections
        open={pasting}
        onClose={() => setPasting(false)}
        analysisId={analysisId}
        line={line}
      />
    </>
  );
}

// A scenario's own figures for projected months, over the base case's.
function ScenarioFigures({
  scenario,
  line,
  own,
}: {
  scenario: { id: string; name: string };
  line: AnalysisBorrowingBase;
  own: ScenarioBorrowingBase | undefined;
}) {
  const figures = own?.figures ?? {};
  const count = Object.values(figures).reduce(
    (n, codes) => n + Object.keys(codes).length,
    0,
  );
  const [opened, setShown] = useState(false);
  const shown = count > 0 || opened;
  if (!shown)
    return (
      <Collapsed
        title={`Figures in ${scenario.name}`}
        detail="None: the projected months are the base case's. A scenario can set any entered line's figure from a month, such as an extra ineligible when the largest customer goes bad."
        onShow={() => setShown(true)}
      />
    );
  return (
    <ProjectedFigures
      line={line}
      title={`Figures in ${scenario.name}`}
      description="Replace the base case's figure for a month, whatever the projection's source; blank keeps it, shown in grey."
      figures={figures}
      onCommit={(month, code, raw) => {
        const next: Record<string, Record<string, string>> = {
          ...figures,
          [month]: { ...figures[month] },
        };
        if (raw) next[month]![code] = raw;
        else delete next[month]![code];
        if (!Object.keys(next[month]!).length) delete next[month];
        const assumptions = scenarioAssumptionsInput(scenarioDraft(line, own));
        return setScenarioBorrowingBaseAction(
          scenario.id,
          line.key,
          Object.keys(next).length || Object.keys(assumptions).length
            ? { assumptions, figures: next }
            : null,
        );
      }}
      actions={
        count === 0 && (
          <button
            type="button"
            className={button.ghost}
            onClick={() => setShown(false)}
          >
            Hide
          </button>
        )
      }
    />
  );
}

function Collapsed({
  title,
  detail,
  onShow,
}: {
  title: string;
  detail: string;
  onShow: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface px-4 py-2.5 shadow-xs">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted">{detail}</p>
      </div>
      <button
        type="button"
        className={`${button.secondary} ml-auto`}
        onClick={onShow}
      >
        Show the figures
      </button>
    </div>
  );
}

// The line's balance projected, against the usage the analysis assumes for
// its interest (§4.3, §8.5). Each keeps its own figure; the usage can be
// filled once from either, as values the analyst then owns.
function UsageCheck({
  setup,
  line,
}: {
  setup: ProjectionSetup;
  line: AnalysisBorrowingBase;
}) {
  const { scenario } = setup;
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const usage = setup.usage[line.key];
  const months = line.run.months
    .map((m, p) => ({ m, p }))
    .filter(({ m }) => m.projected);
  const value = (code: string, p: number) => line.run.cells[code]?.[p]?.value;
  // A month's usage assumed: its amount, or the share of that month's
  // limit, the deal's included.
  const assumedIn = (month: string, p: number) => {
    const amount = usage?.months?.[month];
    if (amount !== undefined) return { value: amount, typed: true };
    const limit = value("BB_LIMIT", p);
    if (usage?.share === undefined || limit === null || limit === undefined)
      return null;
    return {
      value: new Dec(limit).times(usage.share).toFixed(0),
      typed: false,
    };
  };
  const where = scenario ? `in ${scenario.name}` : "in the base case";

  function fill(from: "certificates" | "projection") {
    const what =
      from === "certificates"
        ? "the balance in the certificates, the same months of the latest year"
        : "the balance projected here, month by month";
    if (
      !confirm(
        `Fill ${line.name}'s usage ${where} from ${what}? It writes an amount for each month the analysis counts interest in that has one, replacing amounts typed for them. They're then yours to change; nothing is read again.`,
      )
    )
      return;
    setFeedback(null);
    startTransition(async () => {
      const result = await fillLineUsageAction(
        setup.analysisId,
        scenario?.id ?? null,
        line.key,
        from,
      );
      startTransition(() =>
        setFeedback(
          result.ok
            ? {
                ok: true,
                message:
                  "Usage filled. Results count its interest from these months.",
              }
            : { ok: false, message: result.message },
        ),
      );
    });
  }

  const average = (raw: string | null) =>
    raw === null ? "–" : formatFigure(new Dec(raw).toFixed(0), "amount");

  return (
    <Card
      flush
      title="Usage against the projection"
      description={`The usage assumed for interest ${where} (Assumptions & project, Lines of credit), beside the balance projected here. Each keeps its own figure; a gap of more than 20% on average is flagged.`}
      actions={
        <>
          <button
            type="button"
            className={button.secondary}
            disabled={pending || line.proposedNew}
            title={
              line.proposedNew
                ? "A new line has no certificates."
                : "The same calendar months of the latest year with a certificate"
            }
            onClick={() => fill("certificates")}
          >
            <History />
            Fill usage from the certificates
          </button>
          <button
            type="button"
            className={button.secondary}
            disabled={pending}
            onClick={() => fill("projection")}
          >
            <TrendingUp />
            From the projection
          </button>
        </>
      }
    >
      <div className="flex flex-col">
        {(line.usage.gap || feedback || !usage) && (
          <div className="flex flex-col gap-1 border-b border-line px-4 py-2.5 text-sm">
            {line.usage.gap && (
              <p className="flex items-start gap-2 text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                The usage assumed averages {average(line.usage.assumed)}, the
                balance projected {average(line.usage.projected)}: interest may
                be over- or understated.
              </p>
            )}
            {!usage && (
              <p className="text-muted">
                No usage assumed for this line: its interest counts as zero.{" "}
                <Link
                  href={setup.usageHref}
                  className="text-accent hover:underline"
                >
                  Assume it
                </Link>
                , or fill it here.
              </p>
            )}
            {feedback && (
              <p className={feedback.ok ? "text-success" : "text-danger"}>
                {feedback.message}
              </p>
            )}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="sticky left-0 z-10 min-w-64 border-b border-line bg-surface px-4 py-2 text-left font-medium">
                  Figure
                </th>
                <th className="w-28 min-w-28 border-b border-l border-line bg-surface-2/60 px-2.5 py-2 text-right font-medium">
                  Average
                </th>
                {months.map(({ m }) => (
                  <th
                    key={m.month}
                    className="w-28 min-w-28 border-b border-l border-line px-2.5 py-2 text-right font-medium whitespace-nowrap text-foreground"
                  >
                    {describeMonth(m.month)}
                  </th>
                ))}
                <th className="w-full border-b border-line" />
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <UsageRow
                label="Balance projected"
                average={average(line.usage.projected)}
                cells={months.map(({ m, p }) => ({
                  month: m.month,
                  content: showFigure(value("BB_OUTSTANDING", p), "amount"),
                }))}
              />
              <UsageRow
                label="Usage assumed for interest"
                average={average(line.usage.assumed)}
                cells={months.map(({ m, p }) => {
                  const a = assumedIn(m.month, p);
                  return {
                    month: m.month,
                    content: a ? (
                      <span
                        className={a.typed ? "" : "text-muted"}
                        title={
                          a.typed
                            ? "An amount for the month"
                            : `${formatFigure(usage!.share!, "percent")} of the limit`
                        }
                      >
                        {formatFigure(a.value, "amount")}
                      </span>
                    ) : (
                      "–"
                    ),
                  };
                })}
              />
              <UsageRow
                label="Difference"
                muted
                average={
                  line.usage.projected !== null && line.usage.assumed !== null
                    ? formatFigure(
                        new Dec(line.usage.assumed)
                          .minus(line.usage.projected)
                          .toFixed(0),
                        "amount",
                      )
                    : "–"
                }
                cells={months.map(({ m, p }) => {
                  const a = assumedIn(m.month, p);
                  const b = value("BB_OUTSTANDING", p);
                  return {
                    month: m.month,
                    content:
                      a && b !== null && b !== undefined
                        ? formatFigure(
                            new Dec(a.value).minus(b).toFixed(0),
                            "amount",
                          )
                        : "–",
                  };
                })}
              />
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

function UsageRow({
  label,
  average,
  cells,
  muted = false,
}: {
  label: string;
  average: string;
  cells: { month: string; content: ReactNode }[];
  muted?: boolean;
}) {
  return (
    <tr className={muted ? "text-muted" : ""}>
      <td className="sticky left-0 z-10 border-b border-line/60 bg-surface px-4 py-1.5">
        {label}
      </td>
      <td className="border-b border-l border-line/60 bg-surface-2/60 px-2.5 py-1.5 text-right font-medium">
        {average}
      </td>
      {cells.map((c) => (
        <td
          key={c.month}
          className="border-b border-l border-line/60 px-2.5 py-1.5 text-right whitespace-nowrap"
        >
          {c.content}
        </td>
      ))}
      <td className="border-b border-line/60" />
    </tr>
  );
}
