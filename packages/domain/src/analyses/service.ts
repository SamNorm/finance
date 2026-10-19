import { and, asc, desc, eq, inArray, schema, type Db } from "@finance/db";
import { Dec } from "@finance/engine";
import type { Context } from "../context";
import {
  normalizeCovenants,
  testCovenants,
  type CovenantInput,
  type CovenantResult,
} from "../covenants/covenants";
import { DomainError, type Issue } from "../errors";
import {
  checkCharts,
  normalizeCharts,
  type ChartDefinition,
  type ChartInput,
} from "../financial-models/charts";
import { listLines } from "../financial-models/service";
import type { ModelLine } from "../financial-models/types";
import { normalizeAssumption } from "../financial-models/validate";
import {
  capexYears,
  normalizeCapex,
  type CapexItem,
  type CapexYear,
} from "../financing/capex";
import { marginedLines } from "../borrowing-bases/lines";
import {
  checkProposedTerms,
  linesWithoutUsage,
  mergeLineUsage,
  normalizeLineUsage,
  normalizeProposedLines,
  type LineUsage,
  type ProposedLine,
  type ProposedLineInput,
} from "../credit-lines/credit-lines";
import { getCreditLines, type OwnedLine } from "../credit-lines/service";
import { parseDate } from "../financing/common";
import {
  balanceSheetSides,
  imbalance,
  normalizeProject,
  type Project,
  type FinancingItems,
  type ProjectInput,
  type Side,
} from "../financing/financing";
import {
  getScoringModel,
  getVersion as getScoringVersion,
  listItems,
} from "../scoring-models/service";
import type { ScoringItem } from "../scoring-models/types";
import { isNumeric } from "../spreads/checks";
import { getDebtSchedules, type Consolidation } from "../spreads/consolidation";
import {
  getEntity,
  getSpread,
  type Spread,
  type StatementPeriod,
} from "../spreads/service";
import { runModel, withProject, type AnalysisRun } from "./run";

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
export type AnalysisStatus = Analysis["status"];
const STATUSES: AnalysisStatus[] = ["in_progress", "completed"];

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
  await checkSpread(db, ctx, entity.id, {
    periodIds,
    projectionMode: input.projectionMode ?? "assumptions",
  });
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
    // Periods shown with a post-project column, by run period key.
    postProjectKeys?: string[];
    status?: AnalysisStatus;
    // The usage assumed for each of the borrower's lines of credit, as
    // typed: their share of the limit, and amounts drawn by month.
    lineUsage?: unknown;
  },
): Promise<Analysis> {
  const analysis = await findAnalysis(db, ctx, analysisId);
  const lineUsage =
    patch.lineUsage === undefined
      ? undefined
      : await checkLineUsage(db, ctx, analysis.entityId, patch.lineUsage);
  checkSettings(patch);
  if (patch.status !== undefined && !STATUSES.includes(patch.status)) {
    throw new DomainError("invalid", `"${patch.status}" isn't a status.`);
  }
  const postProjectKeys = patch.postProjectKeys && [
    ...new Set(patch.postProjectKeys),
  ];
  if (
    postProjectKeys?.some(
      (key) => !UUID.test(key) && !/^projected-\d{1,2}$/.test(key),
    )
  )
    throw new DomainError("invalid", "Unknown period.");
  const periodIds = patch.periodIds && [...new Set(patch.periodIds)];
  if (periodIds) await checkPeriods(db, analysis.entityId, periodIds);
  if (periodIds || patch.projectionMode || patch.status === "completed")
    await checkSpread(db, ctx, analysis.entityId, {
      periodIds: periodIds ?? analysis.periodIds,
      projectionMode: patch.projectionMode ?? analysis.projectionMode,
    });
  if (patch.status === "completed") await checkBalanced(db, analysisId);
  const [updated] = await db
    .update(analyses)
    .set({
      name: patch.name?.trim(),
      periodIds,
      projectionMode: patch.projectionMode,
      projectionYears: patch.projectionYears,
      postProjectKeys,
      lineUsage,
      status: patch.status,
      // Completing again keeps the first date.
      completedAt:
        patch.status === undefined || patch.status === analysis.status
          ? undefined
          : patch.status === "completed"
            ? new Date()
            : null,
    })
    .where(eq(analyses.id, analysisId))
    .returning();
  return updated!;
}

