import { and, asc, desc, eq, inArray, schema, type Db } from "@finance/db";
import type { Context } from "../context";
import { DomainError, hasErrors, type Issue } from "../errors";
import { balanceSheetSides, type FinancingItems } from "../financing/financing";
import type { CheckItems } from "../spreads/checks";
import * as edit from "./edit";
import type { ScoringItem, ScoringModel, ScoringModelVersion } from "./types";
import { isStructural, validateItems } from "./validate";

// Scoring model lifecycle (§5.2): an organization keeps one or more scoring
// models (say, commercial and real estate); each borrower uses one. A model is
// edited through a single draft version, frozen on publish, and a new draft
// starts as a copy of the latest published version.

const {
  scoringModels,
  scoringModelVersions: versions,
  scoringModelItems: items,
} = schema;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSERT_BATCH = 1000;

const EMPTY: Issue = {
  severity: "error",
  code: "version_empty",
  message: "The version has no items.",
};

export interface ScoringModelWithVersions extends ScoringModel {
  versions: ScoringModelVersion[];
}

export type ScoringModelInput = Pick<
  typeof scoringModels.$inferInsert,
  "name" | "source" | "sourceSystem" | "description"
>;

async function versionsOf(db: Db, modelIds: string[]) {
  if (!modelIds.length) return [];
  return db
    .select()
    .from(versions)
    .where(inArray(versions.scoringModelId, modelIds))
    .orderBy(asc(versions.number));
}

export async function listScoringModels(
  db: Db,
  ctx: Context,
): Promise<ScoringModelWithVersions[]> {
  const models = await db
    .select()
    .from(scoringModels)
    .where(eq(scoringModels.organizationId, ctx.organizationId))
    .orderBy(asc(scoringModels.name));
  const all = await versionsOf(
    db,
    models.map((m) => m.id),
  );
  return models.map((model) => ({
    ...model,
    versions: all.filter((v) => v.scoringModelId === model.id),
  }));
}

export async function getScoringModel(
  db: Db,
  ctx: Context,
  modelId: string,
): Promise<ScoringModelWithVersions> {
  const model = await findModel(db, ctx, modelId);
  return { ...model, versions: await versionsOf(db, [model.id]) };
}

async function findModel(
  db: Db,
  ctx: Context,
  modelId: string,
  forUpdate = false,
) {
  if (!UUID.test(modelId))
    throw new DomainError("not_found", "No such scoring model.");
  const query = db
    .select()
    .from(scoringModels)
    .where(
      and(
        eq(scoringModels.id, modelId),
        eq(scoringModels.organizationId, ctx.organizationId),
      ),
    );
  const [model] = forUpdate ? await query.for("update") : await query;
  if (!model) throw new DomainError("not_found", "No such scoring model.");
  return model;
}

// The version a borrower's new periods are entered against and new financial
// models bind to.
export async function getLatestPublishedVersion(
  db: Db,
  ctx: Context,
  modelId: string,
): Promise<ScoringModelVersion | null> {
  return (await listPublishedVersions(db, ctx, modelId))[0] ?? null;
}

// Newest first: the versions of a model that spreads and financial models can
// bind to.
export async function listPublishedVersions(
  db: Db,
  ctx: Context,
  modelId: string,
): Promise<ScoringModelVersion[]> {
  await findModel(db, ctx, modelId);
  return db
    .select()
    .from(versions)
    .where(
      and(
        eq(versions.scoringModelId, modelId),
        eq(versions.status, "published"),
      ),
    )
    .orderBy(desc(versions.number));
}

// Creates a model with an empty draft v1.
export async function createScoringModel(
  db: Db,
  ctx: Context,
  input: ScoringModelInput,
): Promise<{ model: ScoringModel; draft: ScoringModelVersion }> {
  const name = input.name.trim();
  if (!name) throw new DomainError("invalid", "Give the scoring model a name.");
  return db.transaction(async (tx) => {
    const [model] = await tx
      .insert(scoringModels)
      .values({
        organizationId: ctx.organizationId,
        name,
        source: input.source,
        sourceSystem: input.sourceSystem,
        description: input.description,
      })
      .returning();
    const [draft] = await tx
      .insert(versions)
      .values({ scoringModelId: model!.id, number: 1 })
      .returning();
    return { model: model!, draft: draft! };
  });
}

