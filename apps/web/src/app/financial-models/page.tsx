import {
  listAnalyses,
  listFinancialModels,
  listScoringModels,
} from "@finance/domain";
import { Sigma, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  Badge,
  Card,
  EmptyState,
  Page,
  PageHeader,
  VersionBadge,
} from "@/components/page";
import { button, rowLink, table } from "@/components/styles";
import { getContext, getDb } from "@/lib/server";
import { NewModel } from "./_components/new-model";

export const metadata: Metadata = { title: "Financial models" };

export default function FinancialModelsPage() {
  return (
    <Page>
      <Suspense fallback={<Loading />}>
        <ModelsView />
      </Suspense>
    </Page>
  );
}

async function ModelsView() {
  const db = getDb();
  const ctx = await getContext();
  const [list, scoringModels, analyses] = await Promise.all([
    listFinancialModels(db, ctx),
    listScoringModels(db, ctx),
    listAnalyses(db, ctx),
  ]);
  // Financial models are built on a published scoring model.
  const published = scoringModels
    .filter((m) => m.versions.some((v) => v.status === "published"))
    .map((m) => ({ id: m.id, name: m.name }));
  const hasPublished = published.length > 0;
  const names = new Map(list.map((m) => [m.id, m.name]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Financial models"
        description="Groupings, metrics, projections and covenant tests, written as formulas over a scoring model's items. Build once; every borrower's spread on that scoring model fills them. Analysts run the published versions."
        actions={hasPublished && <NewModel scoringModels={published} />}
      />

      {!hasPublished && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          <span className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-warning" aria-hidden />
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
          <EmptyState icon={<Sigma />} title="No financial models yet.">
            Start with the analysis you rebuild most often in Excel, such as
            debt service coverage or covenant compliance.
          </EmptyState>
        )
      ) : (
        <Card flush>
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead>
                <tr className={table.head}>
                  <th className={table.th}>Model</th>
                  <th className={table.th}>Built on</th>
                  <th className={table.th}>Published</th>
                  <th className={table.th}>Draft</th>
                  <th className={`${table.th} text-right`}>Analyses</th>
                </tr>
              </thead>
              <tbody>
                {list.map((model) => {
                  const latest = model.versions.findLast(
                    (v) => v.status === "published",
                  );
                  const draft = model.versions.find(
                    (v) => v.status === "draft",
                  );
                  const variantOf =
                    model.variantOfId && names.get(model.variantOfId);
                  return (
                    <tr key={model.id} className={table.row}>
                      <td className={table.td}>
                        <div className="flex flex-col gap-0.5">
                          <Link
                            href={`/financial-models/${model.id}`}
                            className={rowLink}
                          >
                            {model.name}
                          </Link>
                          {(variantOf || model.description) && (
                            <span className="line-clamp-1 max-w-xl text-xs text-muted">
                              {variantOf
                                ? `Variant of ${variantOf}`
                                : model.description}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={`${table.td} text-muted`}>
                        {model.scoringModel.name}
                      </td>
                      <td className={table.td}>
                        {latest ? (
                          <VersionBadge
                            status="published"
                            number={latest.number}
                          />
                        ) : (
                          <span className="text-muted">Not yet</span>
                        )}
                      </td>
                      <td className={table.td}>
                        {draft && (
                          <Badge tone="accent">v{draft.number} draft</Badge>
                        )}
                      </td>
                      <td
                        className={`${table.td} text-right text-muted tabular-nums`}
                      >
                        {analyses.filter((a) => a.modelId === model.id).length}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-64 rounded bg-surface-2" />
        <div className="h-4 w-full max-w-2xl rounded bg-surface-2" />
      </div>
      <div className="h-64 w-full rounded-xl bg-surface-2" />
    </div>
  );
}
