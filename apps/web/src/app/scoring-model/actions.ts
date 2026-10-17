"use server";

import type { Db } from "@finance/db";
import {
  addItem,
  createDraft,
  createScoringModel,
  diffItems,
  discardDraft,
  DomainError,
  getScoringModel,
  hasErrors,
  isStructural,
  listItems,
  moveItem,
  parseItemTable,
  publishVersion,
  removeItem,
  replaceItems,
  updateItem,
  updateScoringModel,
  validateItems,
  type Context,
  type ScoringItem,
} from "@finance/domain";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { attempt, invalid, run, text } from "@/lib/actions";
import {
  AGGREGATIONS,
  DATA_TYPES,
  isOneOf,
  KINDS,
  SIGNS,
  STATEMENTS,
} from "@/lib/labels";
import { getContext, getDb } from "@/lib/server";
import type { ImportPreview } from "./types";

const PAGE = "/scoring-model";

// Runs a change, then navigates to the version it returns. Navigating from the
// server keeps the change and the new page in one response; a refresh followed
// by a client-side push can race and lose the navigation.
async function runAndShow(
  work: (db: Db, ctx: Context) => Promise<number | null>,
): Promise<ActionResult> {
  const result = await attempt(work);
  if (!result.ok) return result;
  redirect(result.value === null ? PAGE : `${PAGE}?v=${result.value}`);
}

function choice<T extends string>(
  form: FormData,
  name: string,
  options: Record<T, string>,
): T {
  const value = text(form, name);
  if (!isOneOf(options, value))
    throw invalid(`"${value}" isn't a valid ${name}.`);
  return value;
}

const statements = Object.fromEntries(
  STATEMENTS.map((s) => [s.value, s.label]),
) as Record<ScoringItem["statement"], string>;

// Every editable field. Attributes come only from imports and are left as is.
function readItem(form: FormData): Omit<ScoringItem, "attributes"> {
  return {
    code: text(form, "code"),
    label: text(form, "label"),
    statement: choice(form, "statement", statements),
    parentCode: text(form, "parentCode") || null,
    kind: choice(form, "kind", KINDS),
    dataType: choice(form, "dataType", DATA_TYPES),
    aggregation: choice(form, "aggregation", AGGREGATIONS),
    expectedSign: choice(form, "expectedSign", SIGNS),
    description: text(form, "description") || null,
  };
}

export async function createModelAction(form: FormData): Promise<ActionResult> {
  return run(async (db, ctx) => {
    const name = text(form, "name");
    if (!name) throw invalid("Give the scoring model a name.");
    const source = choice(form, "source", { mirrored: "", native: "" });
    await createScoringModel(db, ctx, {
      name,
      source,
      sourceSystem:
        source === "mirrored" ? text(form, "sourceSystem") || null : null,
      description: text(form, "description") || null,
    });
  });
}

// Turns the scoring model on (mirrored) or off (the organization's own input
// sheet). Only the label and wording change; the items stay.
export async function setScoringModelSourceAction(
  source: "mirrored" | "native",
): Promise<ActionResult> {
  return run(async (db, ctx) => {
    if (source !== "mirrored" && source !== "native") {
      throw invalid(`"${source}" isn't a valid source.`);
    }
    await updateScoringModel(db, ctx, { source });
  });
}

// Adds an item, or updates the one named by originalCode.
export async function saveItemAction(form: FormData): Promise<ActionResult> {
  return run(async (db, ctx) => {
    const versionId = text(form, "versionId");
    const originalCode = text(form, "originalCode");
    const item = readItem(form);
    if (originalCode) {
      await updateItem(db, ctx, versionId, originalCode, item);
    } else {
      const position = Number(text(form, "position"));
      await addItem(
        db,
        ctx,
        versionId,
        item,
        Number.isFinite(position) ? position : undefined,
      );
    }
  });
}

export async function removeItemAction(
  versionId: string,
  code: string,
): Promise<ActionResult> {
  return run(async (db, ctx) => {
    await removeItem(db, ctx, versionId, code);
  });
}

export async function moveItemAction(
  versionId: string,
  code: string,
  position: number,
): Promise<ActionResult> {
  return run(async (db, ctx) => {
    await moveItem(db, ctx, versionId, code, position);
  });
}

export async function publishAction(
  versionId: string,
  notes: string,
): Promise<ActionResult> {
  return run(async (db, ctx) => {
    await publishVersion(db, ctx, versionId, notes.trim() || undefined);
  });
}

// Opens the next draft and shows it.
export async function createDraftAction(): Promise<ActionResult> {
  return runAndShow(async (db, ctx) => (await createDraft(db, ctx)).number);
}

export async function discardDraftAction(
  versionId: string,
): Promise<ActionResult> {
  return runAndShow(async (db, ctx) => {
    await discardDraft(db, ctx, versionId);
    return null;
  });
}

async function parseImport(db: Db, ctx: Context, source: string) {
  const { items, issues: parseIssues, rowByCode } = parseItemTable(source);
  const issues = [...parseIssues, ...validateItems(items)].map((issue) => ({
    ...issue,
    row:
      issue.row ?? (issue.itemCode ? rowByCode.get(issue.itemCode) : undefined),
  }));
  const canImport =
    items.length > 0 && !hasErrors(parseIssues) && !issues.some(isStructural);
  const model = await getScoringModel(db, ctx);
  return { items, issues, canImport, model };
}

export async function previewImportAction(
  source: string,
): Promise<ImportPreview> {
  const db = getDb();
  const ctx = await getContext();
  const { items, issues, canImport, model } = await parseImport(
    db,
    ctx,
    source,
  );
  const base = model?.versions.findLast((v) => v.status === "published");
  return {
    total: items.length,
    statements: STATEMENTS.map(({ value }) => {
      const list = items.filter((item) => item.statement === value);
      return {
        statement: value,
        items: list.length,
        subtotals: list.filter((item) => item.kind === "subtotal").length,
      };
    }).filter((s) => s.items > 0),
    issues,
    diff: base
      ? {
          against: base.number,
          ...diffItems(await listItems(db, ctx, base.id), items),
        }
      : null,
    canImport,
  };
}

// Replaces the draft's items with the imported list, opening a draft first if
// there isn't one, and shows the draft.
export async function importAction(source: string): Promise<ActionResult> {
  return runAndShow(async (db, ctx) => {
    const { items, issues, canImport, model } = await parseImport(
      db,
      ctx,
      source,
    );
    if (!canImport) {
      throw new DomainError(
        "invalid",
        "The list has errors to fix first.",
        issues.filter((i) => i.severity === "error"),
      );
    }
    if (!model)
      throw new DomainError("not_found", "Create the scoring model first.");
    const draft =
      model.versions.find((v) => v.status === "draft") ??
      (await createDraft(db, ctx));
    await replaceItems(db, ctx, draft.id, items);
    return draft.number;
  });
}
