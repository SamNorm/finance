import { DomainError, getSpread, type Issue } from "@finance/domain";
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
          <p className="text-sm text-muted">
            {[entity.industry, entity.notes].filter(Boolean).join(" · ") ||
              "No industry set"}
          </p>
        </div>
        <BorrowerActions
          entity={{
            id: entity.id,
            name: entity.name,
            industry: entity.industry,
            notes: entity.notes,
          }}
        />
      </header>

      {!spread.layout ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-warning-soft px-4 py-3 text-sm">
          <span>
            Publish the scoring model before entering this borrower&apos;s
            figures.
          </span>
          <Link href="/scoring-model" className={button.secondary}>
            Open scoring model
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