export async function updateScoringModel(
  db: Db,
  ctx: Context,
  modelId: string,
  patch: Partial<ScoringModelInput>,
): Promise<ScoringModel> {
  await findModel(db, ctx, modelId);
  if (patch.name !== undefined && !patch.name.trim()) {
    throw new DomainError("invalid", "Give the scoring model a name.");
  }
  const [model] = await db
    .update(scoringModels)
    .set({
      name: patch.name?.trim(),
      source: patch.source,
      sourceSystem: patch.sourceSystem,
      description: patch.description,
    })
    .where(eq(scoringModels.id, modelId))
    .returning();
  return model!;
}

// Where a project's new loans post: two liability items (long-term debt and
// its current portion) and the cash their repayments come out of. Checked
// against the latest published version.
export async function setFinancingItems(
  db: Db,
  ctx: Context,
  modelId: string,
  input: Partial<Record<keyof FinancingItems, string | null>>,
): Promise<ScoringModel> {
  await findModel(db, ctx, modelId);
  const version = await getLatestPublishedVersion(db, ctx, modelId);
  if (!version)
    throw new DomainError("conflict", "Publish the scoring model first.");
  const sides = balanceSheetSides(await listItems(db, ctx, version.id));
  const pick = (
    raw: string | null | undefined,
    side: "assets" | "claims",
    what: string,
  ) => {
    const code = raw?.trim() || null;
    if (code && sides.get(code) !== side)
      throw new DomainError(
        "invalid",
        `${what} must be ${side === "assets" ? "an asset" : "a liability"} amount on the balance sheet.`,
      );
    return code;
  };
  const [model] = await db
    .update(scoringModels)
    .set({
      financingItems: {
        longTermDebt: pick(input.longTermDebt, "claims", "Long-term debt"),
        currentDebt: pick(input.currentDebt, "claims", "The current portion"),
        cash: pick(input.cash, "assets", "Cash"),
      },
    })
    .where(eq(scoringModels.id, modelId))
    .returning();
  return model!;
}

// The items the spread's statement checks read: net income, an amount on the
// income statement, and retained earnings, one on the balance sheet. Checked
// against the latest published version; a blank turns that check off.
export async function setCheckItems(
  db: Db,
  ctx: Context,
  modelId: string,
  input: Partial<Record<keyof CheckItems, string | null>>,
): Promise<ScoringModel> {
  const current = await findModel(db, ctx, modelId);
  const version = await getLatestPublishedVersion(db, ctx, modelId);
  if (!version)
    throw new DomainError("conflict", "Publish the scoring model first.");
  const items = await listItems(db, ctx, version.id);
  const pick = (
    raw: string | null | undefined,
    statement: ScoringItem["statement"],
    what: string,
  ) => {
    const code = raw?.trim() || null;
    const item = code && items.find((i) => i.code === code);
    if (
      code &&
      (!item || item.statement !== statement || item.dataType !== "amount")
    )
      throw new DomainError(
        "invalid",
        `${what} must be an amount on the ${statement === "income_statement" ? "income statement" : "balance sheet"}.`,
      );
    return code;
  };
  // The authorized line is an amount on any statement, often supplementary.
  const authorizedLine = (raw: string | null) => {
    const code = raw?.trim() || null;
    const item = code && items.find((i) => i.code === code);
    if (code && (!item || item.kind !== "input" || item.dataType !== "amount"))
      throw new DomainError(
        "invalid",
        "The authorized line of credit must be an amount entered in the spread.",
      );
    return code;
  };
  const [model] = await db
    .update(scoringModels)
    .set({
      checkItems: {
        netIncome: pick(input.netIncome, "income_statement", "Net income"),
        retainedEarnings: pick(
          input.retainedEarnings,
          "balance_sheet",
          "Retained earnings",
        ),
        // Kept when not given: models set before it don't send it.
        lineAuthorized:
          input.lineAuthorized === undefined
            ? (current.checkItems.lineAuthorized ?? null)
            : authorizedLine(input.lineAuthorized),
      },
    })
    .where(eq(scoringModels.id, modelId))
    .returning();
  return model!;
}

