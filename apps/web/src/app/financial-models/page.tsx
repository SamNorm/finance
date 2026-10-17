import { listFinancialModels, listScoringModels } from "@finance/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { button } from "@/components/styles";
import { getContext, getDb } from "@/lib/server";
import { NewModel } from "./_components/new-model";

export const metadata: Metadata = { title: "Financial models" };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
      <Suspense fallback={<Loading />}>
        <ModelsView />
      </Suspense>
    </div>
  );
}

async function ModelsView() {
  const db = getDb();
  const ctx = await getContext();
  const [list, scoringModels] = await Promise.all([
    listFinancialModels(db, ctx),
    listScoringModels(db, ctx),
  ]);
  // Financial models are built on a published scoring model.
  const published = scoringModels
    .filter((m) => m.versions.some((v) => v.status === "published"))
    .map((m) => ({ id: m.id, name: m.name }));
  const hasPublished = published.length > 0;
  const names = new Map(list.map((m) => [m.id, m.name]));

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            Financial models
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Financial models
          </h1>
          <p className="text-sm text-muted">
            Groupings, metrics, projections and covenant tests, written as
            formulas over a scoring model&apos;s items. Build once; every
            borrower&apos;s spread on that scoring model fills them.
          </p>
        </div>
        {hasPublished && <NewModel scoringModels={published} />}
      </header>

      {!hasPublished && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-warning-soft px-4 py-3 text-sm">
          <span>
            Financial models are built on a published scoring model. Publish one
            first.
          </span>
          <Link href="/scoring-models" className={button.secondary}>
            Open scoring models
          </Link>
        </div>
      )}

      {list.length === 0 ? (
        hasPublished && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong px-6 py-16 text-center">
            <p className="text-sm font-medium">No financial models yet.</p>
            <p className="max-w-sm text-sm text-muted">
              Start with the analysis you rebuild most often in Excel, such as
              debt service coverage or covenant compliance.
            </p>
          </div>
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Model</th>
                <th className="px-4 py-2 font-medium">Built on</th>
                <th className="px-4 py-2 font-medium">Published</th>
                <th className="px-4 py-2 font-medium">Draft</th>
              </tr>
            </thead>
            <tbody>
              {list.map((model) => {
                const latest = model.versions.findLast(
                  (v) => v.status === "published",
                );
                const draft = model.versions.find((v) => v.status === "draft");
                return (
                  <tr
                    key={model.id}
                    className="border-b border-line/60 last:border-b-0 hover:bg-surface-2"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/financial-models/${model.id}`}
                        className="font-medium hover:text-accent"
                      >
                        {model.name}
                      </Link>
                      {model.variantOfId && names.has(model.variantOfId) && (
                        <span className="ml-2 text-xs text-muted">
                          variant of {names.get(model.variantOfId)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted">
                      {model.scoringModel.name}
                    </td>
                    <td className="px-4 py-2.5 text-muted">
                      {latest ? `v${latest.number}` : "Not yet"}
                    </td>
                    <td className="px-4 py-2.5">
                      {draft && (
                        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">
                          v{draft.number} draft
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
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
      <div className="h-3 w-24 rounded bg-surface-2" />
      <div className="h-7 w-64 rounded bg-surface-2" />
      <div className="h-64 w-full rounded-lg bg-surface-2" />
    </div>
  );
}
