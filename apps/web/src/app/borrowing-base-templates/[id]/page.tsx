import {
  chartsOf,
  compileBorrowingBase,
  DomainError,
  getBorrowingBaseTemplate,
  listBorrowingBaseTemplates,
} from "@finance/domain";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { IssuesSummary } from "@/components/issue-list";
import { Page, PageHeader } from "@/components/page";
import { figuresOf } from "@/lib/borrowing-bases";
import { formatDate } from "@/lib/format";
import { getContext, getDb } from "@/lib/server";
import { TemplateActions } from "../_components/template-actions";
import { TemplateCharts } from "../_components/template-charts";
import { TemplateDefinition } from "../_components/template-definition";
import { TemplateStatus } from "../_components/template-status";
import { balanceSheetItems, basedOnName, templateFacts } from "../facts";

export const metadata: Metadata = { title: "Borrowing base template" };

export default function TemplatePage({
  params,
}: PageProps<"/borrowing-base-templates/[id]">) {
  return (
    <Page wide>
      <Suspense fallback={null}>
        <TemplateView params={params} />
      </Suspense>
    </Page>
  );
}

// Templates name no line: they're read against a nominal facility, in
// Canadian dollars with no limit, as the domain checks them.
const NOMINAL = { currency: "CAD", limit: { value: "0" } };

// A template's draft, edited as a line's borrowing base is, then published
// for lines to start from.
async function TemplateView({
  params,
}: Pick<PageProps<"/borrowing-base-templates/[id]">, "params">) {
  const { id } = await params;
  const db = getDb();
  const ctx = await getContext();
  const template = await getBorrowingBaseTemplate(db, ctx, id).catch(
    (error) => {
      if (error instanceof DomainError && error.kind === "not_found")
        notFound();
      throw error;
    },
  );
  const [templates, items] = await Promise.all([
    listBorrowingBaseTemplates(db, ctx),
    balanceSheetItems(db, ctx),
  ]);
  const facts = templateFacts(template);
  const draft = template.draft;
  // What tests and charts can read: the draft's figures, as saved.
  const figures = figuresOf(compileBorrowingBase(draft, NOMINAL).rows, draft);
  const errors = template.issues.filter((i) => i.severity === "error").length;
  const source = basedOnName(template.basedOn, templates);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[
          {
            href: "/borrowing-base-templates",
            label: "Borrowing base templates",
          },
        ]}
        title={template.name}
        badges={<TemplateStatus {...facts} />}
        description={template.description}
        meta={
          <>
            {source && <span>Copied from {source}</span>}
            {template.publishedAt ? (
              <span>
                Published{" "}
                {formatDate(template.publishedAt.toISOString().slice(0, 10))}
                {facts.changed
                  ? "; the draft has changed since"
                  : ", as the draft stands"}
              </span>
            ) : (
              <span>Never published: lines can&apos;t start from it yet</span>
            )}
            {facts.archived && <span>Archived: not offered to lines</span>}
          </>
        }
        actions={<TemplateActions template={facts} errors={errors} />}
      />

      {template.issues.length > 0 && (
        <IssuesSummary
          issues={template.issues}
          note={
            errors
              ? "Checked against a nominal line in CAD. Publishing is refused until errors are fixed."
              : "Checked against a nominal line in CAD. Warnings don't block publishing."
          }
        />
      )}

      <TemplateDefinition
        templateId={template.id}
        definition={draft}
        items={items}
        figures={figures}
        issues={template.issues}
      />

      <TemplateCharts
        templateId={template.id}
        charts={chartsOf(draft)}
        own={draft.charts !== undefined}
        figures={figures}
      />
    </div>
  );
}
