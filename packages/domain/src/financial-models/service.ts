import { and, asc, desc, eq, inArray, schema, type Db } from "@finance/db";
import type { Context } from "../context";
import { DomainError, hasErrors, type Issue } from "../errors";
import { FINANCING_CODES } from "../financing/financing";
import {
  getLatestPublishedVersion,
  getVersion as getScoringVersion,
  listItems,
} from "../scoring-models/service";
import * as edit from "./edit";
import type { FinancialModel, FinancialModelVersion, ModelLine } from "./types";
import {
  isStructuralLineIssue,
  normalizeAssumption,
  validateLines,
} from "./validate";

// Financial models (§5.3–5.4): one draft at a time, frozen on publish, each
// version bound to a scoring model version. A variant is a duplicate with its
// own history.

const {
  financialModels: models,
  financialModelVersions: versions,
  financialModelLines: lines,
} = schema;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY: Issue = {
  severity: "error",
  code: "version_empty",
  message: "The version has no lines.",
};

export interface FinancialModelSummary extends FinancialModel {
  versions: FinancialModelVersion[];
  // The scoring model its latest version is built on.
  scoringModel: { id: string; name: string };
}

export interface FinancialModelDetail extends FinancialModelSummary {
  variantOf: { id: string; name: string } | null;
  variants: { id: string; name: string }[];
}

export type FinancialModelInput = { name: string; description?: string | null };

export async function listFinancialModels(
  db: Db,
  ctx: Context,
): Promise<FinancialModelSummary[]> {
  const list = await db
    .select()
    .from(models)
    .where(eq(models.organizationId, ctx.organizationId))
    .orderBy(asc(models.name));
  if (!list.length) return [];
  const all = await db
    .select()
    .from(versions)
    .where(
      inArray(
        versions.financialModelId,
        list.map((m) => m.id),
      ),
    )
    .orderBy(asc(versions.number));
  const bindings = await scoringModelsOf(
    db,
    all.map((v) => v.scoringModelVersionId),
  );
  return list.map((model) => {
    const own = all.filter((v) => v.financialModelId === model.id);
    return {
      ...model,
      versions: own,
      scoringModel: bindings.get(own.at(-1)!.scoringModelVersionId)!,
    };
  });
}

// The scoring model of each scoring model version, by version id.
async function scoringModelsOf(db: Db, scoringVersionIds: string[]) {
  const ids = [...new Set(scoringVersionIds)];
  if (!ids.length) return new Map<string, { id: string; name: string }>();
  const rows = await db
    .select({
      versionId: schema.scoringModelVersions.id,
      id: schema.scoringModels.id,
      name: schema.scoringModels.name,
    })
    .from(schema.scoringModelVersions)
    .innerJoin(
      schema.scoringModels,
      eq(schema.scoringModels.id, schema.scoringModelVersions.scoringModelId),
    )
    .where(inArray(schema.scoringModelVersions.id, ids));
  return new Map(rows.map(({ versionId, ...model }) => [versionId, model]));
}

async function findModel(db: Db, ctx: Context, modelId: string) {
  if (!UUID.test(modelId))
    throw new DomainError("not_found", "No such financial model.");
  const [model] = await db
    .select()
    .from(models)
    .where(
      and(
        eq(models.id, modelId),
        eq(models.organizationId, ctx.organizationId),
      ),
    );
  if (!model) throw new DomainError("not_found", "No such financial model.");
  return model;
}

export async function getFinancialModel(
  db: Db,
  ctx: Context,
  modelId: string,
): Promise<FinancialModelDetail> {
  const model = await findModel(db, ctx, modelId);
  const [list, variants, parent] = await Promise.all([
    db
      .select()
      .from(versions)
      .where(eq(versions.financialModelId, model.id))
      .orderBy(asc(versions.number)),
    db
      .select({ id: models.id, name: models.name })
      .from(models)
      .where(
        and(
          eq(models.variantOfId, model.id),
          eq(models.organizationId, ctx.organizationId),
        ),
      )
      .orderBy(asc(models.name)),
    model.variantOfId
      ? db
          .select({ id: models.id, name: models.name })
          .from(models)
          .where(eq(models.id, model.variantOfId))
      : Promise.resolve([]),
  ]);
  const bindings = await scoringModelsOf(
    db,
    list.map((v) => v.scoringModelVersionId),
  );
  return {
    ...model,
    versions: list,
    scoringModel: bindings.get(list.at(-1)!.scoringModelVersionId)!,
    variantOf: parent[0] ?? null,
    variants,
  };
}

