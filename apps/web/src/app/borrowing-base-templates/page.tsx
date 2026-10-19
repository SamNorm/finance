import {
  BUILT_IN_BORROWING_BASES,
  LINE_KINDS,
  listBorrowingBaseTemplates,
  normalizeDefinition,
  type BorrowingBaseDefinition,
} from "@finance/domain";
import { LayoutTemplate } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, EmptyState, Page, PageHeader, plural } from "@/components/page";
import { rowLink, table } from "@/components/styles";
import { formatDate } from "@/lib/format";
import { getContext, getDb } from "@/lib/server";
import { NewTemplate } from "./_components/new-template";
import { TemplateRowMenu } from "./_components/template-actions";
import { TemplateStatus } from "./_components/template-status";
import { basedOnName, templateFacts } from "./facts";

export const metadata: Metadata = { title: "Borrowing base templates" };

export default function TemplatesPage() {
  return (
    <Page>
      <Suspense fallback={null}>
        <TemplatesView />
      </Suspense>
    </Page>
  );
}

// "8 lines · 2 tests": a definition's size at a glance.
function size(definition: BorrowingBaseDefinition) {
  const collateral = definition.lines.filter(
    (l) => l.kind === "collateral",
  ).length;
  return [
    plural(collateral, "collateral line"),
    plural(definition.lines.length, "line"),
    ...(definition.tests?.length
      ? [plural(definition.tests.length, "test")]
      : []),
  ].join(" · ");
}

async function TemplatesView() {
  const db = getDb();
  const ctx = await getContext();
  const templates = await listBorrowingBaseTemplates(db, ctx);
  const builtIns = BUILT_IN_BORROWING_BASES.map((b) => ({
    ...b,
    read: normalizeDefinition(b.definition, "CAD").definition,
  }));
  const choices = {
    builtIns: builtIns.map(({ id, name }) => ({ id, name })),
    templates: templates.map(({ id, name }) => ({ id, name })),
  };
  const offered = templates.filter((t) => t.published && !t.archivedAt);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Borrowing base templates"
        description={`The structures a margined line's borrowing base starts from: the built-in ones, and your own. A line copies what's published and is its own from then on, set to its credit agreement; templates set no policy limits. ${offered.length ? `Analysts can start from ${plural(offered.length + builtIns.length, "template")}.` : ""}`}
        actions={<NewTemplate {...choices} />}
      />

      {templates.length === 0 ? (
        <EmptyState
          icon={<LayoutTemplate />}
          title="No templates of your own yet."
        >
          Start one blank or from a built-in: its collateral and groups, the
          ineligibles, prior claims and reserves, the tests and charts your
          organization uses. Publish it for analysts to start lines from.
        </EmptyState>
      ) : (
        <Card
          title="Your templates"
          description="Lines start from what's published. Changes stay in the draft until you publish them; archived ones aren't offered."
          flush
        >
          <div className="overflow-x-auto">
            <table className={table.table}>
              <thead>
                <tr className={table.head}>
                  <th className={table.th}>Template</th>
                  <th className={table.th}>Based on</th>
                  <th className={table.th}>Draft</th>
                  <th className={table.th}>Status</th>
                  <th className={`${table.th} text-right`}>Updated</th>
                  <th className={table.th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => {
                  const facts = templateFacts(t);
                  return (
                    <tr
                      key={t.id}
                      className={`${table.row} ${facts.archived ? "opacity-60" : ""}`}
                    >
                      <td className={table.td}>
                        <Link
                          href={`/borrowing-base-templates/${t.id}`}
                          className={rowLink}
                        >
                          {t.name}
                        </Link>
                        {t.description && (
                          <span className="block max-w-md text-xs text-muted">
                            {t.description}
                          </span>
                        )}
                      </td>
                      <td className={`${table.td} text-muted`}>
                        {basedOnName(t.basedOn, templates) ?? "Blank"}
                      </td>
                      <td
                        className={`${table.td} text-xs whitespace-nowrap text-muted`}
                      >
                        {size(t.draft)}
                      </td>
                      <td className={table.td}>
                        <TemplateStatus {...facts} />
                      </td>
                      <td
                        className={`${table.td} text-right whitespace-nowrap text-muted tabular-nums`}
                      >
                        {formatDate(t.updatedAt.toISOString().slice(0, 10))}
                      </td>
                      <td className={`${table.td} w-12 py-2`}>
                        <TemplateRowMenu template={facts} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card
        title="Built in"
        description="Shipped with the app, with Canadian defaults. Analysts can start a line from them directly; copy one to make it your organization's own."
        flush
      >
        <ul className="divide-y divide-line">
          {builtIns.map((b) => (
            <li
              key={b.id}
              className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-sm font-medium">{b.name}</span>
                <span className="text-sm text-muted">{b.description}</span>
                <span className="flex flex-wrap gap-1.5">
                  {(
                    [
                      "collateral",
                      "ineligible",
                      "prior_claim",
                      "reserve",
                      "usage",
                      "assumption",
                    ] as const
                  ).flatMap((kind) => {
                    const n = b.read.lines.filter(
                      (l) => l.kind === kind,
                    ).length;
                    return n
                      ? [
                          <span
                            key={kind}
                            className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted"
                          >
                            {n} {LINE_KINDS[kind].label.toLowerCase()}
                          </span>,
                        ]
                      : [];
                  })}
                </span>
              </div>
              <NewTemplate {...choices} copy={{ from: b.id, name: b.name }} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
