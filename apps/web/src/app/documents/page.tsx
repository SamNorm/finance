import { getOrganization } from "@finance/domain";
import { BUILT_IN_TEMPLATES, type BlockType } from "@finance/documents";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Badge, Card, Page, PageHeader } from "@/components/page";
import { getContext, getDb } from "@/lib/server";
import { BrandingForm } from "./_components/branding-form";

export const metadata: Metadata = { title: "Documents" };

// What each kind of block prints.
const BLOCKS: Record<BlockType, string> = {
  heading: "Heading",
  text: "Text",
  facts: "Facts",
  lines: "Model lines by period",
  covenants: "Covenants",
  charts: "Charts",
  sourcesUses: "Sources and uses",
  debt: "Debt",
  amortization: "Schedules by year",
  pageBreak: "Page break",
};

export default function DocumentsPage() {
  return (
    <Page>
      <Suspense fallback={null}>
        <DocumentsView />
      </Suspense>
    </Page>
  );
}

async function DocumentsView() {
  const organization = await getOrganization(getDb(), await getContext());
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Documents"
        description="The PDFs analysts print from an analysis for the credit file, and how they look. Print them from an analysis's Documents tab."
      />
      <BrandingForm
        organization={organization.name}
        branding={organization.branding}
      />
      <Card
        title="Documents available"
        description="Each is made of blocks reading the analysis's figures. Your own documents, from the same blocks, come next."
        flush
      >
        <ul className="divide-y divide-line">
          {BUILT_IN_TEMPLATES.map((t) => (
            <li key={t.key} className="flex flex-col gap-1.5 px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-medium">
                {t.name}
                <Badge>Built in</Badge>
              </span>
              <span className="text-sm text-muted">{t.description}</span>
              <span className="flex flex-wrap gap-1.5">
                {t.blocks
                  .filter((b) => b.type !== "pageBreak" && b.type !== "heading")
                  .map((b, i) => (
                    <span
                      key={i}
                      className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted"
                    >
                      {BLOCKS[b.type]}
                    </span>
                  ))}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
