import { listAnalyses, listEntities, listScoringModels } from "@finance/domain";
import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, EmptyState, Page, PageHeader } from "@/components/page";
import { button, card, rowLink, table } from "@/components/styles";
import { formatDate } from "@/lib/format";
import { getContext, getDb } from "@/lib/server";
import { NewBorrower } from "./_components/new-borrower";
import { Notice } from "./_components/notice";

export const metadata: Metadata = { title: "Borrowers" };

export default function BorrowersPage() {
  return (
    <Page>
      <Suspense fallback={<Loading />}>
        <BorrowersView />
      </Suspense>
    </Page>
  );
}

async function BorrowersView() {
  const db = getDb();
  const ctx = await getContext();
  const [borrowers, scoringModels, analyses] = await Promise.all([
    listEntities(db, ctx),
    listScoringModels(db, ctx),
    listAnalyses(db, ctx),
  ]);
  const options = scoringModels.map((m) => ({
    id: m.id,
    name: m.name,
    published: m.versions.some((v) => v.status === "published"),
  }));
  const analysisCount = (id: string) =>
    analyses.filter((a) => a.entityId === id).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Borrowers"
        description="Paste each borrower's spread or enter it by hand. Every financial model reads the same figures."
        actions={<NewBorrower scoringModels={options} />}
      />

      {!options.some((o) => o.published) && (
        <Notice
          action={
            <Link href="/scoring-models" className={button.secondary}>
              Open scoring models
            </Link>
          }
        >
          Spreads follow a published scoring model. Set one up and publish it
          before entering figures.
        </Notice>
      )}

      {borrowers.length === 0 ? (
        <EmptyState icon={<Building2 />} title="No borrowers yet.">
          Add a borrower, then paste the spread from the scoring system.
        </EmptyState>
      ) : (
        <section className={`${card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead>
                <tr className={table.head}>
                  <th className={table.th}>Borrower</th>
                  <th className={table.th}>Scoring model</th>
                  <th className={table.th}>Rating</th>
                  <th className={`${table.th} text-right`}>Periods</th>
                  <th className={`${table.th} text-right`}>Latest period</th>
                  <th className={`${table.th} text-right`}>Analyses</th>
                </tr>
              </thead>
              <tbody>
                {borrowers.map((b) => (
                  <tr key={b.id} className={table.row}>
                    <td className={table.td}>
                      <div className="flex flex-col gap-0.5">
                        <Link href={`/borrowers/${b.id}`} className={rowLink}>
                          {b.name}
                        </Link>
                        {(b.industry || b.naicsCode) && (
                          <span className="text-xs text-muted">
                            {b.industry}
                            {b.industry && b.naicsCode && " · "}
                            {b.naicsCode && (
                              <span className="font-mono">
                                NAICS {b.naicsCode}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={`${table.td} text-muted`}>
                      {b.scoringModelName}
                    </td>
                    <td className={table.td}>
                      {b.riskRating ? (
                        <Badge>{b.riskRating}</Badge>
                      ) : (
                        <span className="text-muted">–</span>
                      )}
                    </td>
                    <td className={`${table.td} text-right tabular-nums`}>
                      {b.periodCount}
                      {b.projectedPeriodCount > 0 && (
                        <span className="block text-xs text-muted">
                          {b.projectedPeriodCount} projected
                        </span>
                      )}
                    </td>
                    <td
                      className={`${table.td} text-right text-muted tabular-nums`}
                    >
                      {b.latestPeriodEnd
                        ? formatDate(b.latestPeriodEnd)
                        : "None"}
                    </td>
                    <td className={`${table.td} text-right tabular-nums`}>
                      {analysisCount(b.id)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-48 rounded bg-surface-2" />
        <div className="h-4 w-96 max-w-full rounded bg-surface-2" />
      </div>
      <div className="h-64 w-full rounded-xl bg-surface-2" />
    </div>
  );
}