// The latest published version of a scoring model, which new versions bind to.
async function requireScoringVersion(
  db: Db,
  ctx: Context,
  scoringModelId: string,
) {
  const version = await getLatestPublishedVersion(db, ctx, scoringModelId);
  if (!version) {
    throw new DomainError(
      "conflict",
      "Publish the scoring model before building financial models on it.",
    );
  }
  return version;
}

// The scoring model a financial model's versions are built on.
async function boundScoringModel(
  db: Db,
  ctx: Context,
  version: FinancialModelVersion,
) {
  return (await getScoringVersion(db, ctx, version.scoringModelVersionId))
    .scoringModelId;
}

// Creates the model with an empty draft v1, bound to the latest published
// version of the chosen scoring model.
export async function createFinancialModel(
  db: Db,
  ctx: Context,
  input: FinancialModelInput & { scoringModelId: string },
): Promise<{ model: FinancialModel; draft: FinancialModelVersion }> {
  const name = input.name.trim();
  if (!name) throw new DomainError("invalid", "Give the model a name.");
  const scoring = await requireScoringVersion(db, ctx, input.scoringModelId);
  return db.transaction(async (tx) => {
    const [model] = await tx
      .insert(models)
      .values({
        organizationId: ctx.organizationId,
        name,
        description: input.description?.trim() || null,
      })
      .returning();
    const [draft] = await tx
      .insert(versions)
      .values({
        financialModelId: model!.id,
        number: 1,
        scoringModelVersionId: scoring.id,
      })
      .returning();
    return { model: model!, draft: draft! };
  });
}

export async function updateFinancialModel(
  db: Db,
  ctx: Context,
  modelId: string,
  patch: Partial<FinancialModelInput>,
): Promise<FinancialModel> {
  await findModel(db, ctx, modelId);
  if (patch.name !== undefined && !patch.name.trim())
    throw new DomainError("invalid", "Give the model a name.");
  const [model] = await db
    .update(models)
    .set({
      name: patch.name?.trim(),
      description:
        patch.description === undefined
          ? undefined
          : patch.description?.trim() || null,
    })
    .where(eq(models.id, modelId))
    .returning();
  return model!;
}

// A variant: a separate model with its own history, starting from the source's
// latest published version (or its draft, if nothing is published yet).
export async function duplicateFinancialModel(
  db: Db,
  ctx: Context,
  modelId: string,
  input: FinancialModelInput,
): Promise<{ model: FinancialModel; draft: FinancialModelVersion }> {
  const source = await getFinancialModel(db, ctx, modelId);
  const base =
    source.versions.findLast((v) => v.status === "published") ??
    source.versions.at(-1);
  const name = input.name.trim();
  if (!name) throw new DomainError("invalid", "Give the variant a name.");
  const scoring = await requireScoringVersion(db, ctx, source.scoringModel.id);
  return db.transaction(async (tx) => {
    const [model] = await tx
      .insert(models)
      .values({
        organizationId: ctx.organizationId,
        name,
        description: input.description?.trim() || source.description,
        variantOfId: source.id,
      })
      .returning();
    const [draft] = await tx
      .insert(versions)
      .values({
        financialModelId: model!.id,
        number: 1,
        scoringModelVersionId: scoring.id,
      })
      .returning();
    if (base) await writeLines(tx, draft!.id, await selectLines(tx, base.id));
    return { model: model!, draft: draft! };
  });
}

export async function deleteFinancialModel(
  db: Db,
  ctx: Context,
  modelId: string,
): Promise<void> {
  await findModel(db, ctx, modelId);
  // Analyses pin published versions; deleting the model would break them.
  const [used] = await db
    .select({ id: schema.analyses.id })
    .from(schema.analyses)
    .innerJoin(
      versions,
      eq(versions.id, schema.analyses.financialModelVersionId),
    )
    .where(eq(versions.financialModelId, modelId))
    .limit(1);
  if (used) {
    throw new DomainError(
      "conflict",
      "Analyses use this model. Delete them first.",
    );
  }
  await db.delete(models).where(eq(models.id, modelId));
}