// Refused while borrowers or financial models use the model.
export async function deleteScoringModel(
  db: Db,
  ctx: Context,
  modelId: string,
): Promise<void> {
  const model = await findModel(db, ctx, modelId);
  const [borrower] = await db
    .select({ id: schema.entities.id })
    .from(schema.entities)
    .where(eq(schema.entities.scoringModelId, model.id))
    .limit(1);
  if (borrower)
    throw new DomainError("conflict", "Borrowers use this scoring model.");
  const [financial] = await db
    .select({ id: schema.financialModelVersions.id })
    .from(schema.financialModelVersions)
    .innerJoin(
      versions,
      eq(versions.id, schema.financialModelVersions.scoringModelVersionId),
    )
    .where(eq(versions.scoringModelId, model.id))
    .limit(1);
  if (financial)
    throw new DomainError(
      "conflict",
      "Financial models are built on this scoring model.",
    );
  await db.delete(scoringModels).where(eq(scoringModels.id, model.id));
}

export async function getVersion(
  db: Db,
  ctx: Context,
  versionId: string,
): Promise<ScoringModelVersion> {
  return findVersion(db, ctx, versionId);
}

export async function listItems(
  db: Db,
  ctx: Context,
  versionId: string,
): Promise<ScoringItem[]> {
  await findVersion(db, ctx, versionId);
  return selectItems(db, versionId);
}

export async function validateVersion(
  db: Db,
  ctx: Context,
  versionId: string,
): Promise<Issue[]> {
  const list = await listItems(db, ctx, versionId);
  return list.length ? validateItems(list) : [EMPTY];
}

// Draft edits. Each one saves unless it breaks codes or the tree, and returns
// every remaining issue; errors among them must be fixed before publishing.

export function replaceItems(
  db: Db,
  ctx: Context,
  versionId: string,
  list: readonly ScoringItem[],
): Promise<Issue[]> {
  return editDraft(db, ctx, versionId, () => [...list]);
}

export function addItem(
  db: Db,
  ctx: Context,
  versionId: string,
  item: edit.NewScoringItem,
  position?: number,
): Promise<Issue[]> {
  return editDraft(db, ctx, versionId, (list) =>
    edit.insertItem(list, item, position),
  );
}

export function updateItem(
  db: Db,
  ctx: Context,
  versionId: string,
  code: string,
  patch: edit.ItemPatch,
): Promise<Issue[]> {
  return editDraft(db, ctx, versionId, (list) =>
    edit.updateItem(list, code, patch),
  );
}

export function moveItem(
  db: Db,
  ctx: Context,
  versionId: string,
  code: string,
  position: number,
): Promise<Issue[]> {
  return editDraft(db, ctx, versionId, (list) =>
    edit.moveItem(list, code, position),
  );
}

export function removeItem(
  db: Db,
  ctx: Context,
  versionId: string,
  code: string,
): Promise<Issue[]> {
  return editDraft(db, ctx, versionId, (list) => edit.removeItem(list, code));
}

export async function publishVersion(
  db: Db,
  ctx: Context,
  versionId: string,
  notes?: string,
): Promise<ScoringModelVersion> {
  return db.transaction(async (tx) => {
    const version = await findVersion(tx, ctx, versionId, true);
    assertDraft(version);
    const list = await selectItems(tx, versionId);
    const issues = list.length ? validateItems(list) : [EMPTY];
    if (hasErrors(issues)) {
      throw new DomainError(
        "invalid",
        `Version ${version.number} has errors and can't be published.`,
        issues.filter((issue) => issue.severity === "error"),
      );
    }
    const [published] = await tx
      .update(versions)
      .set({
        status: "published",
        publishedAt: new Date(),
        notes: notes ?? version.notes,
      })
      .where(eq(versions.id, versionId))
      .returning();
    return published!;
  });
}

