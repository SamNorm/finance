import {
  DomainError,
  getAnalysis,
  getSpread,
  runAnalysis,
} from "@finance/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AnalysisActions } from "../_components/analysis-actions";
import { AnalysisSettings } from "../_components/analysis-settings";
import { Repin } from "../_components/repin";
import { ResultsTable } from "../_components/results-table";
import { ScenarioBar } from "../_components/scenario-bar";
import { getContext, getDb } from "@/lib/server";

export const metadata: Metadata = { title: "Analysis" };

export default function Page({
  params,
  searchParams,
}: PageProps<"/analyses/[id]">) {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
      <Suspense fallback={<Loading />}>
        <AnalysisView params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

type Props = Pick<PageProps<"/analyses/[id]">, "params" | "searchParams">;

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
  const [results, spread] = await Promise.all([
    runAnalysis(db, ctx, id, scenario?.id ?? null),
    getSpread(db, ctx, detail.entity.id),
  ]);
  const run = results.scenario ?? results.base;
  const { analysis, entity, model, version } = detail;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            <Link href="/analyses" className="hover:text-foreground">
              Analyses
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {analysis.name}
          </h1>
          <p className="text-sm text-muted">
            <Link
              href={`/borrowers/${entity.id}`}
              className="text-accent hover:underline"
            >
              {entity.name}
            </Link>{" "}
            ·{" "}
            <Link
              href={`/financial-models/${model.id}?v=${version.number}`}
              className="text-accent hover:underline"
            >
              {model.name}
            </Link>{" "}
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium">
              pinned to v{version.number}
            </span>
          </p>
        </div>
        <AnalysisActions analysis={{ id: analysis.id, name: analysis.name }} />
      </header>

      {detail.newerVersion && (
        <Repin
          analysisId={analysis.id}
          pinned={version.number}
          newer={detail.newerVersion.number}
        />
      )}

      <AnalysisSettings
        analysisId={analysis.id}
        periods={spread.periods.map((p) => ({
          id: p.id,
          periodEnd: p.periodEnd,
          months: p.months,
        }))}
        selected={analysis.periodIds}
        projectionYears={analysis.projectionYears}
      />

      <ScenarioBar
        analysisId={analysis.id}
        scenarios={detail.scenarios.map((s) => ({
          id: s.id,
          name: s.name,
          overrides: s.overrides,
        }))}
        current={scenario?.id ?? null}
        assumptions={detail.lines.filter((l) => l.kind === "assumption")}
      />

      {run.periods.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-6 py-12 text-center text-sm text-muted">
          {entity.name} has no periods in this analysis. Add figures on the{" "}
          <Link
            href={`/borrowers/${entity.id}`}
            className="text-accent hover:underline"
          >
            borrower&apos;s page
          </Link>
          .
        </p>
      ) : (
        <ResultsTable
          key={scenario?.id ?? "base"}
          lines={detail.lines}
          run={run}
          base={results.scenario ? results.base : null}
          scenarioName={scenario?.name ?? null}
        />
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-4" aria-label="Loading">
      <div className="h-3 w-20 rounded bg-surface-2" />
      <div className="h-7 w-80 rounded bg-surface-2" />
      <div className="h-10 w-full rounded bg-surface-2" />
      <div className="h-96 w-full rounded-lg bg-surface-2" />
    </div>
  );
}