export async function getFinancialModelVersion(
  db: Db,
  ctx: Context,
  versionId: string,
): Promise<FinancialModelVersion> {
  return findVersion(db, ctx, versionId);
}

export async function listLines(
  db: Db,
  ctx: Context,
  versionId: string,
): Promise<ModelLine[]> {
  await findVersion(db, ctx, versionId);
  return selectLines(db, versionId);
}

// Codes a version's formulas can read: every item of its scoring model
// version that holds a figure, and the built-in financing inputs.
export async function inputCodesFor(
  db: Db,
  ctx: Context,
  version: FinancialModelVersion,
) {
  const items = await listItems(db, ctx, version.scoringModelVersionId);
  return [
    ...items.filter((item) => item.kind !== "header").map((item) => item.code),
    ...FINANCING_CODES,
  ];
}

export async function validateFinancialModelVersion(
  db: Db,
  ctx: Context,
  versionId: string,
): Promise<Issue[]> {
  const version = await findVersion(db, ctx, versionId);
  const list = await selectLines(db, versionId);
  if (!list.length) return [EMPTY];
  return validateLines(list, await inputCodesFor(db, ctx, version));
}

// Draft edits. Each saves unless it breaks codes or labels, and returns every
// remaining issue; errors among them block publishing.

export function replaceLines(
  db: Db,
  ctx: Context,
  versionId: string,
  list: readonly ModelLine[],
) {
  return editDraft(db, ctx, versionId, () => [...list]);
}

export function addLine(
  db: Db,
  ctx: Context,
  versionId: string,
  line: edit.NewModelLine,
  position?: number,
) {
  return editDraft(db, ctx, versionId, (list) =>
    edit.insertLine(list, line, position),
  );
}

export function updateLine(
  db: Db,
  ctx: Context,
  versionId: string,
  code: string,
  patch: edit.LinePatch,
) {
  return editDraft(db, ctx, versionId, (list) =>
    edit.updateLine(list, code, patch),
  );
}

export function moveLine(
  db: Db,
  ctx: Context,
  versionId: string,
  code: string,
  position: number,
) {
  return editDraft(db, ctx, versionId, (list) =>
    edit.moveLine(list, code, position),
  );
}

export function removeLine(
  db: Db,
  ctx: Context,
  versionId: string,
  code: string,
) {
  return editDraft(db, ctx, versionId, (list) => edit.removeLine(list, code));
}

// Binds a draft to another published scoring model version.
export async function setScoringVersion(
  db: Db,
  ctx: Context,
  versionId: string,
  scoringModelVersionId: string,
): Promise<Issue[]> {
  const scoring = await getScoringVersion(db, ctx, scoringModelVersionId);
  if (scoring.status !== "published") {
    throw new DomainError(
      "invalid",
      "Bind the model to a published scoring model version.",
    );
  }
  await db.transaction(async (tx) => {
    const version = await findVersion(tx, ctx, versionId, true);
    assertDraft(version);
    if (
      (await boundScoringModel(tx, ctx, version)) !== scoring.scoringModelId
    ) {
      throw new DomainError(
        "invalid",
        "A financial model stays on its scoring model; pick one of that model's versions.",
      );
    }
    await tx
      .update(versions)
      .set({ scoringModelVersionId: scoring.id })
      .where(eq(versions.id, versionId));
  });
  return validateFinancialModelVersion(db, ctx, versionId);
}

