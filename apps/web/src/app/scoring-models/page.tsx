import {
  listEntities,
  listFinancialModels,
  listScoringModels,
} from "@finance/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getContext, getDb } from "@/lib/server";
import { CreateModel, NewScoringModel } from "./_components/create-model";

export const metadata: Metadata = { title: "Scoring models" };

export default function Page({ searchParams }: PageProps<"/scoring-models">) {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
      <Suspense fallback={<Loading />}>
        <ModelsView searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ModelsView({
  searchParams,
}: Pick<PageProps<"/scoring-models">, "searchParams">) {
  const query = await searchParams;
  const db = getDb();
  const ctx = await getContext();
  const [models, borrowers, financialModels] = await Promise.all([
    listScoringModels(db, ctx),
    listEntities(db, ctx),
    listFinancialModels(db, ctx),
  ]);
  if (!models.length) {
    return (
      <CreateModel
        defaultSource={query.source === "native" ? "native" : "mirrored"}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            Scoring models
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Scoring models
          </h1>
          <p className="text-sm text-muted">
            The inputs analysts enter for each borrower, one model per kind of
            deal. Each borrower follows one, and financial models are built on
            one.
          </p>
        </div>
        <NewScoringModel />
      </header>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2 font-medium">Model</th>
              <th className="px-4 py-2 font-medium">Kind</th>
              <th className="px-4 py-2 font-medium">Published</th>
              <th className="px-4 py-2 text-right font-medium">Borrowers</th>
              <th className="px-4 py-2 text-right font-medium">
                Financial models
              </th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => {
              const published = m.versions.findLast(
                (v) => v.status === "published",
              );
              const draft = m.versions.find((v) => v.status === "draft");
              return (
                <tr
                  key={m.id}
                  className="border-b border-line/60 last:border-b-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/scoring-models/${m.id}`}
                      className="font-medium hover:text-accent"
                    >
                      {m.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {m.source === "mirrored"
                      ? `Mirrors ${m.sourceSystem || "a scoring system"}`
                      : "Input sheet"}
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {published ? `v${published.number}` : "Not yet"}
                    {draft && (
                      <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">
                        v{draft.number} draft
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {borrowers.filter((b) => b.scoringModelId === m.id).length}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {
                      financialModels.filter((f) => f.scoringModel.id === m.id)
                        .length
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-4" aria-label="Loading">
      <div className="h-3 w-24 rounded bg-surface-2" />
      <div className="h-7 w-64 rounded bg-surface-2" />
      <div className="h-48 w-full rounded-lg bg-surface-2" />
    </div>
  );
}