// The spread periods an analysis runs on: those chosen, or all when none
// are, with the client's projections only when it projects with them.
export function analyzedPeriods(
  spread: Spread,
  settings: Pick<Analysis, "periodIds" | "projectionMode">,
): StatementPeriod[] {
  const chosen = new Set(settings.periodIds);
  const client = settings.projectionMode === "client";
  return spread.periods
    .filter((p) => !chosen.size || chosen.has(p.id))
    .filter((p) => client || p.quality !== "projected");
}

// Critical errors in the periods an analysis runs on: a balance sheet that
// doesn't balance, or net income that isn't the statements'. Its results
// can't be relied on until they're fixed.
export function spreadErrors(
  spread: Spread,
  settings: Pick<Analysis, "periodIds" | "projectionMode">,
): { period: StatementPeriod; issues: Issue[] }[] {
  return analyzedPeriods(spread, settings).flatMap((period) => {
    const issues = (spread.checks[period.id] ?? []).filter(
      (i) => i.severity === "error",
    );
    return issues.length ? [{ period, issues }] : [];
  });
}

const periodLabel = (p: StatementPeriod) =>
  p.months === 12 ? p.periodEnd : `${p.periodEnd} (${p.months} months)`;

// Analyses are made, re-scoped and completed only on a sound spread.
async function checkSpread(
  db: Db,
  ctx: Context,
  entityId: string,
  settings: Pick<Analysis, "periodIds" | "projectionMode">,
) {
  const spread = await getSpread(db, ctx, entityId);
  const issues = spreadErrors(spread, settings).flatMap(({ period, issues }) =>
    issues.map((i) => ({
      ...i,
      message: `${periodLabel(period)}: ${i.message}`,
    })),
  );
  if (issues.length)
    throw new DomainError(
      "conflict",
      `Fix ${spread.entity.name}'s spread before analyzing it. ${issues.map((i) => i.message).join(" ")}`,
      issues,
    );
}

