import { and, asc, desc, eq, schema, type Db } from "@finance/db";
import type { Context } from "../context";
import { DomainError, hasErrors, type Issue } from "../errors";
import * as edit from "./edit";
import type { ScoringItem, ScoringModel, ScoringModelVersion } from "./types";
import { isStructural, validateItems } from "./validate";

// Scoring model lifecycle (§5.2): one model per organization, edited through a
// single draft version, frozen on publish. A new draft starts as a copy of the
// latest published version.

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

export async function getScoringModel(
  db: Db,
  ctx: Context,
): Promise<ScoringModelWithVersions | null> {
  const [model] = await db
    .select()
    .from(scoringModels)
    .where(eq(scoringModels.organizationId, ctx.organizationId));
  if (!model) return null;
  const list = await db
    .select()
    .from(versions)
    .where(eq(versions.scoringModelId, model.id))
    .orderBy(asc(versions.number));
  return { ...model, versions: list };
}

// The version spreads are entered against and new financial models bind to.
export async function getLatestPublishedVersion(
  db: Db,
  ctx: Context,
): Promise<ScoringModelVersion | null> {
  const [row] = await db
    .select({ version: versions })
    .from(versions)
    .innerJoin(scoringModels, eq(scoringModels.id, versions.scoringModelId))
    .where(
      and(
        eq(scoringModels.organizationId, ctx.organizationId),
        eq(versions.status, "published"),
      ),
    )
    .orderBy(desc(versions.number))
    .limit(1);
  return row?.version ?? null;
}

// Creates the model with an empty draft v1.
export async function createScoringModel(
  db: Db,
  ctx: Context,
  input: ScoringModelInput,
): Promise<{ model: ScoringModel; draft: ScoringModelVersion }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: scoringModels.id })
      .from(scoringModels)
      .where(eq(scoringModels.organizationId, ctx.organizationId));
    if (existing)
      throw new DomainError(
        "conflict",
        "This organization already has a scoring model.",
      );
    const [model] = await tx
      .insert(scoringModels)
      .values({
        organizationId: ctx.organizationId,
        name: input.name,
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
  patch: Partial<ScoringModelInput>,
): Promise<ScoringModel> {
  const [model] = await db
    .update(scoringModels)
    .set({
      name: patch.name,
      source: patch.source,
      sourceSystem: patch.sourceSystem,
      description: patch.description,
    })
    .where(eq(scoringModels.organizationId, ctx.organizationId))
    .returning();
  if (!model)
    throw new DomainError(
      "not_found",
      "This organization has no scoring model.",
    );
  return model;
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
  notes?: string,
): Promise<ScoringModelVersion> {
  return db.transaction(async (tx) => {
    const [model] = await tx
      .select()
      .from(scoringModels)
      .where(eq(scoringModels.organizationId, ctx.organizationId))
      .for("update");
    if (!model)
      throw new DomainError(
        "not_found",
        "This organization has no scoring model.",
      );
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
