import {
  getTemplate,
  templateModel,
  templateOf,
  type BoundModel,
} from "@finance/documents";
import {
  DomainError,
  getAnalysis,
  getBorrowingBase,
  listAnalyses,
  listFinancialModels,
  listMarginedLines,
} from "@finance/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { IssuesSummary } from "@/components/issue-list";
import { Page, PageHeader } from "@/components/page";
import { formatDate } from "@/lib/format";
import { getContext, getDb } from "@/lib/server";
import { TemplateActions } from "../../_components/template-actions";
import {
  TemplateEditor,
  type ModelChoices,
} from "../../_components/template-editor";
import { TemplatePreview } from "../../_components/template-preview";
import { TemplateStatus } from "../../_components/template-status";

export const metadata: Metadata = { title: "Document" };

export default function TemplatePage({
  params,
  searchParams,
}: PageProps<"/documents/templates/[id]">) {
  return (
    <Page wide>
      <Suspense fallback={null}>
        <TemplateView params={params} searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

// What the section pickers offer: the model's lines that hold figures, under
// their sections, and its charts.
function choices(model: BoundModel): ModelChoices {
  let section: string | null = null;
  return {
    name: model.name,
    lines: model.lines.flatMap((line) => {
      if (line.kind === "header") {
        section = line.label;
        return [];
      }
      return [{ code: line.code, label: line.label, section }];
    }),
    charts: model.charts.map(({ id, title }) => ({ id, title })),
  };
}

async function TemplateView({
  params,
  searchParams,
}: Pick<PageProps<"/documents/templates/[id]">, "params" | "searchParams">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const ctx = await getContext();
  const template = await getTemplate(db, ctx, id).catch((error) => {
    if (error instanceof DomainError && error.kind === "not_found") notFound();
    throw error;
  });
  const fromLine = template.source === "line";
  const [models, analyses, model, lines] = await Promise.all([
    listFinancialModels(db, ctx),
    fromLine ? [] : listAnalyses(db, ctx),
    template.financialModel
      ? templateModel(db, ctx, template.financialModel.id)
      : null,
    fromLine ? listMarginedLines(db, ctx) : [],
  ]);
  // A line template previews with a margined line and one of its months
  // with a certificate, the latest unless another is picked.
  const line = lines.find((l) => l.lineId === query.line) ?? lines[0] ?? null;
  const months = line
    ? (await getBorrowingBase(db, ctx, line.lineId)).months.map((m) => m.month)
    : [];
  const month = months.find((m) => m === query.month) ?? months.at(-1) ?? null;
  // Analyses it can print for: on its model, or any when it reads none.
  const fitting = analyses.filter(
    (a) => !template.financialModel || a.modelId === template.financialModel.id,
  );
  const analysis =
    fitting.find((a) => a.id === query.analysis) ?? fitting[0] ?? null;
  const scenarios = analysis
    ? (await getAnalysis(db, ctx, analysis.id)).scenarios.map((s) => ({
        id: s.id,
        name: s.name,
      }))
    : [];
  const scenario = scenarios.find((s) => s.id === query.scenario) ?? null;
  const errors = template.issues.filter((i) => i.severity === "error").length;
  const source = template.basedOn
    ? (templateOf(template.basedOn)?.name ?? null)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ href: "/documents", label: "Documents" }]}
        title={template.name}
        badges={
          <TemplateStatus status={template.status} changed={template.changed} />
        }
        description={template.description}
        meta={
          <>
            {fromLine ? (
              <span>Prints from a margined line of credit</span>
            ) : template.financialModel ? (
              <span>
                Reads{" "}
                <Link
                  href={`/financial-models/${template.financialModel.id}`}
                  className="text-accent hover:underline"
                >
                  {template.financialModel.name}
                </Link>
                {model?.version != null && ` v${model.version}`}
              </span>
            ) : (
              <span>Prints for any analysis</span>
            )}
            {source && <span>Copied from {source}</span>}
            {template.publishedAt && (
              <span>
                Published{" "}
                {formatDate(template.publishedAt.toISOString().slice(0, 10))}
              </span>
            )}
          </>
        }
        actions={
          <TemplateActions
            template={{
              id: template.id,
              name: template.name,
              description: template.description,
              financialModelId: template.financialModel?.id ?? null,
              source: template.source,
              status: template.status,
              published: template.published !== null,
              changed: template.changed,
            }}
            errors={errors}
            models={models.map(({ id, name }) => ({ id, name }))}
          />
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="flex flex-col gap-4">
          {template.issues.length > 0 && (
            <IssuesSummary
              issues={template.issues}
              note={
                errors
                  ? "Fix errors before publishing."
                  : "Warnings don't block publishing."
              }
            />
          )}
          <TemplateEditor
            templateId={template.id}
            draft={template.draft}
            source={template.source}
            model={model && choices(model)}
          />
        </div>
        <TemplatePreview
          templateId={template.id}
          version={template.updatedAt.toISOString()}
          orientation={template.draft.orientation}
          from={
            fromLine
              ? {
                  source: "line",
                  lines: lines.map((l) => ({
                    id: l.lineId,
                    name: l.name,
                    borrower: l.entity.name,
                  })),
                  lineId: line?.lineId ?? null,
                  months,
                  month,
                }
              : {
                  source: "analysis",
                  analyses: fitting.map((a) => ({
                    id: a.id,
                    name: a.name,
                    borrower: a.entityName,
                  })),
                  analysisId: analysis?.id ?? null,
                  scenarios,
                  scenarioId: scenario?.id ?? null,
                  modelName: template.financialModel?.name ?? null,
                }
          }
        />
      </div>
    </div>
  );
}
