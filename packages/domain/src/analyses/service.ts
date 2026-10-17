import { and, asc, desc, eq, inArray, schema, type Db } from "@finance/db";
import type { Context } from "../context";
import { DomainError } from "../errors";
import { listLines } from "../financial-models/service";
import type { ModelLine } from "../financial-models/types";
import { normalizeAssumption } from "../financial-models/validate";
import { listItems } from "../scoring-models/service";
import { isNumeric } from "../spreads/checks";
import { getEntity, getSpread } from "../spreads/service";
import { runModel, type AnalysisRun } from "./run";

// Analyses (§5.5): a borrower × a pinned financial model version × periods ×
// scenarios. Results are computed on demand from the pinned version, so an
// analysis reads the same after later versions are published.

const {
  analyses,
  analysisScenarios: scenarios,
  entities,
  financialModels: models,
  financialModelVersions: versions,
} = schema;

export type Analysis = typeof analyses.$inferSelect;
export type Scenario = typeof scenarios.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PROJECTION_YEARS = 10;

export interface AnalysisSummary extends Analysis {
  entityName: string;
  modelId: string;
  modelName: string;
  versionNumber: number;
}

const summaryColumns = {
  analysis: analyses,
  entityName: entities.name,
  modelId: models.id,
  modelName: models.name,
  versionNumber: versions.number,
};

export async function listAnalyses(
  db: Db,
  ctx: Context,
  filter: { entityId?: string } = {},
): Promise<AnalysisSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(analyses)
    .innerJoin(entities, eq(entities.id, analyses.entityId))
    .innerJoin(versions, eq(versions.id, analyses.financialModelVersionId))
    .innerJoin(models, eq(models.id, versions.financialModelId))
    .where(
      and(
        eq(analyses.organizationId, ctx.organizationId),
        filter.entityId && UUID.test(filter.entityId)
          ? eq(analyses.entityId, filter.entityId)
          : undefined,
      ),
    )
    .orderBy(desc(analyses.updatedAt));
  return rows.map(({ analysis, ...rest }) => ({ ...analysis, ...rest }));
}

async function findAnalysis(
  db: Db,
  ctx: Context,
  analysisId: string,
): Promise<Analysis> {
  if (!UUID.test(analysisId))
    throw new DomainError("not_found", "No such analysis.");
  const [analysis] = await db
    .select()
    .from(analyses)
    .where(
      and(
        eq(analyses.id, analysisId),
        eq(analyses.organizationId, ctx.organizationId),
      ),
    );
  if (!analysis) throw new DomainError("not_found", "No such analysis.");
  return analysis;
}

// The financial model version, checked to be published and the caller's.
async function publishedVersion(db: Db, ctx: Context, versionId: string) {
  if (!UUID.test(versionId))
    throw new DomainError("not_found", "No such model version.");
  const [row] = await db
    .select({ version: versions, model: models })
    .from(versions)
    .innerJoin(models, eq(models.id, versions.financialModelId))
    .where(
      and(
        eq(versions.id, versionId),
        eq(models.organizationId, ctx.organizationId),
      ),
    );
  if (!row) throw new DomainError("not_found", "No such model version.");
  if (row.version.status === "draft") {
    throw new DomainError(
      "invalid",
      "Analyses run on published model versions only.",
    );
  }
  return row;
}

function checkSettings(input: { name?: string; projectionYears?: number }) {
  if (input.name !== undefined && !input.name.trim()) {
    throw new DomainError("invalid", "Give the analysis a name.");
  }
  const years = input.projectionYears;
  if (
    years !== undefined &&
    (!Number.isInteger(years) || years < 0 || years > MAX_PROJECTION_YEARS)
  ) {
    throw new DomainError(
      "invalid",
      `Project 0 to ${MAX_PROJECTION_YEARS} years.`,
    );
  }
}

async function checkPeriods(db: Db, entityId: string, periodIds: string[]) {
  if (!periodIds.length) return;
  if (!periodIds.every((id) => UUID.test(id)))
    throw new DomainError("invalid", "Unknown period.");
  const found = await db
    .select({ id: schema.statementPeriods.id })
    .from(schema.statementPeriods)
    .where(
      and(
        eq(schema.statementPeriods.entityId, entityId),
        inArray(schema.statementPeriods.id, periodIds),
      ),
    );
  if (found.length !== new Set(periodIds).size) {
    throw new DomainError(
      "invalid",
      "Every period must belong to the analysis's borrower.",
    );
  }
}

export interface AnalysisInput {
  entityId: string;
  financialModelVersionId: string;
  name: string;
  periodIds?: string[];
  projectionYears?: number;
}

