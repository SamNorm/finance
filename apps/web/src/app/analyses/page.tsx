import {
  listAnalyses,
  listEntities,
  listFinancialModels,
  type AnalysisSummary,
} from "@finance/domain";
import { ChartLine } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, EmptyState, Page, PageHeader } from "@/components/page";
import { card, rowLink, table } from "@/components/styles";
import { Tabs } from "@/components/tabs";
import { formatDay, formatRelative } from "@/lib/format";
import { ANALYSIS_STATUSES } from "@/lib/labels";
import { getContext, getDb } from "@/lib/server";
import { NewAnalysis } from "./_components/new-analysis";

export const metadata: Metadata = { title: "Analyses" };

export default function AnalysesPage({ searchParams }: PageProps<"/analyses">) {
  return (
    <Page>
      <Suspense fallback={<Loading />}>
        <AnalysesView searchParams={searchParams} />
      </Suspense>
    </Page>
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
    projected: b.projectedPeriodCount,
    scoringModelId: b.scoringModelId,
  }));
  // ?borrower= from a borrower's page, or ?new from the overview, opens the
  // new analysis dialog.
  const preselected =
    typeof query.borrower === "string" ? query.borrower : undefined;
  const now = new Date();
  const inProgress = list.filter((a) => a.status === "in_progress");
  const completed = list.filter((a) => a.status === "completed");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Analyses"
        description="A borrower run through a published financial model, with projections and scenarios. Each analysis stays pinned to its model version, so the credit file reproduces."
        actions={
          <NewAnalysis
            borrowers={borrowerOptions}
            models={publishedModels}
            defaultBorrower={preselected}
            openInitially={preselected !== undefined || "new" in query}
          />
        }
      />

      {list.length === 0 ? (
        <EmptyState
          icon={<ChartLine />}
          title="No analyses yet."
          actions={
            <>
              {!borrowers.length && (
                <Link
                  href="/borrowers"
                  className="text-sm text-accent hover:underline"
                >
                  Borrowers
                </Link>
              )}
              {!publishedModels.length && (
                <Link
                  href="/financial-models"
                  className="text-sm text-accent hover:underline"
                >
                  Financial models
                </Link>
              )}
            </>
          }
        >
          {!borrowers.length
            ? "Add a borrower with its spread first."
            : !publishedModels.length
              ? "A financial model needs to be published first."
              : "Pick a borrower and a published model to run."}
        </EmptyState>
      ) : (
        <Tabs
          param="status"
          initial={typeof query.status === "string" ? query.status : undefined}
          tabs={[
            {
              value: "in_progress",
              label: ANALYSIS_STATUSES.in_progress,
              count: inProgress.length,
              content: <AnalysisTable analyses={inProgress} now={now} />,
            },
            {
              value: "completed",
              label: ANALYSIS_STATUSES.completed,
              count: completed.length,
              content: <AnalysisTable analyses={completed} now={now} />,
            },
            {
              value: "all",
              label: "All",
              count: list.length,
              content: <AnalysisTable analyses={list} now={now} status />,
            },
          ]}
        />
      )}
    </div>
  );
}

function AnalysisTable({
  analyses,
  now,
  status = false,
}: {
  analyses: AnalysisSummary[];
  now: Date;
  status?: boolean;
}) {
  if (!analyses.length) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center text-sm text-muted">
        None here.
      </p>
    );
  }
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className={table.table}>
        <thead>
          <tr className={table.head}>
            <th className={table.th}>Analysis</th>
            <th className={table.th}>Borrower</th>
            <th className={table.th}>Model</th>
            {status && <th className={table.th}>Status</th>}
            <th className={`${table.th} text-right`}>Last change</th>
          </tr>
        </thead>
        <tbody>
          {analyses.map((a) => (
            <tr key={a.id} className={table.row}>
              <td className={table.td}>
                <Link href={`/analyses/${a.id}`} className={rowLink}>
                  {a.name}
                </Link>
              </td>
              <td className={`${table.td} text-muted`}>{a.entityName}</td>
              <td className={`${table.td} text-muted`}>
                {a.modelName}{" "}
                <span className="text-xs">v{a.versionNumber}</span>
              </td>
              {status && (
                <td className={table.td}>
                  <Badge tone={a.status === "completed" ? "success" : "accent"}>
                    {ANALYSIS_STATUSES[a.status]}
                  </Badge>
                </td>
              )}
              <td
                className={`${table.td} text-right whitespace-nowrap text-muted`}
                title={formatDay(a.updatedAt)}
              >
                {a.status === "completed"
                  ? `Completed ${formatDay(a.completedAt!)}`
                  : formatRelative(a.updatedAt, now)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-4" aria-label="Loading">
      <div className="h-7 w-56 rounded bg-surface-2" />
      <div className="h-4 w-96 rounded bg-surface-2" />
      <div className="h-64 w-full rounded-xl bg-surface-2" />
    </div>
  );
}
