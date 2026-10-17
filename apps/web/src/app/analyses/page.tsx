import {
  listAnalyses,
  listEntities,
  listFinancialModels,
} from "@finance/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getContext, getDb } from "@/lib/server";
import { NewAnalysis } from "./_components/new-analysis";

export const metadata: Metadata = { title: "Analyses" };

export default function Page({ searchParams }: PageProps<"/analyses">) {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
      <Suspense fallback={<Loading />}>
        <AnalysesView searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function AnalysesView({
  searchParams,
}: Pick<PageProps<"/analyses">, "searchParams">) {
  const query = await searchParams;
  const db = getDb();
  const ctx = await getContext();
  const [list, borrowers, models] = await Promise.all([
    listAnalyses(db, ctx),
    listEntities(db, ctx),
    listFinancialModels(db, ctx),
  ]);
  const publishedModels = models
    .filter((m) => m.versions.some((v) => v.status === "published"))
    .map((m) => ({
      id: m.id,
      name: m.name,
      version: m.versions.findLast((v) => v.status === "published")!.number,
      scoringModelId: m.scoringModel.id,
    }));
  const borrowerOptions = borrowers.map((b) => ({
    id: b.id,
    name: b.name,
    periods: b.periodCount,
    scoringModelId: b.scoringModelId,
  }));
  const preselected =
    typeof query.borrower === "string" ? query.borrower : undefined;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            Analyses
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Analyses</h1>
          <p className="text-sm text-muted">
            A borrower run through a published financial model, with projections
            and scenarios. Each analysis stays pinned to its model version, so
            the credit file reproduces.
          </p>
        </div>
        <NewAnalysis
          borrowers={borrowerOptions}
          models={publishedModels}
          defaultBorrower={preselected}
          openInitially={preselected !== undefined}
        />
      </header>

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong px-6 py-16 text-center">
          <p className="text-sm font-medium">No analyses yet.</p>
          <p className="max-w-md text-sm text-muted">
            {!borrowers.length
              ? "Add a borrower with its spread first."
              : !publishedModels.length
                ? "Publish a financial model first."
                : "Pick a borrower and a published model to run."}
          </p>
          <div className="flex gap-3 text-sm">
            {!borrowers.length && (
              <Link href="/borrowers" className="text-accent hover:underline">
                Borrowers
              </Link>
            )}
            {!publishedModels.length && (
              <Link
                href="/financial-models"
                className="text-accent hover:underline"
              >
                Financial models
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Analysis</th>
                <th className="px-4 py-2 font-medium">Borrower</th>
                <th className="px-4 py-2 font-medium">Model</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-line/60 last:border-b-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/analyses/${a.id}`}
                      className="font-medium hover:text-accent"
                    >
                      {a.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{a.entityName}</td>
                  <td className="px-4 py-2.5 text-muted">
                    {a.modelName}{" "}
                    <span className="text-xs">v{a.versionNumber}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-4" aria-label="Loading">
      <div className="h-3 w-20 rounded bg-surface-2" />
      <div className="h-7 w-56 rounded bg-surface-2" />
      <div className="h-64 w-full rounded-lg bg-surface-2" />
    </div>
  );
}