export async function createAnalysis(
  db: Db,
  ctx: Context,
  input: AnalysisInput,
): Promise<Analysis> {
  await getEntity(db, ctx, input.entityId);
  await publishedVersion(db, ctx, input.financialModelVersionId);
  checkSettings(input);
  const periodIds = [...new Set(input.periodIds ?? [])];
  await checkPeriods(db, input.entityId, periodIds);
  const [analysis] = await db
    .insert(analyses)
    .values({
      organizationId: ctx.organizationId,
      entityId: input.entityId,
      financialModelVersionId: input.financialModelVersionId,
      name: input.name.trim(),
      periodIds,
      projectionYears: input.projectionYears ?? 0,
    })
    .returning();
  return analysis!;
}

export async function updateAnalysis(
  db: Db,
  ctx: Context,
  analysisId: string,
  patch: { name?: string; periodIds?: string[]; projectionYears?: number },
): Promise<Analysis> {
  const analysis = await findAnalysis(db, ctx, analysisId);
  checkSettings(patch);
  const periodIds = patch.periodIds && [...new Set(patch.periodIds)];
  if (periodIds) await checkPeriods(db, analysis.entityId, periodIds);
  const [updated] = await db
    .update(analyses)
    .set({
      name: patch.name?.trim(),
      periodIds,
      projectionYears: patch.projectionYears,
    })
    .where(eq(analyses.id, analysisId))
    .returning();
  return updated!;
}

export async function deleteAnalysis(
  db: Db,
  ctx: Context,
  analysisId: string,
): Promise<void> {
  await findAnalysis(db, ctx, analysisId);
  await db.delete(analyses).where(eq(analyses.id, analysisId));
}

export interface AnalysisDetail {
  analysis: Analysis;
  entity: { id: string; name: string };
  model: { id: string; name: string };
  version: { id: string; number: number; scoringModelVersionId: string };
  // The model's latest published version, when newer than the pinned one.
  newerVersion: { id: string; number: number } | null;
  lines: ModelLine[];
  scenarios: Scenario[];
}

export async function getAnalysis(
  db: Db,
  ctx: Context,
  analysisId: string,
): Promise<AnalysisDetail> {
  const analysis = await findAnalysis(db, ctx, analysisId);
  const { version, model } = await publishedVersion(
    db,
    ctx,
    analysis.financialModelVersionId,
  );
  const entity = await getEntity(db, ctx, analysis.entityId);
  const [latest] = await db
    .select({ id: versions.id, number: versions.number })
    .from(versions)
    .where(
      and(
        eq(versions.financialModelId, model.id),
        eq(versions.status, "published"),
      ),
    )
    .orderBy(desc(versions.number))
    .limit(1);
  return {
    analysis,
    entity: { id: entity.id, name: entity.name },
    model: { id: model.id, name: model.name },
    version: {
      id: version.id,
      number: version.number,
      scoringModelVersionId: version.scoringModelVersionId,
    },
    newerVersion: latest && latest.number > version.number ? latest : null,
    lines: await listLines(db, ctx, version.id),
    scenarios: await db
      .select()
      .from(scenarios)
      .where(eq(scenarios.analysisId, analysis.id))
      .orderBy(asc(scenarios.position), asc(scenarios.createdAt)),
  };
}

// Overrides keep only the model's assumptions, in canonical form.
function normalizeOverrides(
  lines: readonly ModelLine[],
  overrides: Record<string, string>,
) {
  const result: Record<string, string> = {};
  for (const [code, raw] of Object.entries(overrides)) {
    const line = lines.find((l) => l.code === code && l.kind === "assumption");
    if (!line)
      throw new DomainError(
        "invalid",
        `"${code}" isn't an assumption of this model.`,
      );
    const parsed = normalizeAssumption(String(raw), line.format);
    if ("error" in parsed)
      throw new DomainError("invalid", `${line.label}: ${parsed.error}`);
    if (parsed.value !== null) result[code] = parsed.value;
  }
  return result;
}

export async function addScenario(
  db: Db,
  ctx: Context,
  analysisId: string,
  input: { name: string; overrides?: Record<string, string> },
): Promise<Scenario> {
  const detail = await getAnalysis(db, ctx, analysisId);
  if (!input.name.trim())
    throw new DomainError("invalid", "Give the scenario a name.");
  const [scenario] = await db
    .insert(scenarios)
    .values({
      analysisId,
      name: input.name.trim(),
      position: detail.scenarios.length,
      overrides: normalizeOverrides(detail.lines, input.overrides ?? {}),
    })
    .returning();
  await touch(db, analysisId);
  return scenario!;
}

