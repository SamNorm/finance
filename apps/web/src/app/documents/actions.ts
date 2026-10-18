"use server";

import {
  archiveTemplate,
  createTemplate,
  deleteDocument,
  deleteTemplate,
  discardTemplateChanges,
  generateDocument,
  publishTemplate,
  setBranding,
  updateTemplate,
  type BrandingInput,
  type Orientation,
} from "@finance/documents";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { attempt, run, text } from "@/lib/actions";

const editor = (templateId: string) => `/documents/templates/${templateId}`;

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

// A new document, blank or a copy of a built-in's or a template's
// definition; opens it in the editor.
export async function createTemplateAction(
  form: FormData,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) =>
    createTemplate(db, ctx, {
      name: text(form, "name"),
      description: text(form, "description"),
      from: text(form, "from") || null,
      financialModelId: text(form, "financialModelId") || null,
    }),
  );
  if (!result.ok) return result;
  redirect(editor(result.value.id));
}

export async function updateTemplateDetailsAction(
  templateId: string,
  form: FormData,
): Promise<ActionResult> {
  return run((db, ctx) =>
    updateTemplate(db, ctx, String(templateId), {
      name: text(form, "name"),
      description: text(form, "description"),
      // Left out once published, when it can't change.
      financialModelId: form.has("financialModelId")
        ? text(form, "financialModelId") || null
        : undefined,
    }),
  );
}

// Saves part of the draft: its title, orientation or sections. The
// sections are parsed and checked in the domain.
export async function saveTemplateAction(
  templateId: string,
  draft: { title?: string; orientation?: string; blocks?: unknown },
): Promise<ActionResult> {
  return run((db, ctx) =>
    updateTemplate(db, ctx, String(templateId), {
      title: draft?.title === undefined ? undefined : String(draft.title),
      orientation:
        draft?.orientation === undefined
          ? undefined
          : (String(draft.orientation) as Orientation),
      blocks: draft?.blocks,
    }),
  );
}

export async function publishTemplateAction(
  templateId: string,
): Promise<ActionResult> {
  return run((db, ctx) => publishTemplate(db, ctx, String(templateId)));
}

export async function discardTemplateChangesAction(
  templateId: string,
): Promise<ActionResult> {
  return run((db, ctx) => discardTemplateChanges(db, ctx, String(templateId)));
}

export async function archiveTemplateAction(
  templateId: string,
  archived: boolean,
): Promise<ActionResult> {
  return run((db, ctx) =>
    archiveTemplate(db, ctx, String(templateId), archived === true),
  );
}

export async function deleteTemplateAction(
  templateId: string,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) =>
    deleteTemplate(db, ctx, String(templateId)),
  );
  if (!result.ok) return result;
  redirect("/documents");
}
