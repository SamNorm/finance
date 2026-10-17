import { and, asc, desc, eq, inArray, schema, type Db } from "@finance/db";
import { Dec } from "@finance/engine";
import type { Context } from "../context";
import { DomainError } from "../errors";
import {
  checkCharts,
  normalizeCharts,
  type ChartDefinition,
  type ChartInput,
} from "../financial-models/charts";
import { listLines } from "../financial-models/service";
import {
  normalizeAdjustments,
  type AdjustmentInput,
} from "../financing/financing";
import type { ModelLine } from "../financial-models/types";
import { normalizeAssumption } from "../financial-models/validate";
import {
  getVersion as getScoringVersion,
  listItems,
} from "../scoring-models/service";
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
  modelInputValues,
  statementPeriods,
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

export type ProjectionMode = Analysis["projectionMode"];
const PROJECTION_MODES: ProjectionMode[] = ["assumptions", "client"];

function checkSettings(input: {
  name?: string;
  projectionMode?: ProjectionMode;
  projectionYears?: number;
}) {
  if (input.name !== undefined && !input.name.trim()) {
    throw new DomainError("invalid", "Give the analysis a name.");
  }
  if (
    input.projectionMode !== undefined &&
    !PROJECTION_MODES.includes(input.projectionMode)
  ) {
    throw new DomainError(
      "invalid",
      `"${input.projectionMode}" isn't a projection mode.`,
    );
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
  projectionMode?: ProjectionMode;
  projectionYears?: number;
}

export async function createAnalysis(
  db: Db,
  ctx: Context,
  input: AnalysisInput,
): Promise<Analysis> {
  const entity = await getEntity(db, ctx, input.entityId);
  const { version, model } = await publishedVersion(
    db,
    ctx,
    input.financialModelVersionId,
  );
  // Formulas read item codes, so the model must be built on the borrower's
  // scoring model.
  const scoring = await getScoringVersion(
    db,
    ctx,
    version.scoringModelVersionId,
  );
  if (scoring.scoringModelId !== entity.scoringModelId) {
    throw new DomainError(
      "invalid",
      `${model.name} is built on a different scoring model than ${entity.name}'s spreads.`,
    );
  }
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
      projectionMode: input.projectionMode,
      projectionYears: input.projectionYears ?? 0,
    })
    .returning();
  return analysis!;
}

export async function updateAnalysis(
  db: Db,
  ctx: Context,
  analysisId: string,
  patch: {
    name?: string;
    periodIds?: string[];
    projectionMode?: ProjectionMode;
    projectionYears?: number;
  },
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
      projectionMode: patch.projectionMode,
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
  // The pinned version's charts; the analysis's own are on `analysis`.
  modelCharts: ChartDefinition[];
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
    modelCharts: version.charts,
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

export interface ScenarioInput {
  name: string;
  overrides?: Record<string, string>;
  adjustments?: readonly AdjustmentInput[];
}

export async function addScenario(
  db: Db,
  ctx: Context,
  analysisId: string,
  input: ScenarioInput,
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
      adjustments: normalizeAdjustments(input.adjustments ?? []),
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
  patch: Partial<ScenarioInput>,
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
      adjustments: patch.adjustments && normalizeAdjustments(patch.adjustments),
    })
    .where(eq(scenarios.id, scenarioId))
    .returning();
  await touch(db, scenario.analysisId);
  return updated!;
}

// A copy of a scenario, placed last, to vary from it.
export async function duplicateScenario(
  db: Db,
  ctx: Context,
  scenarioId: string,
  name?: string,
): Promise<Scenario> {
  const source = await findScenario(db, ctx, scenarioId);
  return addScenario(db, ctx, source.analysisId, {
    name: name?.trim() || `${source.name} (copy)`,
    overrides: source.overrides,
    adjustments: source.adjustments,
  });
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
  const { periodIds, projectionMode, projectionYears } = detail.analysis;
  const chosen = new Set(periodIds);
  const client = projectionMode === "client";
  // Projections come either from the client, as spread periods, or from the
  // model's assumptions, never both.
  const periods = spread.periods
    .filter((p) => !chosen.size || chosen.has(p.id))
    .filter((p) => client || p.quality !== "projected")
    .map((p) => ({
      key: p.id,
      end: p.periodEnd,
      months: p.months,
      quality: p.quality,
      entered: spread.values[p.id] ?? {},
      summed: spread.computed[p.id] ?? {},
      modelInputs: {} as Record<string, string>,
    }));
  const inputs = await modelInputsOf(
    db,
    periods.map((p) => p.key),
  );
  for (const period of periods) period.modelInputs = inputs[period.key] ?? {};
  const run = (
    overrides: Record<string, string>,
    adjustments: Scenario["adjustments"],
  ) =>
    runModel({
      periods,
      projectionYears: client ? 0 : projectionYears,
      lines: detail.lines,
      overrides,
      adjustments,
      debtSchedule: spread.entity.debtSchedule,
      items: items
        .filter((item) => item.kind !== "header")
        .map((item) => ({
          code: item.code,
          label: item.label,
          numeric: isNumeric(item),
        })),
    });
  // The base case is the borrower as is; scenarios add the project.
  return {
    base: run({}, []),
    scenario: scenario ? run(scenario.overrides, scenario.adjustments) : null,
  };
}