async function findScenario(db: Db, ctx: Context, scenarioId: string) {
  if (!UUID.test(scenarioId))
    throw new DomainError("not_found", "No such scenario.");
  const [row] = await db
    .select({ scenario: scenarios })
    .from(scenarios)
    .innerJoin(analyses, eq(analyses.id, scenarios.analysisId))
    .where(
      and(
        eq(scenarios.id, scenarioId),
        eq(analyses.organizationId, ctx.organizationId),
      ),
    );
  if (!row) throw new DomainError("not_found", "No such scenario.");
  return row.scenario;
}

export async function updateScenario(
  db: Db,
  ctx: Context,
  scenarioId: string,
  patch: { name?: string; overrides?: Record<string, string> },
): Promise<Scenario> {
  const scenario = await findScenario(db, ctx, scenarioId);
  if (patch.name !== undefined && !patch.name.trim()) {
    throw new DomainError("invalid", "Give the scenario a name.");
  }
  const detail = await getAnalysis(db, ctx, scenario.analysisId);
  const [updated] = await db
    .update(scenarios)
    .set({
      name: patch.name?.trim(),
      overrides:
        patch.overrides && normalizeOverrides(detail.lines, patch.overrides),
    })
    .where(eq(scenarios.id, scenarioId))
    .returning();
  await touch(db, scenario.analysisId);
  return updated!;
}

export async function deleteScenario(
  db: Db,
  ctx: Context,
  scenarioId: string,
): Promise<void> {
  const scenario = await findScenario(db, ctx, scenarioId);
  await db.delete(scenarios).where(eq(scenarios.id, scenarioId));
  await touch(db, scenario.analysisId);
}

const touch = (db: Db, analysisId: string) =>
  db
    .update(analyses)
    .set({ updatedAt: new Date() })
    .where(eq(analyses.id, analysisId));

export interface AnalysisResults {
  base: AnalysisRun;
  // The chosen scenario, when one is.
  scenario: AnalysisRun | null;
}

export async function runAnalysis(
  db: Db,
  ctx: Context,
  analysisId: string,
  scenarioId?: string | null,
): Promise<AnalysisResults> {
  const detail = await getAnalysis(db, ctx, analysisId);
  const scenario = scenarioId
    ? detail.scenarios.find((s) => s.id === scenarioId)
    : undefined;
  if (scenarioId && !scenario)
    throw new DomainError("not_found", "No such scenario.");
  const [spread, items] = await Promise.all([
    getSpread(db, ctx, detail.entity.id),
    listItems(db, ctx, detail.version.scoringModelVersionId),
  ]);
  const chosen = new Set(detail.analysis.periodIds);
  const periods = spread.periods
    .filter((p) => !chosen.size || chosen.has(p.id))
    .map((p) => ({
      key: p.id,
      end: p.periodEnd,
      months: p.months,
      quality: p.quality,
      entered: spread.values[p.id] ?? {},
      summed: spread.computed[p.id] ?? {},
    }));
  const run = (overrides: Record<string, string>) =>
    runModel({
      periods,
      projectionYears: detail.analysis.projectionYears,
      lines: detail.lines,
      overrides,
      items: items
        .filter((item) => item.kind !== "header")
        .map((item) => ({
          code: item.code,
          label: item.label,
          numeric: isNumeric(item),
        })),
    });
  return { base: run({}), scenario: scenario ? run(scenario.overrides) : null };
}

// A copy of the analysis on the model's latest published version, with the
// same periods and scenarios, to compare against the pinned original.
export async function repinAnalysis(
  db: Db,
  ctx: Context,
  analysisId: string,
): Promise<Analysis> {
  const detail = await getAnalysis(db, ctx, analysisId);
  if (!detail.newerVersion) {
    throw new DomainError(
      "conflict",
      "The analysis already uses the latest published version.",
    );
  }
  const lines = await listLines(db, ctx, detail.newerVersion.id);
  const assumptions = new Set(
    lines.filter((l) => l.kind === "assumption").map((l) => l.code),
  );
  return db.transaction(async (tx) => {
    const copy = await createAnalysis(tx, ctx, {
      entityId: detail.entity.id,
      financialModelVersionId: detail.newerVersion!.id,
      name: `${detail.analysis.name} (v${detail.newerVersion!.number})`,
      periodIds: detail.analysis.periodIds,
      projectionYears: detail.analysis.projectionYears,
    });
    for (const scenario of detail.scenarios) {
      await tx.insert(scenarios).values({
        analysisId: copy.id,
        name: scenario.name,
        position: scenario.position,
        overrides: Object.fromEntries(
          Object.entries(scenario.overrides).filter(([code]) =>
            assumptions.has(code),
          ),
        ),
      });
    }
    return copy;
  });
}
