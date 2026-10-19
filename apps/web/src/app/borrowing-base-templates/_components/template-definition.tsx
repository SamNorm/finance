"use client";

import type { Issue } from "@finance/domain";
import type { BorrowingBaseDefinition } from "@finance/domain/borrowing-bases";
import type { Figure } from "@/lib/borrowing-bases";
import { DefinitionEditor } from "../../borrowing-bases/_components/definition-editor";
import { saveBorrowingBaseTemplateAction } from "../actions";

// A template's draft, edited with a line's Terms editor: lines, the line
// outstanding and tests. Saving keeps the draft, errors and all; they show
// above and hold publishing back.
export function TemplateDefinition({
  templateId,
  definition,
  items,
  figures,
  issues,
}: {
  templateId: string;
  definition: BorrowingBaseDefinition;
  items: { code: string; label: string }[];
  figures: Figure[];
  issues: Issue[];
}) {
  // Charts are saved from their card: they don't reset unsaved changes.
  const edited = JSON.stringify({ ...definition, charts: undefined });
  return (
    <DefinitionEditor
      key={edited}
      currency={null}
      definition={definition}
      items={items}
      figures={figures}
      issues={issues}
      onSave={(next) => saveBorrowingBaseTemplateAction(templateId, next)}
      onWarnings={() => {}}
      description="The draft. Click a line to edit it, then save. Rates and caps here are where a line starts: each client's are set on its own line, to its credit agreement."
      unsaved="Unsaved changes. Save to keep them in the draft; lines start from what's published."
    />
  );
}
