import { listEntities, listScoringModels } from "@finance/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { button } from "@/components/styles";
import { formatDate } from "@/lib/format";
import { getContext, getDb } from "@/lib/server";
import { NewBorrower } from "./_components/new-borrower";

export const metadata: Metadata = { title: "Borrowers" };

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
      <Suspense fallback={<Loading />}>
        <BorrowersView />
      </Suspense>
    </div>
  );
}

async function BorrowersView() {
  const db = getDb();
  const ctx = await getContext();
  const [borrowers, scoringModels] = await Promise.all([
    listEntities(db, ctx),
    listScoringModels(db, ctx),
  ]);
  const options = scoringModels.map((m) => ({
    id: m.id,
    name: m.name,
    published: m.versions.some((v) => v.status === "published"),
  }));

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">
            Borrowers
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Borrowers and spreads
          </h1>
          <p className="text-sm text-muted">
            Paste each borrower&apos;s spread or enter it by hand. Every
            financial model reads the same figures.
          </p>
        </div>
        <NewBorrower scoringModels={options} />
      </header>

      {!options.some((o) => o.published) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-warning-soft px-4 py-3 text-sm">
          <span>
            Spreads follow a published scoring model. Set one up and publish it
            before entering figures.
          </span>
          <Link href="/scoring-models" className={button.secondary}>
            Open scoring models
          </Link>
        </div>
      )}

      {borrowers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong px-6 py-16 text-center">
          <p className="text-sm font-medium">No borrowers yet.</p>
          <p className="max-w-sm text-sm text-muted">
            Add a borrower, then paste the spread from the scoring system.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Industry</th>
                <th className="px-4 py-2 font-medium">Scoring model</th>
                <th className="px-4 py-2 font-medium">Rating</th>
                <th className="px-4 py-2 text-right font-medium">Periods</th>
                <th className="px-4 py-2 text-right font-medium">
                  Latest period
                </th>
              </tr>
            </thead>
            <tbody>
              {borrowers.map((b) => (
                <tr
                  key={b.id}
                  className="border-b border-line/60 last:border-b-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/borrowers/${b.id}`}
                      className="font-medium hover:text-accent"
                    >
                      {b.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {b.industry}
                    {b.naicsCode && (
                      <span className="ml-1 font-mono text-xs">
                        ({b.naicsCode})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {b.scoringModelName}
                  </td>
                  <td className="px-4 py-2.5">{b.riskRating}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {b.periodCount}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted tabular-nums">
                    {b.latestPeriodEnd ? formatDate(b.latestPeriodEnd) : "None"}
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
      <div className="h-7 w-72 rounded bg-surface-2" />
      <div className="h-64 w-full rounded-lg bg-surface-2" />
    </div>
  );
}
