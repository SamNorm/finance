import {
  listEntities,
  listFinancialModels,
  listScoringModels,
} from "@finance/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, Page, PageHeader, VersionBadge } from "@/components/page";
import { card, rowLink, table } from "@/components/styles";
import { getContext, getDb } from "@/lib/server";
import { CreateModel, NewScoringModel } from "./_components/create-model";

export const metadata: Metadata = { title: "Scoring models" };

export default function ScoringModelsPage({
  searchParams,
}: PageProps<"/scoring-models">) {
  return (
    <Page>
      <Suspense fallback={<Loading />}>
        <ModelsView searchParams={searchParams} />
      </Suspense>
    </Page>
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Scoring models"
        description="The inputs analysts enter for each borrower, one model per kind of deal. Each borrower follows one, and financial models are built on one."
        actions={<NewScoringModel />}
      />
      <div className={`${card} overflow-x-auto`}>
        <table className={table.table}>
          <thead>
            <tr className={table.head}>
              <th className={table.th}>Model</th>
              <th className={table.th}>Published</th>
              <th className={table.th}>Draft</th>
              <th className={`${table.th} text-right`}>Borrowers</th>
              <th className={`${table.th} text-right`}>Financial models</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => {
              const published = m.versions.findLast(
                (v) => v.status === "published",
              );
              const draft = m.versions.find((v) => v.status === "draft");
              return (
                <tr key={m.id} className={table.row}>
                  <td className={table.td}>
                    <span className="flex flex-col gap-0.5">
                      <Link
                        href={`/scoring-models/${m.id}`}
                        className={rowLink}
                      >
                        {m.name}
                      </Link>
                      <span className="text-xs text-muted">
                        {m.source === "mirrored"
                          ? `Mirrors ${m.sourceSystem || "a scoring system"}`
                          : "Input sheet"}
                      </span>
                    </span>
                  </td>
                  <td className={table.td}>
                    {published ? (
                      <VersionBadge
                        status="published"
                        number={published.number}
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
                  <td className={`${table.td} text-right tabular-nums`}>
                    {borrowers.filter((b) => b.scoringModelId === m.id).length}
                  </td>
                  <td className={`${table.td} text-right tabular-nums`}>
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
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-64 rounded bg-surface-2" />
        <div className="h-4 w-96 rounded bg-surface-2" />
      </div>
      <div className="h-48 w-full rounded-xl bg-surface-2" />
    </div>
  );
}