// Figures of model input lines by period id, then code, canonical as
// assumption values are.
async function modelInputsOf(db: Db, periodIds: string[]) {
  const result: Record<string, Record<string, string>> = {};
  if (!periodIds.length) return result;
  const rows = await db
    .select()
    .from(modelInputValues)
    .where(inArray(modelInputValues.periodId, periodIds));
  for (const row of rows) {
    (result[row.periodId] ??= {})[row.code] =
      row.amount !== null ? normalizeNumber(row.amount) : row.text!;
  }
  return result;
}

// Postgres pads numerics to their scale ("12.50"); keep the canonical form.
const normalizeNumber = (raw: string) => new Dec(raw).toFixed();

// Enters, changes or (when blank) clears the figure of one of the analysis's
// input lines in one of its borrower's periods. Figures belong to the
// borrower, so other models with an input of the same code read them too.
export async function setModelInput(
  db: Db,
  ctx: Context,
  analysisId: string,
  periodId: string,
  code: string,
  raw: string,
): Promise<void> {
  const detail = await getAnalysis(db, ctx, analysisId);
  const line = detail.lines.find((l) => l.code === code && l.kind === "input");
  if (!line)
    throw new DomainError("invalid", `"${code}" isn't an input of this model.`);
  if (!UUID.test(periodId)) throw new DomainError("invalid", "Unknown period.");
  const [period] = await db
    .select({ quality: statementPeriods.quality })
    .from(statementPeriods)
    .where(
      and(
        eq(statementPeriods.id, periodId),
        eq(statementPeriods.entityId, detail.entity.id),
      ),
    );
  if (!period)
    throw new DomainError(
      "invalid",
      "The period must belong to the analysis's borrower.",
    );
  const parsed = normalizeAssumption(raw, line.format);
  if ("error" in parsed)
    throw new DomainError("invalid", `${line.label}: ${parsed.error}`);
  const key = and(
    eq(modelInputValues.periodId, periodId),
    eq(modelInputValues.code, code),
  );
  if (parsed.value === null) {
    await db.delete(modelInputValues).where(key);
  } else {
    const numeric = line.format !== "text" && line.format !== "flag";
    const values = {
      amount: numeric ? parsed.value : null,
      text: numeric ? null : parsed.value,
    };
    await db
      .insert(modelInputValues)
      .values({ periodId, code, ...values })
      .onConflictDoUpdate({
        target: [modelInputValues.periodId, modelInputValues.code],
        set: values,
      });
  }
  await touch(db, analysisId);
}

// Replaces the charts added in the analysis. They must fit the pinned
// version's lines, which never change.
export async function setAnalysisCharts(
  db: Db,
  ctx: Context,
  analysisId: string,
  charts: readonly ChartInput[],
): Promise<Analysis> {
  const detail = await getAnalysis(db, ctx, analysisId);
  const normalized = normalizeCharts(charts);
  const issues = checkCharts(normalized, detail.lines);
  if (issues.length)
    throw new DomainError("invalid", issues[0]!.message, issues);
  const [updated] = await db
    .update(analyses)
    .set({ charts: normalized })
    .where(eq(analyses.id, analysisId))
    .returning();
  return updated!;
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
      projectionMode: detail.analysis.projectionMode,
      projectionYears: detail.analysis.projectionYears,
    });
    // Charts come along when the new version still has their lines.
    await tx
      .update(analyses)
      .set({
        charts: detail.analysis.charts.filter(
          (chart) => !checkCharts([chart], lines).length,
        ),
      })
      .where(eq(analyses.id, copy.id));
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
        adjustments: scenario.adjustments,
      });
    }
    return copy;
  });
}
