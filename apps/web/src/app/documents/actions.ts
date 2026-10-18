"use server";

import {
  deleteDocument,
  generateDocument,
  setBranding,
  type BrandingInput,
} from "@finance/documents";
import { refresh } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { attempt, run } from "@/lib/actions";

// Prints a document from the analysis as it stands and keeps it; returns
// its id, to open its PDF.
export async function generateDocumentAction(
  analysisId: string,
  scenarioId: string | null,
  template: string,
): Promise<ActionResult<{ id: string }>> {
  const result = await attempt(async (db, ctx) => {
    const document = await generateDocument(db, ctx, {
      analysisId: String(analysisId),
      scenarioId: scenarioId ? String(scenarioId) : null,
      template: String(template),
    });
    return { id: document.id };
  });
  if (result.ok) refresh();
  return result;
}

export async function deleteDocumentAction(
  documentId: string,
): Promise<ActionResult> {
  return run((db, ctx) => deleteDocument(db, ctx, String(documentId)));
}

export async function saveBrandingAction(
  input: BrandingInput,
): Promise<ActionResult> {
  return run((db, ctx) =>
    setBranding(db, ctx, {
      color: input?.color === undefined ? undefined : String(input.color ?? ""),
      logo: input?.logo === undefined ? undefined : String(input.logo ?? ""),
      notice:
        input?.notice === undefined ? undefined : String(input.notice ?? ""),
    }),
  );
}