export async function publishFinancialModelVersion(
  db: Db,
  ctx: Context,
  versionId: string,
  notes?: string,
): Promise<FinancialModelVersion> {
  return db.transaction(async (tx) => {
    const version = await findVersion(tx, ctx, versionId, true);
    assertDraft(version);
    const list = await selectLines(tx, versionId);
    const issues = list.length
      ? validateLines(list, await inputCodesFor(tx, ctx, version))
      : [EMPTY];
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

// Opens the next version as a draft: a copy of the latest published one,
// bound to the latest published version of the same scoring model.
export async function createFinancialModelDraft(
  db: Db,
  ctx: Context,
  modelId: string,
): Promise<FinancialModelVersion> {
  const current = await getFinancialModel(db, ctx, modelId);
  const scoring = await requireScoringVersion(db, ctx, current.scoringModel.id);
  return db.transaction(async (tx) => {
    const [model] = await tx
      .select()
      .from(models)
      .where(
        and(
          eq(models.id, modelId),
          eq(models.organizationId, ctx.organizationId),
        ),
      )
      .for("update");
    if (!model) throw new DomainError("not_found", "No such financial model.");
    const all = await tx
      .select()
      .from(versions)
      .where(eq(versions.financialModelId, model.id))
      .orderBy(desc(versions.number));
    const open = all.find((v) => v.status === "draft");
    if (open) {
      throw new DomainError(
        "conflict",
        `Version ${open.number} is already a draft. Publish or discard it first.`,
      );
    }
    const [draft] = await tx
      .insert(versions)
      .values({
        financialModelId: model.id,
        number: (all[0]?.number ?? 0) + 1,
        scoringModelVersionId: scoring.id,
      })
      .returning();
    const base = all.find((v) => v.status === "published") ?? all[0];
    if (base) await writeLines(tx, draft!.id, await selectLines(tx, base.id));
    return draft!;
  });
}

export async function discardFinancialModelDraft(
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
  change: (list: ModelLine[]) => ModelLine[],
): Promise<Issue[]> {
  return db.transaction(async (tx) => {
    const version = await findVersion(tx, ctx, versionId, true);
    assertDraft(version);
    const list = change(await selectLines(tx, versionId)).map(normalizeLine);
    const issues = validateLines(list, await inputCodesFor(tx, ctx, version));
    const blocking = issues.filter(isStructuralLineIssue);
    if (blocking.length)
      throw new DomainError("invalid", "The lines can't be saved.", blocking);
    await writeLines(tx, versionId, list);
    await tx
      .update(versions)
      .set({ updatedAt: new Date() })
      .where(eq(versions.id, versionId));
    return issues;
  });
}

// Stores only what each kind of line uses, with assumption values canonical.
function normalizeLine(line: ModelLine): ModelLine {
  const blank = (s: string | null) => (s?.trim() ? s.trim() : null);
  if (line.kind === "header") {
    return {
      ...line,
      formula: null,
      projectionFormula: null,
      defaultValue: null,
      breaksDown: null,
    };
  }
  if (line.kind === "calculation") {
    return {
      ...line,
      formula: blank(line.formula),
      projectionFormula: blank(line.projectionFormula),
      defaultValue: null,
      breaksDown: null,
    };
  }
  if (line.kind === "input") {
    return {
      ...line,
      formula: null,
      projectionFormula: blank(line.projectionFormula),
      defaultValue: null,
      breaksDown: blank(line.breaksDown),
    };
  }
  const parsed =
    line.defaultValue === null
      ? { value: null }
      : normalizeAssumption(line.defaultValue, line.format);
  return {
    ...line,
    formula: null,
    projectionFormula: null,
    breaksDown: null,
    // An unreadable value is kept as typed; validation reports it.
    defaultValue: "value" in parsed ? parsed.value : line.defaultValue,
  };
}

async function findVersion(
  db: Db,
  ctx: Context,
  versionId: string,
  forUpdate = false,
) {
  if (!UUID.test(versionId))
    throw new DomainError("not_found", "No such version.");
  const query = db
    .select({ version: versions })
    .from(versions)
    .innerJoin(models, eq(models.id, versions.financialModelId))
    .where(
      and(
        eq(versions.id, versionId),
        eq(models.organizationId, ctx.organizationId),
      ),
    );
  const [row] = forUpdate
    ? await query.for("update", { of: versions })
    : await query;
  if (!row) throw new DomainError("not_found", "No such version.");
  return row.version;
}

function assertDraft(version: FinancialModelVersion) {
  if (version.status !== "draft") {
    throw new DomainError(
      "conflict",
      `Version ${version.number} is ${version.status} and can't be changed. Create a draft instead.`,
    );
  }
}

async function selectLines(db: Db, versionId: string): Promise<ModelLine[]> {
  const rows = await db
    .select()
    .from(lines)
    .where(eq(lines.versionId, versionId))
    .orderBy(asc(lines.position));
  return rows.map(
    ({ versionId: _versionId, position: _position, ...line }) => line,
  );
}

async function writeLines(
  db: Db,
  versionId: string,
  list: readonly ModelLine[],
) {
  await db.delete(lines).where(eq(lines.versionId, versionId));
  if (list.length) {
    await db
      .insert(lines)
      .values(list.map((line, position) => ({ ...line, versionId, position })));
  }
}
