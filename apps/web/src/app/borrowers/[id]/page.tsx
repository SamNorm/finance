import {
  DomainError,
  getSpread,
  listAnalyses,
  listScoringModels,
  nextYearDebtService,
  type Issue,
} from "@finance/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { IssueList } from "@/components/issue-list";
import { button } from "@/components/styles";
import { formatDate } from "@/lib/format";
import { STATEMENTS } from "@/lib/labels";
import { getContext, getDb } from "@/lib/server";
import { BorrowerActions } from "../_components/borrower-actions";
import { DebtScheduleEditor } from "../_components/debt-schedule";
import { SpreadGrid, type GridPeriod } from "../_components/spread-grid";

export const metadata: Metadata = { title: "Borrower" };

export default function Page({
  params,
  searchParams,
}: PageProps<"/borrowers/[id]">) {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
      <Suspense fallback={<Loading />}>
        <SpreadView params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

type Props = Pick<PageProps<"/borrowers/[id]">, "params" | "searchParams">;

async function SpreadView({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const ctx = await getContext();
  const spread = await getSpread(db, ctx, id).catch((error) => {
    if (error instanceof DomainError && error.kind === "not_found") notFound();
    throw error;
  });
  const [analyses, scoringModels] = await Promise.all([
    listAnalyses(db, ctx, { entityId: id }),
    listScoringModels(db, ctx),
  ]);
  const items = spread.layout?.items ?? [];
  const statement =
    STATEMENTS.find((s) => s.value === query.statement)?.value ??
    STATEMENTS.find((s) => items.some((i) => i.statement === s.value))?.value ??
    "balance_sheet";
  const periods: GridPeriod[] = spread.periods.map((p) => ({
    id: p.id,
    periodEnd: p.periodEnd,
    months: p.months,
    quality: p.quality,
    currency: p.currency,
    consolidated: p.consolidated,
  }));
  const { entity } = spread;
  const scoringModel = scoringModels.find(
    (m) => m.id === entity.scoringModelId,
  )!;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            <Link href="/borrowers" className="hover:text-foreground">
              Borrowers
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {entity.name}
          </h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <Link
              href={`/scoring-models/${scoringModel.id}`}
              className="text-accent hover:underline"
            >
              {scoringModel.name}
            </Link>
            {entity.industry && <span>· {entity.industry}</span>}
            {entity.naicsCode && (
              <span className="font-mono text-xs">
                NAICS {entity.naicsCode}
              </span>
            )}
            {entity.riskRating && (
              <span
                className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-foreground"
                title="The official rating from the institution's system"
              >
                Rating {entity.riskRating}
              </span>
            )}
          </p>
          {entity.notes && <p className="text-sm text-muted">{entity.notes}</p>}
        </div>
        <BorrowerActions
          entity={{
            id: entity.id,
            name: entity.name,
            scoringModelId: entity.scoringModelId,
            industry: entity.industry,
            naicsCode: entity.naicsCode,
            riskRating: entity.riskRating,
            notes: entity.notes,
          }}
          scoringModels={scoringModels.map((m) => ({
            id: m.id,
            name: m.name,
            published: m.versions.some((v) => v.status === "published"),
          }))}
          canSwitchModel={spread.periods.length === 0}
        />
      </header>

      {!spread.layout ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-warning-soft px-4 py-3 text-sm">
          <span>
            Publish {scoringModel.name} before entering this borrower&apos;s
            figures.
          </span>
          <Link
            href={`/scoring-models/${scoringModel.id}`}
            className={button.secondary}
          >
            Open {scoringModel.name}
          </Link>
        </div>
      ) : (
        <>
          <Checks periods={periods} checks={spread.checks} />
          <SpreadGrid
            key={spread.layout.versionId}
            entityId={entity.id}
            items={items}
            periods={periods}
            values={spread.values}
            computed={spread.computed}
            checks={spread.checks}
            statement={statement}
          />
        </>
      )}

      <DebtScheduleEditor
        entityId={entity.id}
        schedule={entity.debtSchedule}
        nextYear={Object.fromEntries(
          nextYearDebtService(entity.debtSchedule).map(({ id, ...year }) => [
            id,
            year,
          ]),
        )}
      />

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Analyses</h2>
          <Link
            href={`/analyses?borrower=${entity.id}`}
            className={button.secondary}
          >
            New analysis
          </Link>
        </div>
        {analyses.length ? (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {analyses.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <Link
                  href={`/analyses/${a.id}`}
                  className="font-medium hover:text-accent"
                >
                  {a.name}
                </Link>
                <span className="text-muted">
                  {a.modelName} v{a.versionNumber}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            No analyses for {entity.name} yet.
          </p>
        )}
      </section>
    </div>
  );
}

function Checks({
  periods,
  checks,
}: {
  periods: GridPeriod[];
  checks: Record<string, Issue[]>;
}) {
  if (!periods.length) return null;
  const flagged = periods.filter((p) => checks[p.id]?.length);
  if (!flagged.length) {
    return <p className="text-sm text-success">All statement checks pass.</p>;
  }
  const errors = flagged.reduce(
    (n, p) => n + checks[p.id]!.filter((i) => i.severity === "error").length,
    0,
  );
  const total = flagged.reduce((n, p) => n + checks[p.id]!.length, 0);
  return (
    <details className="group rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm">
        {errors > 0 && (
          <span className="rounded bg-danger-soft px-1.5 py-0.5 font-medium text-danger">
            {errors} {errors === 1 ? "error" : "errors"}
          </span>
        )}
        {total > errors && (
          <span className="rounded bg-warning-soft px-1.5 py-0.5 font-medium text-warning">
            {total - errors} {total - errors === 1 ? "warning" : "warnings"}
          </span>
        )}
        <span className="text-muted">
          Statement checks. They flag problems; nothing is blocked.
        </span>
        <span className="ml-auto text-xs text-muted group-open:hidden">
          Show
        </span>
        <span className="ml-auto hidden text-xs text-muted group-open:inline">
          Hide
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-line px-4 py-3">
        {flagged.map((p) => (
          <div key={p.id} className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-muted">
              {formatDate(p.periodEnd)} · {p.months} months
            </p>
            <IssueList issues={checks[p.id]!} />
          </div>
        ))}
      </div>
    </details>
  );
}

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-4" aria-label="Loading">
      <div className="h-3 w-20 rounded bg-surface-2" />
      <div className="h-7 w-72 rounded bg-surface-2" />
      <div className="h-96 w-full rounded-lg bg-surface-2" />
    </div>
  );
}