// Opens the next version as a draft, copied from the latest published one.
export async function createDraft(
  db: Db,
  ctx: Context,
  modelId: string,
  notes?: string,
): Promise<ScoringModelVersion> {
  return db.transaction(async (tx) => {
    const model = await findModel(tx, ctx, modelId, true);
    const all = await tx
      .select()
      .from(versions)
      .where(eq(versions.scoringModelId, model.id))
      .orderBy(desc(versions.number));
    const open = all.find((version) => version.status === "draft");
    if (open) {
      throw new DomainError(
        "conflict",
        `Version ${open.number} is already a draft. Publish or discard it first.`,
      );
    }
    const [draft] = await tx
      .insert(versions)
      .values({
        scoringModelId: model.id,
        number: (all[0]?.number ?? 0) + 1,
        notes,
      })
      .returning();
    const base =
      all.find((version) => version.status === "published") ?? all[0];
    if (base) await writeItems(tx, draft!.id, await selectItems(tx, base.id));
    return draft!;
  });
}

export async function discardDraft(
  db: Db,
  ctx: Context,
  versionId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    assertDraft(await findVersion(tx, ctx, versionId, true));
    await tx.delete(versions).where(eq(versions.id, versionId));
  });
}

async function editDraft(
  db: Db,
  ctx: Context,
  versionId: string,
  change: (list: ScoringItem[]) => ScoringItem[],
): Promise<Issue[]> {
  return db.transaction(async (tx) => {
    assertDraft(await findVersion(tx, ctx, versionId, true));
    const list = change(await selectItems(tx, versionId));
    const issues = validateItems(list);
    const blocking = issues.filter(isStructural);
    if (blocking.length)
      throw new DomainError("invalid", "The items can't be saved.", blocking);
    await writeItems(tx, versionId, list);
    await tx
      .update(versions)
      .set({ updatedAt: new Date() })
      .where(eq(versions.id, versionId));
    return issues;
  });
}

async function findVersion(
  db: Db,
  ctx: Context,
  versionId: string,
  forUpdate = false,
) {
  if (!UUID.test(versionId))
    throw new DomainError("not_found", `No version ${versionId}.`);
  const query = db
    .select({ version: versions })
    .from(versions)
    .innerJoin(scoringModels, eq(scoringModels.id, versions.scoringModelId))
    .where(
      and(
        eq(versions.id, versionId),
        eq(scoringModels.organizationId, ctx.organizationId),
      ),
    );
  const [row] = forUpdate
    ? await query.for("update", { of: versions })
    : await query;
  if (!row) throw new DomainError("not_found", `No version ${versionId}.`);
  return row.version;
}

function assertDraft(version: ScoringModelVersion) {
  if (version.status !== "draft") {
    throw new DomainError(
      "conflict",
      `Version ${version.number} is ${version.status} and can't be changed. Create a draft instead.`,
    );
  }
}

async function selectItems(db: Db, versionId: string): Promise<ScoringItem[]> {
  const rows = await db
    .select()
    .from(items)
    .where(eq(items.versionId, versionId))
    .orderBy(asc(items.position));
  return rows.map(
    ({ versionId: _versionId, position: _position, ...item }) => item,
  );
}

// Replaces a version's items. Parents go in before their children so the
// self-referencing foreign key holds across insert batches.
async function writeItems(
  db: Db,
  versionId: string,
  list: readonly ScoringItem[],
) {
  await db.delete(items).where(eq(items.versionId, versionId));
  const parentOf = new Map(list.map((item) => [item.code, item.parentCode]));
  const depth = new Map<string, number>();
  const depthOf = (code: string): number => {
    let known = depth.get(code);
    if (known === undefined) {
      const parent = parentOf.get(code);
      known = parent ? depthOf(parent) + 1 : 0;
      depth.set(code, known);
    }
    return known;
  };
  const rows = list
    .map((item, position) => ({ ...item, versionId, position }))
    .sort((a, b) => depthOf(a.code) - depthOf(b.code));
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    await db.insert(items).values(rows.slice(i, i + INSERT_BATCH));
  }
}
