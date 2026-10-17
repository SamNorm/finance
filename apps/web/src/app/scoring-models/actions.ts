"use server";

import type { Db } from "@finance/db";
import {
  addItem,
  createDraft,
  createScoringModel,
  deleteScoringModel,
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
  setFinancingItems,
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

const page = (modelId: string, version?: number | null) =>
  `/scoring-models/${modelId}${version ? `?v=${version}` : ""}`;

// Runs a change, then navigates to the version it returns. Navigating from the
// server keeps the change and the new page in one response; a refresh followed
// by a client-side push can race and lose the navigation.
async function runAndShow(
  modelId: string,
  work: (db: Db, ctx: Context) => Promise<number | null>,
): Promise<ActionResult> {
  const result = await attempt(work);
  if (!result.ok) return result;
  redirect(page(modelId, result.value));
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

const SOURCES = { mirrored: "", native: "" };

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

function readModel(form: FormData) {
  const source = choice(form, "source", SOURCES);
  return {
    name: text(form, "name"),
    source,
    sourceSystem:
      source === "mirrored" ? text(form, "sourceSystem") || null : null,
    description: text(form, "description") || null,
  };
}

export async function createModelAction(form: FormData): Promise<ActionResult> {
  const result = await attempt((db, ctx) =>
    createScoringModel(db, ctx, readModel(form)),
  );
  if (!result.ok) return result;
  redirect(page(result.value.model.id));
}

export async function updateModelAction(
  modelId: string,
  form: FormData,
): Promise<ActionResult> {
  return run((db, ctx) =>
    updateScoringModel(db, ctx, modelId, readModel(form)),
  );
}

export async function deleteModelAction(
  modelId: string,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) =>
    deleteScoringModel(db, ctx, modelId),
  );
  if (!result.ok) return result;
  redirect("/scoring-models");
}

// Where a project's new loans post on the balance sheet.
export async function setFinancingItemsAction(
  modelId: string,
  items: { longTermDebt: string; currentDebt: string; cash: string },
): Promise<ActionResult> {
  return run((db, ctx) =>
    setFinancingItems(db, ctx, modelId, {
      longTermDebt: String(items.longTermDebt ?? ""),
      currentDebt: String(items.currentDebt ?? ""),
      cash: String(items.cash ?? ""),
    }),
  );
}

// Turns a model between mirroring a scoring system and being the
// organization's own input sheet. Only the label and wording change; the
// items stay.
export async function setScoringModelSourceAction(
  modelId: string,
  source: "mirrored" | "native",
): Promise<ActionResult> {
  return run(async (db, ctx) => {
    if (source !== "mirrored" && source !== "native") {
      throw invalid(`"${source}" isn't a valid source.`);
    }
    await updateScoringModel(db, ctx, modelId, { source });
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
export async function createDraftAction(
  modelId: string,
): Promise<ActionResult> {
  return runAndShow(
    modelId,
    async (db, ctx) => (await createDraft(db, ctx, modelId)).number,
  );
}

export async function discardDraftAction(
  modelId: string,
  versionId: string,
): Promise<ActionResult> {
  return runAndShow(modelId, async (db, ctx) => {
    await discardDraft(db, ctx, versionId);
    return null;
  });
}

async function parseImport(
  db: Db,
  ctx: Context,
  modelId: string,
  source: string,
) {
  const { items, issues: parseIssues, rowByCode } = parseItemTable(source);
  const issues = [...parseIssues, ...validateItems(items)].map((issue) => ({
    ...issue,
    row:
      issue.row ?? (issue.itemCode ? rowByCode.get(issue.itemCode) : undefined),
  }));
  const canImport =
    items.length > 0 && !hasErrors(parseIssues) && !issues.some(isStructural);
  const model = await getScoringModel(db, ctx, modelId);
  return { items, issues, canImport, model };
}

export async function previewImportAction(
  modelId: string,
  source: string,
): Promise<ImportPreview> {
  const db = getDb();
  const ctx = await getContext();
  const { items, issues, canImport, model } = await parseImport(
    db,
    ctx,
    modelId,
    source,
  );
  const base = model.versions.findLast((v) => v.status === "published");
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
export async function importAction(
  modelId: string,
  source: string,
): Promise<ActionResult> {
  return runAndShow(modelId, async (db, ctx) => {
    const { items, issues, canImport, model } = await parseImport(
      db,
      ctx,
      modelId,
      source,
    );
    if (!canImport) {
      throw new DomainError(
        "invalid",
        "The list has errors to fix first.",
        issues.filter((i) => i.severity === "error"),
      );
    }
    const draft =
      model.versions.find((v) => v.status === "draft") ??
      (await createDraft(db, ctx, model.id));
    await replaceItems(db, ctx, draft.id, items);
    return draft.number;
  });
}
