import {
  balanceSheetSides,
  DomainError,
  getAnalysis,
  getDebtSchedules,
  getScoringModel,
  getSpread,
  imbalance,
  isNumeric,
  listItems,
  monthIndex,
  monthOf,
  runAnalysis,
  spreadErrors,
  type AnalysisRun,
} from "@finance/domain";
import { listDocuments, listPrintableTemplates } from "@finance/documents";
import { Dec } from "@finance/engine";
import { Building2, Sigma, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge, Page, PageHeader } from "@/components/page";
import { Tabs } from "@/components/tabs";
import { formatDate, formatDay, formatFigure } from "@/lib/format";
import { getContext, getDb } from "@/lib/server";
import { AnalysisActions } from "../_components/analysis-actions";
import { AnalysisCharts } from "../_components/analysis-charts";
import { documentRows } from "../../documents/rows";
import { AnalysisDocuments } from "../_components/analysis-documents";
import { AnalysisSettings } from "../_components/analysis-settings";
import { CovenantResults } from "../_components/covenant-results";
import { CovenantSummary } from "../_components/covenant-summary";
import { Repin } from "../_components/repin";
import type { LinesSetup } from "../_components/credit-lines";
import { ResultsTable } from "../_components/results-table";
import {
  BaseCase,
  ScenarioEditor,
  ScenarioSwitcher,
} from "../_components/scenario-bar";

export const metadata: Metadata = { title: "Analysis" };

