"use server";

import {
  archiveBorrowingBaseTemplate,
  createBorrowingBaseTemplate,
  definitionAsTyped,
  deleteBorrowingBaseTemplate,
  discardBorrowingBaseTemplateChanges,
  getBorrowingBaseTemplate,
  publishBorrowingBaseTemplate,
  updateBorrowingBaseTemplate,
  type Issue,
} from "@finance/domain";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { definitionFields } from "@/lib/borrowing-base-fields";
import { attempt, invalid, run, text } from "@/lib/actions";

// The organization's borrowing base templates (borrowing-base-plan.md §5.1,
// §5.7): a draft edited as a line's borrowing base is, and what's published
// for lines to start from. Thin wrappers over the domain.

const page = (templateId: string) => `/borrowing-base-templates/${templateId}`;

// A new template, blank or a copy of a built-in's or a template's draft;
// opens it to edit.
export async function createBorrowingBaseTemplateAction(
  form: FormData,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) =>
    createBorrowingBaseTemplate(db, ctx, {
      name: text(form, "name"),
      description: text(form, "description") || null,
      from: text(form, "from") || null,
    }),
  );
  if (!result.ok) return result;
  redirect(page(result.value.id));
}

export async function updateBorrowingBaseTemplateDetailsAction(
  templateId: string,
  form: FormData,
): Promise<ActionResult> {
  return run((db, ctx) =>
    updateBorrowingBaseTemplate(db, ctx, String(templateId), {
      name: text(form, "name"),
      description: text(form, "description") || null,
    }),
  );
}

// Saves the draft's whole definition. It's kept as long as it reads; its
// errors hold publishing back, and show on the page.
export async function saveBorrowingBaseTemplateAction(
  templateId: string,
  definition: unknown,
): Promise<ActionResult<Issue[]>> {
  const result = await attempt(async (db, ctx) => {
    const detail = await updateBorrowingBaseTemplate(
      db,
      ctx,
      String(templateId),
      { definition: definitionFields(definition) },
    );
    return detail.issues;
  });
  if (result.ok) refresh();
  return result;
}

// Replaces the draft's charts, the rest of its definition as saved. With
// none listed it shows the defaults; an empty list is none.
export async function saveBorrowingBaseTemplateChartsAction(
  templateId: string,
  charts: unknown,
): Promise<ActionResult> {
  return run(async (db, ctx) => {
    if (!Array.isArray(charts)) throw invalid("Charts must be a list.");
    const { draft } = await getBorrowingBaseTemplate(
      db,
      ctx,
      String(templateId),
    );
    return updateBorrowingBaseTemplate(db, ctx, String(templateId), {
      definition: { ...definitionAsTyped(draft), charts },
    });
  });
}

// Publishes the draft, refused while it has errors, which come back.
export async function publishBorrowingBaseTemplateAction(
  templateId: string,
): Promise<ActionResult> {
  return run((db, ctx) =>
    publishBorrowingBaseTemplate(db, ctx, String(templateId)),
  );
}

export async function discardBorrowingBaseTemplateChangesAction(
  templateId: string,
): Promise<ActionResult> {
  return run((db, ctx) =>
    discardBorrowingBaseTemplateChanges(db, ctx, String(templateId)),
  );
}

export async function archiveBorrowingBaseTemplateAction(
  templateId: string,
  archived: boolean,
): Promise<ActionResult> {
  return run((db, ctx) =>
    archiveBorrowingBaseTemplate(
      db,
      ctx,
      String(templateId),
      archived === true,
    ),
  );
}

// Lines started from it keep their copy.
export async function deleteBorrowingBaseTemplateAction(
  templateId: string,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) =>
    deleteBorrowingBaseTemplate(db, ctx, String(templateId)),
  );
  if (!result.ok) return result;
  redirect("/borrowing-base-templates");
}
