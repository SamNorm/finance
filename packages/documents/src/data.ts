import { createHash } from "node:crypto";
import type { Db, schema } from "@finance/db";
import {
  getAnalysis,
  getDebtSchedules,
  getEntity,
  getOrganization,
  getVersion,
  LINE_CODES,
  listItems,
  runAnalysis,
  type AnalysisResults,
  type AnalysisRun,
  type ChartDefinition,
  type Context,
  type FinancingPart,
  type LineCode,
  type LineUsage,
  type ModelLine,
  type OwnedDebtSchedule,
  type OwnedLine,
  type Project,
  type ProposedLine,
  type RunPeriod,
} from "@finance/domain";

// The data a document reads (documents-plan.md §3.1): one versioned contract
// assembled from the domain, so templates and AI clients see the same
// figures. Values carry no lineage, which keeps a snapshot small.

export const DATA_VERSION = 1;

// A built-in input's value in a period, with each line of credit's part
// (lines drawn nothing have none); null where it's blank.
export type LineValue = { value: string; parts: FinancingPart[] } | null;

// A run's values by line code, in the periods' order; null where there's
// no value or an error.
export interface DocumentRun {
  periods: RunPeriod[];
  values: Record<string, (string | null)[]>;
  assumptions: Record<string, { value: string | null; overridden: boolean }>;
  // The lines of credit's built-in inputs (borrowing-base-plan.md §4.5), in
  // the periods' order: interest, the limits at the period's end and the
  // average drawn. Blank in actual periods as they stand.
  creditLines: Record<LineCode, LineValue[]>;
}

export interface DocumentData {
  version: typeof DATA_VERSION;
  // The day it was generated, YYYY-MM-DD.
  date: string;
  organization: { name: string; branding: schema.Branding };
  borrower: {
    name: string;
    kind: "borrower" | "consolidated";
    industry: string | null;
    naicsCode: string | null;
    riskRating: string | null;
    // A consolidated client's members, by name.
    members: string[];
  };
  analysis: {
    name: string;
    status: "in_progress" | "completed";
    projectionMode: "assumptions" | "client";
    projectionYears: number;
  };
  model: { name: string; version: number };
  scenario: { name: string } | null;
  lines: Pick<ModelLine, "code" | "label" | "kind" | "format">[];
  charts: ChartDefinition[];
  // The scenario as is (or the base case); the base case beside a scenario;
  // the scenario with its project, and the periods shown post-project.
  run: DocumentRun;
  base: DocumentRun | null;
  project: DocumentRun | null;
  postProject: string[];
  covenants: AnalysisResults["covenants"];
  deal: Project | null;
  debt: OwnedDebtSchedule[];
  // The borrower's lines of credit in force, or a consolidated client's
  // members'; the usage the run assumes for each, by line id (the
  // scenario's over the analysis's); and the lines the scenario proposes
  // for its deal, null for those in force.
  creditLines: {
    inForce: OwnedLine[];
    usage: LineUsage;
    proposed: ProposedLine[] | null;
  };
  // Labels of the scoring model items the deal posts to.
  items: Record<string, string>;
}

function compact(run: AnalysisRun): DocumentRun {
  return {
    periods: run.periods,
    values: Object.fromEntries(
      Object.entries(run.cells).map(([code, cells]) => [
        code,
        cells.map((c) => (c.error ? null : c.value)),
      ]),
    ),
    assumptions: Object.fromEntries(
      Object.entries(run.assumptions).map(([code, a]) => [
        code,
        { value: a.value, overridden: a.overridden },
      ]),
    ),
    // The lines of credit's built-in inputs, as the run counts them.
    creditLines: Object.fromEntries(
      LINE_CODES.map((code) => [code, run.financing[code] ?? []]),
    ) as DocumentRun["creditLines"],
  };
}

export async function analysisDocumentData(
  db: Db,
  ctx: Context,
  analysisId: string,
  scenarioId: string | null,
): Promise<DocumentData> {
  const detail = await getAnalysis(db, ctx, analysisId);
  const scenario = scenarioId
    ? detail.scenarios.find((s) => s.id === scenarioId)
    : undefined;
  const [results, entity, organization, debt, scoring] = await Promise.all([
    runAnalysis(db, ctx, analysisId, scenario?.id ?? null),
    getEntity(db, ctx, detail.entity.id),
    getOrganization(db, ctx),
    getDebtSchedules(db, ctx, detail.entity.id),
    getVersion(db, ctx, detail.version.scoringModelVersionId),
  ]);
  const items = await listItems(db, ctx, scoring.id);
  const deal = scenario?.project ?? null;
  const posted = new Set([
    ...(deal?.sources.flatMap((s) => (s.kind === "funds" ? [s.item] : [])) ??
      []),
    ...(deal?.uses.map((u) => u.item) ?? []),
    ...(deal?.adjustments?.map((a) => a.item) ?? []),
  ]);
  return {
    version: DATA_VERSION,
    date: new Date().toISOString().slice(0, 10),
    organization: {
      name: organization.name,
      branding: organization.branding,
    },
    borrower: {
      name: entity.name,
      kind: entity.kind,
      industry: entity.industry,
      naicsCode: entity.naicsCode,
      riskRating: entity.riskRating,
      members: debt.flatMap((d) => (d.member ? [d.member.name] : [])),
    },
    analysis: {
      name: detail.analysis.name,
      status: detail.analysis.status,
      projectionMode: detail.analysis.projectionMode,
      projectionYears: detail.analysis.projectionYears,
    },
    model: { name: detail.model.name, version: detail.version.number },
    scenario: scenario ? { name: scenario.name } : null,
    lines: detail.lines.map(({ code, label, kind, format }) => ({
      code,
      label,
      kind,
      format,
    })),
    charts: [...detail.modelCharts, ...detail.analysis.charts],
    run: results.scenario ? compact(results.scenario) : compact(results.base),
    base: results.scenario ? compact(results.base) : null,
    project: results.project && compact(results.project),
    postProject: results.postProject,
    covenants: results.covenants,
    deal,
    debt,
    creditLines: {
      inForce: results.creditLines.inForce,
      usage: results.creditLines.usage,
      proposed: scenario?.lines ?? null,
    },
    items: Object.fromEntries(
      items.filter((i) => posted.has(i.code)).map((i) => [i.code, i.label]),
    ),
  };
}

// What the figures were: the data less the day it was generated, so the
// same figures hash the same.
export function dataHash(data: DocumentData) {
  const { date: _, ...figures } = data;
  return createHash("sha256").update(JSON.stringify(figures)).digest("hex");
}
