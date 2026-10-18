import {
  BUILT_IN_TEMPLATES,
  listTemplates,
  SECTIONS,
  type TemplateSummary,
} from "@finance/documents";
import { getOrganization, listFinancialModels } from "@finance/domain";
import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, Card, EmptyState, Page, PageHeader } from "@/components/page";
import { rowLink, table } from "@/components/styles";
import { Tabs } from "@/components/tabs";
import { formatDate } from "@/lib/format";
import { getContext, getDb } from "@/lib/server";
import { BrandingForm } from "./_components/branding-form";
import { BuiltInVisibility } from "./_components/built-in-visibility";
import { NewDocument } from "./_components/new-document";
import { TemplateStatus } from "./_components/template-status";

export const metadata: Metadata = { title: "Documents" };

export default function DocumentsPage({
  searchParams,
}: PageProps<"/documents">) {
  return (
    <Page>
      <Suspense fallback={null}>
        <DocumentsView searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function DocumentsView({
  searchParams,
}: Pick<PageProps<"/documents">, "searchParams">) {
  const db = getDb();
  const ctx = await getContext();
  const [query, organization, templates, models] = await Promise.all([
    searchParams,
    getOrganization(db, ctx),
    listTemplates(db, ctx),
    listFinancialModels(db, ctx),
  ]);
  const newDocument = {
    builtIns: BUILT_IN_TEMPLATES.map(({ key, name }) => ({ key, name })),
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      financialModelId: t.financialModel?.id ?? null,
    })),
    models: models.map(({ id, name }) => ({ id, name })),
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Documents"
        description="The PDFs analysts print from an analysis for the credit file: the built-in ones, and your own made from the same sections. Analysts print them from an analysis's Documents tab."
        actions={<NewDocument {...newDocument} />}
      />
      <Tabs
        initial={typeof query.tab === "string" ? query.tab : undefined}
        tabs={[
          {
            value: "documents",
            label: "Documents",
            count: templates.length + BUILT_IN_TEMPLATES.length,
            content: (
              <div className="flex flex-col gap-6">
                <Templates templates={templates} />
                <Card
                  title="Built in"
                  description="Ready to print from any analysis. Copy one to change its sections or wording, and hide one your own replaces."
                  flush
                >
                  <ul className="divide-y divide-line">
                    {BUILT_IN_TEMPLATES.map((t) => (
                      <li
                        key={t.key}
                        className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <span className="flex items-center gap-2 text-sm font-medium">
                            {t.name}
                            {organization.hiddenBuiltIns.includes(t.key) && (
                              <Badge>Hidden from analysts</Badge>
                            )}
                          </span>
                          <span className="text-sm text-muted">
                            {t.description}
                          </span>
                          <span className="flex flex-wrap gap-1.5">
                            {t.blocks
                              .filter(
                                (b) =>
                                  b.type !== "pageBreak" &&
                                  b.type !== "heading",
                              )
                              .map((b, i) => (
                                <span
                                  key={i}
                                  className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted"
                                >
                                  {SECTIONS[b.type].label}
                                </span>
                              ))}
                          </span>
                        </div>
                        <div className="flex items-start gap-2">
                          <BuiltInVisibility
                            template={{ key: t.key, name: t.name }}
                            hidden={organization.hiddenBuiltIns.includes(t.key)}
                          />
                          <NewDocument
                            {...newDocument}
                            copy={{ from: t.key, name: t.name }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            ),
          },
          {
            value: "branding",
            label: "Branding",
            content: (
              <BrandingForm
                organization={organization.name}
                branding={organization.branding}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

function Templates({ templates }: { templates: TemplateSummary[] }) {
  if (!templates.length)
    return (
      <EmptyState icon={<FileText />} title="No documents of your own yet.">
        Make one from the sections the built-in documents use: pick them, order
        them, word the headings and text, and choose when each shows. Start
        blank or from a copy.
      </EmptyState>
    );
  return (
    <Card
      title="Your documents"
      description="Analysts print what's published. Changes stay in the draft until you publish them."
      flush
    >
      <div className="overflow-x-auto">
        <table className={table.table}>
          <thead>
            <tr className={table.head}>
              <th className={table.th}>Document</th>
              <th className={table.th}>Reads</th>
              <th className={table.th}>Status</th>
              <th className={`${table.th} text-right`}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr
                key={t.id}
                className={`${table.row} ${t.status === "archived" ? "opacity-60" : ""}`}
              >
                <td className={table.td}>
                  <Link
                    href={`/documents/templates/${t.id}`}
                    className={rowLink}
                  >
                    {t.name}
                  </Link>
                  {t.description && (
                    <span className="block text-xs text-muted">
                      {t.description}
                    </span>
                  )}
                </td>
                <td className={`${table.td} text-muted`}>
                  {t.financialModel?.name ?? "Any analysis"}
                </td>
                <td className={table.td}>
                  <TemplateStatus status={t.status} changed={t.changed} />
                </td>
                <td
                  className={`${table.td} text-right whitespace-nowrap text-muted tabular-nums`}
                >
                  {formatDate(t.updatedAt.toISOString().slice(0, 10))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