// An analysis is completed with its projects settled: in each scenario's,
// sources equal uses, or its post-project balance sheet doesn't balance.
// Projects are built a piece at a time, so they can differ until then.
async function checkBalanced(db: Db, analysisId: string) {
  const list = await db
    .select({ name: scenarios.name, project: scenarios.project })
    .from(scenarios)
    .where(eq(scenarios.analysisId, analysisId))
    .orderBy(asc(scenarios.position), asc(scenarios.createdAt));
  const issues = list.flatMap(({ name, project }): Issue[] => {
    const off = project && imbalance(project);
    return off
      ? [
          {
            severity: "error",
            code: "project_unbalanced",
            message: `${name}: ${off.charAt(0).toLowerCase()}${off.slice(1)}.`,
          },
        ]
      : [];
  });
  if (issues.length)
    throw new DomainError(
      "conflict",
      `Balance each project's sources and uses before completing the analysis. ${issues.map((i) => i.message).join(" ")}`,
      issues,
    );
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

// Values entered year by year keep only the model's assumptions, by period
// end, in canonical form; blanks are dropped.
function normalizePeriodOverrides(
  lines: readonly ModelLine[],
  input: Record<string, Record<string, string | null>>,
) {
  const result: Record<string, Record<string, string>> = {};
  for (const [code, values] of Object.entries(input)) {
    const line = lines.find((l) => l.code === code && l.kind === "assumption");
    if (!line)
      throw new DomainError(
        "invalid",
        `"${code}" isn't an assumption of this model.`,
      );
    if (typeof values !== "object" || values === null)
      throw new DomainError(
        "invalid",
        `${line.label}: give its values by period end, e.g. {"2026-12-31": "200000"}.`,
      );
    for (const [end, raw] of Object.entries(values)) {
      parseDate(end, line.label, "period end");
      const parsed = normalizeAssumption(String(raw ?? ""), line.format);
      if ("error" in parsed)
        throw new DomainError(
          "invalid",
          `${line.label}, ${end}: ${parsed.error}`,
        );
      if (parsed.value !== null) (result[code] ??= {})[end] = parsed.value;
    }
  }
  return result;
}

// Usage as typed, for the borrower's lines and any the scenario proposes.
async function checkLineUsage(
  db: Db,
  ctx: Context,
  entityId: string,
  usage: unknown,
  proposed: readonly ProposedLine[] | null = null,
) {
  const lines = [
    ...(await getCreditLines(db, ctx, entityId)),
    ...(proposed ?? []),
  ];
  return normalizeLineUsage(
    usage,
    new Set(lines.map((l) => l.id)),
    new Map(lines.map((l) => [l.id, l.name])),
  );
}

// A scenario's proposed lines, as typed, with their borrowing base terms
// checked against each margined line's definition.
async function checkProposedLines(
  db: Db,
  ctx: Context,
  entityId: string,
  input: readonly ProposedLineInput[],
): Promise<ProposedLine[]> {
  const lines = normalizeProposedLines(input);
  if (lines.some((l) => l.terms)) {
    const margined = await marginedLines(db, ctx, entityId);
    for (const line of lines)
      checkProposedTerms(
        line.terms,
        margined.find((m) => m.key === line.id)?.line.borrowingBase ??
          line.borrowingBase ??
          null,
        line.name,
      );
  }
  return lines;
}

// Usage kept only for lines still there, once a scenario's proposed lines
// change.
async function keptLineUsage(
  db: Db,
  ctx: Context,
  entityId: string,
  usage: LineUsage,
  proposed: readonly ProposedLine[] | null,
): Promise<LineUsage> {
  const ids = new Set([
    ...(await getCreditLines(db, ctx, entityId)).map((l) => l.id),
    ...(proposed ?? []).map((l) => l.id),
  ]);
  return Object.fromEntries(
    Object.entries(usage).filter(([id]) => ids.has(id)),
  );
}

export interface ScenarioInput {
  name: string;
  overrides?: Record<string, string>;
  // Assumption code → period end → value, for values that change year by
  // year; they apply in projected periods and post-project columns.
  periodOverrides?: Record<string, Record<string, string | null>>;
  // The project it finances; null or empty for a stress alone.
  project?: ProjectInput | null;
  // Purchases planned in projected years, as typed or as saved.
  capex?: unknown;
  // The covenants proposed for its deal; null tests the borrower's.
  covenants?: readonly CovenantInput[] | null;
  // The lines of credit proposed for its deal, those in force by their id;
  // null keeps the lines in force.
  lines?: readonly ProposedLineInput[] | null;
  // Usage assumed for lines, over the analysis's: by line, a share and
  // amounts drawn by month.
  lineUsage?: unknown;
  // Changes to projected borrowing bases, as saved, when a scenario is
  // copied; set a line's with setScenarioBorrowingBase.
  borrowingBases?: Scenario["borrowingBases"];
}

// What a project's items are checked against: the balance sheet of the
// pinned version's scoring model, and where it posts new loans.
async function projectContext(db: Db, ctx: Context, detail: AnalysisDetail) {
  const scoring = await getScoringVersion(
    db,
    ctx,
    detail.version.scoringModelVersionId,
  );
  const [items, model, debt] = await Promise.all([
    listItems(db, ctx, scoring.id),
    getScoringModel(db, ctx, scoring.scoringModelId),
    getDebtSchedules(db, ctx, detail.entity.id),
  ]);
  return {
    existingLoans: new Set(
      debt.flatMap(({ schedule }) => schedule.loans.map((l) => l.id)),
    ),
    items,
    sides: balanceSheetSides(items),
    mapping: model.financingItems,
    // What adjustments can change: any statement's numeric inputs.
    adjustable: items.filter((i) => i.kind === "input" && isNumeric(i)),
  };
}

// What a project in the analysis can post to: the balance sheet items of
// its pinned version's scoring model, each on its side, and the items new
// loans post to, when the scoring model says. Adjustments can also change
// other statements' numeric inputs.
export async function getProjectSetup(
  db: Db,
  ctx: Context,
  analysisId: string,
): Promise<{
  items: { code: string; label: string; side: Side }[];
  loansPostTo: FinancingItems;
  adjustable: {
    code: string;
    label: string;
    statement: ScoringItem["statement"];
    side: Side | null;
  }[];
}> {
  const detail = await getAnalysis(db, ctx, analysisId);
  const { items, sides, mapping, adjustable } = await projectContext(
    db,
    ctx,
    detail,
  );
  return {
    items: items.flatMap((item) => {
      const side = sides.get(item.code);
      return side ? [{ code: item.code, label: item.label, side }] : [];
    }),
    loansPostTo: mapping,
    adjustable: adjustable.map((item) => ({
      code: item.code,
      label: item.label,
      statement: item.statement,
      side: sides.get(item.code) ?? null,
    })),
  };
}

async function checkProject(
  db: Db,
  ctx: Context,
  detail: AnalysisDetail,
  input: ProjectInput | null | undefined,
) {
  if (!input) return null;
  const { sides, mapping, adjustable, existingLoans } = await projectContext(
    db,
    ctx,
    detail,
  );
  return normalizeProject(input, {
    sides,
    items: mapping,
    adjustable: new Set(adjustable.map((i) => i.code)),
    existingLoans,
  });
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
  const lines = input.lines
    ? await checkProposedLines(db, ctx, detail.entity.id, input.lines)
    : null;
  const lineUsage = await checkLineUsage(
    db,
    ctx,
    detail.entity.id,
    input.lineUsage ?? {},
    lines,
  );
  const [scenario] = await db
    .insert(scenarios)
    .values({
      analysisId,
      name: input.name.trim(),
      position: detail.scenarios.length,
      overrides: normalizeOverrides(detail.lines, input.overrides ?? {}),
      periodOverrides: normalizePeriodOverrides(
        detail.lines,
        input.periodOverrides ?? {},
      ),
      project: await checkProject(db, ctx, detail, input.project),
      capex: normalizeCapex(input.capex),
      covenants: input.covenants ? normalizeCovenants(input.covenants) : null,
      lines,
      lineUsage,
      borrowingBases: input.borrowingBases ?? {},
    })
    .returning();
  await touch(db, analysisId);
  return scenario!;
}

export async function getScenario(
  db: Db,
  ctx: Context,
  scenarioId: string,
): Promise<Scenario> {
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
  const scenario = await getScenario(db, ctx, scenarioId);
  if (patch.name !== undefined && !patch.name.trim()) {
    throw new DomainError("invalid", "Give the scenario a name.");
  }
  const detail = await getAnalysis(db, ctx, scenario.analysisId);
  const lines =
    patch.lines === undefined
      ? scenario.lines
      : patch.lines &&
        (await checkProposedLines(db, ctx, detail.entity.id, patch.lines));
  const lineUsage =
    patch.lineUsage !== undefined
      ? await checkLineUsage(db, ctx, detail.entity.id, patch.lineUsage, lines)
      : patch.lines !== undefined
        ? await keptLineUsage(
            db,
            ctx,
            detail.entity.id,
            scenario.lineUsage,
            lines,
          )
        : undefined;
  const [updated] = await db
    .update(scenarios)
    .set({
      name: patch.name?.trim(),
      overrides:
        patch.overrides && normalizeOverrides(detail.lines, patch.overrides),
      periodOverrides:
        patch.periodOverrides &&
        normalizePeriodOverrides(detail.lines, patch.periodOverrides),
      project:
        patch.project === undefined
          ? undefined
          : await checkProject(db, ctx, detail, patch.project),
      capex:
        patch.capex === undefined ? undefined : normalizeCapex(patch.capex),
      covenants:
        patch.covenants === undefined
          ? undefined
          : patch.covenants && normalizeCovenants(patch.covenants),
      lines: patch.lines === undefined ? undefined : lines,
      lineUsage,
    })
    .where(eq(scenarios.id, scenarioId))
    .returning();
  await touch(db, scenario.analysisId);
  return updated!;
}

// Replaces one of a scenario's new loans' schedule adjustments, as typed.
export async function setProjectLoanAdjustments(
  db: Db,
  ctx: Context,
  scenarioId: string,
  loanId: string,
  adjustments: unknown,
): Promise<Scenario> {
  const { project } = await getScenario(db, ctx, scenarioId);
  if (!project?.sources.some((s) => s.kind === "loan" && s.id === loanId))
    throw new DomainError("not_found", "No such loan.");
  return updateScenario(db, ctx, scenarioId, {
    project: {
      ...project,
      sources: project.sources.map((s) =>
        s.id === loanId ? { ...s, adjustments } : s,
      ),
    } as ProjectInput,
  });
}

// A copy of a scenario, placed last, to vary from it.
export async function duplicateScenario(
  db: Db,
  ctx: Context,
  scenarioId: string,
  name?: string,
): Promise<Scenario> {
  const source = await getScenario(db, ctx, scenarioId);
  return addScenario(db, ctx, source.analysisId, {
    name: name?.trim() || `${source.name} (copy)`,
    overrides: source.overrides,
    periodOverrides: source.periodOverrides,
    project: source.project,
    capex: source.capex,
    covenants: source.covenants,
    lines: source.lines,
    lineUsage: source.lineUsage,
    borrowingBases: source.borrowingBases,
  });
}

export async function deleteScenario(
  db: Db,
  ctx: Context,
  scenarioId: string,
): Promise<void> {
  const scenario = await getScenario(db, ctx, scenarioId);
  await db.delete(scenarios).where(eq(scenarios.id, scenarioId));
  await touch(db, scenario.analysisId);
}

const touch = (db: Db, analysisId: string) =>
  db
    .update(analyses)
    .set({ updatedAt: new Date() })
    .where(eq(analyses.id, analysisId));

export interface AnalysisResults {
  // The chosen scenario's capex plan year by year; empty without one.
  capex: CapexYear[];
  // The borrower's lines of credit in force, the usage the shown run
  // assumes (the scenario's over the analysis's), and the lines it counts
  // with none, whose interest counts as zero.
  creditLines: {
    inForce: OwnedLine[];
    usage: LineUsage;
    withoutUsage: { id: string; name: string }[];
  };
  base: AnalysisRun;
  // The chosen scenario, when one is.
  scenario: AnalysisRun | null;
  // The scenario with its project, when it has one: the post-project columns.
  project: AnalysisRun | null;
  // The periods shown with a post-project column, by key.
  postProject: string[];
  // The covenants tested: the scenario's proposed for its deal, or else the
  // borrower's in force; in the run shown (the scenario's, or the base case)
  // and post-project.
  covenants: {
    source: "borrower" | "scenario";
    run: CovenantResult[];
    project: CovenantResult[] | null;
  };
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
  const [spread, { items, sides, mapping }, debt, inForce] = await Promise.all([
    getSpread(db, ctx, detail.entity.id),
    projectContext(db, ctx, detail),
    getDebtSchedules(db, ctx, detail.entity.id),
    getCreditLines(db, ctx, detail.entity.id),
  ]);
  const usage = mergeLineUsage(
    detail.analysis.lineUsage,
    scenario?.lineUsage ?? {},
  );
  const { projectionMode, projectionYears } = detail.analysis;
  const client = projectionMode === "client";
  // Projections come either from the client, as spread periods, or from the
  // model's assumptions, never both.
  const periods = analyzedPeriods(spread, detail.analysis).map((p) => ({
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
  if (spread.consolidation)
    await addMemberInputs(db, spread.consolidation, detail.lines, inputs);
  for (const period of periods) period.modelInputs = inputs[period.key] ?? {};
  const run = (
    scenario: Pick<Scenario, "overrides" | "periodOverrides"> | null,
    project: Project | null,
    capex: readonly CapexItem[] = [],
    proposed: readonly ProposedLine[] | null = null,
  ) =>
    runModel({
      periods: project
        ? withProject(periods, project, items, sides, mapping)
        : periods,
      projectionYears: client ? 0 : projectionYears,
      lines: detail.lines,
      overrides: scenario?.overrides ?? {},
      periodOverrides: scenario?.periodOverrides,
      project,
      capex,
      // The base case assumes the analysis's usage; a scenario, its own
      // over it.
      creditLines: {
        inForce,
        proposed,
        usage: scenario ? usage : detail.analysis.lineUsage,
      },
      debtSchedules: debt.map((d) => d.schedule),
      items: items
        .filter((item) => item.kind !== "header")
        .map((item) => ({
          code: item.code,
          label: item.label,
          numeric: isNumeric(item),
        })),
    });
  // The base case is the borrower as is; a scenario's project shows in
  // post-project columns next to the scenario as is.
  const base = run(null, null);
  const keys = new Set(base.periods.map((p) => p.key));
  const lastYear = base.periods.findLast(
    (p) => p.projection === null && p.months === 12,
  );
  // A scenario's proposed lines apply from closing post-project; with no
  // project, from the first projected month.
  const scenarioRun = scenario
    ? run(
        scenario,
        null,
        scenario.capex,
        scenario.project ? null : scenario.lines,
      )
    : null;
  const projectRun = scenario?.project
    ? run(scenario, scenario.project, scenario.capex, scenario.lines)
    : null;
  const covenants = scenario?.covenants ?? spread.entity.covenants;
  // Lines open after the latest actual period, when interest is counted.
  const lastActual = base.periods.findLast((p) => !p.projection)?.end ?? "";
  const counted = [
    ...inForce.filter(
      (l) =>
        (!l.closedOn || l.closedOn > lastActual) &&
        !scenario?.lines?.some((p) => p.id === l.id),
    ),
    ...(scenario?.lines ?? []),
  ];
  return {
    creditLines: {
      inForce,
      usage,
      withoutUsage: linesWithoutUsage(counted, usage).map(({ id, name }) => ({
        id,
        name,
      })),
    },
    capex: scenarioRun
      ? capexYears(
          scenario!.capex,
          scenarioRun.periods.map((p) => ({
            end: p.end,
            months: p.months,
            projected: p.projection !== null,
          })),
        )
      : [],
    base,
    scenario: scenarioRun,
    project: projectRun,
    postProject: (
      detail.analysis.postProjectKeys ?? (lastYear ? [lastYear.key] : [])
    ).filter((key) => keys.has(key)),
    covenants: {
      source: scenario?.covenants ? "scenario" : "borrower",
      run: testCovenants(covenants, scenarioRun ?? base, detail.lines),
      project: projectRun && testCovenants(covenants, projectRun, detail.lines),
    },
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

// A consolidated client's input lines read its members' figures, added up,
// where it has none of its own: amounts and counts only, as rates and text
// don't add.
async function addMemberInputs(
  db: Db,
  consolidation: Consolidation,
  lines: readonly ModelLine[],
  inputs: Record<string, Record<string, string>>,
) {
  const additive = lines.filter(
    (l) =>
      l.kind === "input" && (l.format === "amount" || l.format === "count"),
  );
  if (!additive.length) return;
  const periods = Object.entries(consolidation.periods);
  const members = await modelInputsOf(
    db,
    periods.flatMap(([, p]) => p.statements.map((s) => s.periodId)),
  );
  for (const [periodId, { statements }] of periods) {
    for (const { code } of additive) {
      if (inputs[periodId]?.[code] !== undefined) continue;
      const figures = statements.flatMap(
        (s) => members[s.periodId]?.[code] ?? [],
      );
      if (figures.length)
        (inputs[periodId] ??= {})[code] = figures
          .reduce((sum, v) => sum.plus(v), new Dec(0))
          .toFixed();
    }
  }
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
        postProjectKeys: detail.analysis.postProjectKeys,
        lineUsage: detail.analysis.lineUsage,
        borrowingBases: detail.analysis.borrowingBases,
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
        periodOverrides: Object.fromEntries(
          Object.entries(scenario.periodOverrides).filter(([code]) =>
            assumptions.has(code),
          ),
        ),
        project: scenario.project,
        capex: scenario.capex,
        covenants: scenario.covenants,
        lines: scenario.lines,
        lineUsage: scenario.lineUsage,
        borrowingBases: scenario.borrowingBases,
      });
    }
    // The client's projected borrowing bases come along.
    const forecast = await tx
      .select()
      .from(schema.analysisBorrowingBaseValues)
      .where(eq(schema.analysisBorrowingBaseValues.analysisId, analysisId));
    if (forecast.length)
      await tx
        .insert(schema.analysisBorrowingBaseValues)
        .values(forecast.map((v) => ({ ...v, analysisId: copy.id })));
    return copy;
  });
}