export default function AnalysisPage({
  params,
  searchParams,
}: PageProps<"/analyses/[id]">) {
  return (
    <Page wide>
      <Suspense fallback={<Loading />}>
        <AnalysisView params={params} searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

type Props = Pick<PageProps<"/analyses/[id]">, "params" | "searchParams">;

// The scenario picked above the tabs applies to all of them: its results,
// its charts, and its assumptions and project.
async function AnalysisView({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const ctx = await getContext();
  const detail = await getAnalysis(db, ctx, id).catch((error) => {
    if (error instanceof DomainError && error.kind === "not_found") notFound();
    throw error;
  });
  const scenario =
    detail.scenarios.find((s) => s.id === query.scenario) ?? null;
  const [results, spread, scoringItems, debt, documents, printable] =
    await Promise.all([
      runAnalysis(db, ctx, id, scenario?.id ?? null),
      getSpread(db, ctx, detail.entity.id),
      listItems(db, ctx, detail.version.scoringModelVersionId),
      getDebtSchedules(db, ctx, detail.entity.id),
      listDocuments(db, ctx, { analysisId: id }),
      listPrintableTemplates(db, ctx, detail.model.id),
    ]);
  const scoringModel = await getScoringModel(
    db,
    ctx,
    spread.entity.scoringModelId,
  );
  const run = results.scenario ?? results.base;
  const { analysis, entity, model, version } = detail;
  const sides = balanceSheetSides(scoringItems);
  const lastActual = results.base.periods.findLast((p) => !p.projection);
  const { longTermDebt, currentDebt, cash } = scoringModel.financingItems;
  const assumptions = detail.lines.filter((l) => l.kind === "assumption");
  const scenarios = detail.scenarios.map((s) => ({
    id: s.id,
    name: s.name,
    overrides: s.overrides,
    periodOverrides: s.periodOverrides,
    project: s.project,
    capex: s.capex,
    covenants: s.covenants,
    lines: s.lines,
    lineUsage: s.lineUsage,
    imbalance: s.project && imbalance(s.project),
  }));
  // The lines of credit, and the months their usage counts in: each
  // projected period's. A scenario's project adds the twelve after its
  // closing, as the editor has it.
  const creditLines: LinesSetup = {
    inForce: results.creditLines.inForce.map((l) => ({
      id: l.id,
      name: l.name,
      currency: l.currency,
      limit: l.limit,
      rate: l.rate,
      closedOn: l.closedOn ?? null,
    })),
    analysisUsage: analysis.lineUsage,
    projectedMonths: [
      ...new Set(
        run.periods.flatMap((p) =>
          p.projection
            ? Array.from({ length: p.months }, (_, i) =>
                monthOf(monthIndex(p.end) - p.months + 1 + i),
              )
            : [],
        ),
      ),
    ],
    lastActual: lastActual ? lastActual.end.slice(0, 7) : null,
    withoutUsage: results.creditLines.withoutUsage,
    borrowerHref: `/borrowers/${entity.id}?tab=existing-debt`,
  };
  // Where the open scenario's assumptions can take a value by year:
  // projected periods, and post-project from the last fiscal year on.
  const lastYear = run.periods.findLastIndex(
    (p) => !p.projection && p.months === 12,
  );
  const assumptionYears = run.periods.flatMap((p, i) =>
    p.projection
      ? [
          {
            end: p.end,
            label:
              p.projection === "client" ? "Client projection" : "Projected",
          },
        ]
      : scenario?.project && i >= lastYear
        ? [
            {
              end: p.end,
              label:
                p.months === 12
                  ? "Post-project"
                  : `${p.months} mo · Post-project`,
            },
          ]
        : [],
  );
  // Critical errors in the periods it analyzes, which hold completion back.
  const broken = spreadErrors(spread, detail.analysis);
  // The open scenario's project, when it's out of balance.
  const offBalance =
    scenarios.find((s) => s.id === scenario?.id)?.imbalance ?? null;
  const empty = (
    <p className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center text-sm text-muted">
      {entity.name} has no periods in this analysis. Add figures on the{" "}
      <Link
        href={`/borrowers/${entity.id}`}
        className="text-accent hover:underline"
      >
        borrower&apos;s page
      </Link>
      .
    </p>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ href: "/analyses", label: "Analyses" }]}
        title={analysis.name}
        badges={
          analysis.status === "completed" ? (
            <Badge tone="success">
              Completed {formatDay(analysis.completedAt!)}
            </Badge>
          ) : (
            <Badge tone="accent">In progress</Badge>
          )
        }
        meta={
          <>
            <Link
              href={`/borrowers/${entity.id}`}
              className="flex items-center gap-1.5 hover:text-foreground"
            >
              <Building2 className="size-4" aria-hidden />
              {entity.name}
            </Link>
            <Link
              href={`/financial-models/${model.id}?v=${version.number}`}
              className="flex items-center gap-1.5 hover:text-foreground"
            >
              <Sigma className="size-4" aria-hidden />
              {model.name}
            </Link>
            <span title="Results come from this version, even after later ones are published.">
              <Badge>Pinned to v{version.number}</Badge>
            </span>
          </>
        }
        actions={
          <AnalysisActions
            analysis={{
              id: analysis.id,
              name: analysis.name,
              status: analysis.status,
            }}
          />
        }
      />

      {detail.newerVersion && (
        <Repin
          analysisId={analysis.id}
          pinned={version.number}
          newer={detail.newerVersion.number}
        />
      )}

      <ScenarioSwitcher
        analysisId={analysis.id}
        scenarios={scenarios}
        current={scenario?.id ?? null}
      />

      <Tabs
        initial={typeof query.tab === "string" ? query.tab : undefined}
        toolbar={
          <AnalysisSettings
            analysisId={analysis.id}
            periods={spread.periods.map((p) => ({
              id: p.id,
              periodEnd: p.periodEnd,
              months: p.months,
              quality: p.quality,
            }))}
            selected={analysis.periodIds}
            projectionMode={analysis.projectionMode}
            projectionYears={analysis.projectionYears}
          />
        }
        tabs={[
          {
            value: "results",
            label: "Results",
            alert:
              offBalance || broken.length
                ? "error"
                : run.breakdowns.some((b) => !b.reconciles) ||
                    results.creditLines.withoutUsage.length > 0 ||
                    [
                      ...results.covenants.run,
                      ...(results.covenants.project ?? []),
                    ].some((c) => c.periods.some((p) => p.pass === false))
                  ? "warning"
                  : undefined,
            content:
              run.periods.length === 0 ? (
                empty
              ) : (
                <div className="flex flex-col gap-5">
                  {broken.length > 0 && (
                    <SpreadErrors entity={entity} broken={broken} />
                  )}
                  {offBalance && <ProjectImbalance message={offBalance} />}
                  <Breakdowns run={run} />
                  <LinesWithoutUsage lines={results.creditLines.withoutUsage} />
                  <CovenantResults
                    covenants={results.covenants}
                    run={run}
                    project={results.project}
                    postProject={results.postProject}
                    scenarioName={scenario?.name ?? null}
                    entity={entity}
                  />
                  <CovenantSummary
                    lines={detail.lines}
                    run={run}
                    project={results.project}
                  />
                  <ResultsTable
                    key={scenario?.id ?? "base"}
                    analysisId={analysis.id}
                    lines={detail.lines}
                    run={run}
                    base={results.scenario ? results.base : null}
                    project={results.project}
                    postProject={results.postProject}
                    scenarioName={scenario?.name ?? null}
                    imbalance={offBalance}
                  />
                </div>
              ),
          },
          {
            value: "charts",
            label: "Charts",
            count: detail.modelCharts.length + analysis.charts.length,
            content:
              run.periods.length === 0 ? (
                empty
              ) : (
                <AnalysisCharts
                  key={`charts:${scenario?.id ?? "base"}`}
                  analysisId={analysis.id}
                  lines={detail.lines}
                  run={run}
                  base={results.scenario ? results.base : null}
                  scenarioName={scenario?.name ?? null}
                  modelCharts={detail.modelCharts}
                  charts={analysis.charts}
                  project={results.project}
                  covenants={results.covenants.run}
                />
              ),
          },
          {
            value: "scenario",
            label: "Assumptions & project",
            alert: offBalance
              ? "error"
              : results.creditLines.withoutUsage.length
                ? "warning"
                : undefined,
            content: scenario ? (
              <ScenarioEditor
                key={scenario.id}
                analysisId={analysis.id}
                scenario={scenarios.find((s) => s.id === scenario.id)!}
                assumptions={assumptions}
                years={assumptionYears}
                creditLines={creditLines}
                capexYears={results.capex}
                setup={{
                  items: scoringItems
                    .filter((item) => sides.has(item.code))
                    .map((item) => ({
                      code: item.code,
                      label: item.label,
                      side: sides.get(item.code)!,
                    })),
                  adjustable: scoringItems
                    .filter((item) => item.kind === "input" && isNumeric(item))
                    .map((item) => ({
                      code: item.code,
                      label: item.label,
                      statement: item.statement,
                      side: sides.get(item.code) ?? null,
                    })),
                  debtSchedules: debt.map((d) => d.schedule),
                  repayItem: longTermDebt ?? "",
                  canAddLoans: Boolean(longTermDebt && currentDebt && cash),
                  scoringModelId: scoringModel.id,
                  defaultClosing: lastActual
                    ? nextMonthEnd(lastActual.end)
                    : "",
                  covenantsInForce: spread.entity.covenants,
                  // What a deal's covenants can test: this model's ratios
                  // and figures.
                  metrics: detail.lines.flatMap((l) =>
                    l.kind === "calculation" &&
                    l.format !== "flag" &&
                    l.format !== "text"
                      ? [{ code: l.code, label: l.label, format: l.format }]
                      : [],
                  ),
                }}
              />
            ) : (
              <BaseCase
                analysisId={analysis.id}
                assumptions={assumptions}
                creditLines={creditLines}
              />
            ),
          },
          {
            value: "documents",
            label: "Documents",
            count: documents.length,
            content: (
              <AnalysisDocuments
                analysisId={analysis.id}
                scenario={scenario && { id: scenario.id, name: scenario.name }}
                templates={printable}
                documents={documentRows(documents)}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

// Critical errors in the spread periods the analysis uses, such as a
// balance sheet that doesn't balance: its results can't be relied on, and
// it can't be completed until they're fixed.
function SpreadErrors({
  entity,
  broken,
}: {
  entity: { id: string; name: string };
  broken: ReturnType<typeof spreadErrors>;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm">
      <TriangleAlert
        className="mt-0.5 size-4 shrink-0 text-danger"
        aria-hidden
      />
      <div className="flex flex-col gap-1">
        <p className="font-medium text-danger">The spread has errors</p>
        <ul className="flex flex-col gap-0.5 text-muted">
          {broken.flatMap(({ period, issues }) =>
            issues.map((issue) => (
              <li key={`${period.id}:${issue.code}`}>
                {formatDate(period.periodEnd)}: {issue.message}
              </li>
            )),
          )}
        </ul>
        <p className="text-muted">
          Results can&apos;t be relied on until they&apos;re fixed on{" "}
          <Link
            href={`/borrowers/${entity.id}`}
            className="text-accent hover:underline"
          >
            {entity.name}&apos;s spread
          </Link>
          , and the analysis can&apos;t be completed until then.
        </p>
      </div>
    </div>
  );
}

// A project whose sources and uses differ: its post-project balance sheet
// doesn't balance, and the analysis can't be completed until it does.
function ProjectImbalance({ message }: { message: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm">
      <TriangleAlert
        className="mt-0.5 size-4 shrink-0 text-danger"
        aria-hidden
      />
      <div className="flex flex-col gap-1">
        <p className="font-medium text-danger">The project is out of balance</p>
        <p className="text-muted">
          {message}, so the post-project balance sheet doesn&apos;t balance and
          post-project figures can&apos;t be relied on. Settle its sources and
          uses under Assumptions &amp; project; the analysis can&apos;t be
          completed until then.
        </p>
      </div>
    </div>
  );
}

// Input lines that break down an item but don't add up to it.
function Breakdowns({ run }: { run: AnalysisRun }) {
  const off = run.breakdowns.filter((b) => !b.reconciles);
  if (!off.length) return null;
  return (
    <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
      <TriangleAlert
        className="mt-0.5 size-4 shrink-0 text-warning"
        aria-hidden
      />
      <div className="flex flex-col gap-1">
        <p className="font-medium text-warning">
          Breakdowns that don&apos;t add up
        </p>
        <ul className="flex flex-col gap-0.5 text-muted">
          {off.map((b) => {
            const difference = new Dec(b.difference);
            return (
              <li key={`${b.code}:${b.period}`}>
                {b.label}, {formatDate(run.periods[b.period]!.end)}: the parts
                add up to {formatFigure(b.parts, "amount")},{" "}
                {formatFigure(difference.abs().toFixed(), "amount")}{" "}
                {difference.isPositive() ? "less" : "more"} than the{" "}
                {formatFigure(b.total ?? "0", "amount")} in the spread.
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// Lines of credit the run counts with no usage assumed: their interest
// counts as zero, which understates debt service.
function LinesWithoutUsage({
  lines,
}: {
  lines: { id: string; name: string }[];
}) {
  if (!lines.length) return null;
  return (
    <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
      <TriangleAlert
        className="mt-0.5 size-4 shrink-0 text-warning"
        aria-hidden
      />
      <div className="flex flex-col gap-1">
        <p className="font-medium text-warning">
          Lines of credit with no usage assumed
        </p>
        <ul className="flex flex-col gap-0.5 text-muted">
          {lines.map((line) => (
            <li key={line.id}>{line.name}: its interest counts as zero.</li>
          ))}
        </ul>
        <p className="text-muted">
          Assume an average usage under Assumptions &amp; project, Lines of
          credit.
        </p>
      </div>
    </div>
  );
}

// "2024-12-31" → "2025-01-31": a closing just after the latest statements.
function nextMonthEnd(date: string) {
  const [year, month] = date.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
}

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading">
      <div className="flex flex-col gap-2">
        <div className="h-3 w-20 rounded bg-surface-2" />
        <div className="h-7 w-80 rounded bg-surface-2" />
        <div className="h-4 w-96 rounded bg-surface-2" />
      </div>
      <div className="h-10 w-full max-w-2xl rounded-lg bg-surface-2" />
      <div className="h-96 w-full rounded-xl bg-surface-2" />
    </div>
  );
}
