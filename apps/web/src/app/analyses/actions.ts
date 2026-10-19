"use server";

import {
  addScenario,
  createAnalysis,
  deleteAnalysis,
  deleteScenario,
  DomainError,
  duplicateScenario,
  getFinancialModel,
  repinAnalysis,
  setAnalysisCharts,
  setModelInput,
  setProjectLoanAdjustments,
  updateAnalysis,
  updateScenario,
  type ChartInput,
  type CovenantInput,
  type ProjectInput,
} from "@finance/domain";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import {
  adjustmentFields,
  attempt,
  invalid,
  lineUsageFields,
  proposedLineFields,
  run,
  text,
} from "@/lib/actions";
import { ANALYSIS_STATUSES, isOneOf, PROJECTION_MODES } from "@/lib/labels";

// A new scenario opens on its assumptions and project, to fill them in.
const page = (analysisId: string, scenarioId?: string) =>
  `/analyses/${analysisId}${scenarioId ? `?scenario=${scenarioId}&tab=scenario` : ""}`;

function projectionMode(value: string) {
  if (!isOneOf(PROJECTION_MODES, value))
    throw invalid(`"${value}" isn't a projection mode.`);
  return value;
}

function status(value: string) {
  if (!isOneOf(ANALYSIS_STATUSES, value))
    throw invalid(`"${value}" isn't a status.`);
  return value;
}

// New analyses use the model's latest published version.
export async function createAnalysisAction(
  form: FormData,
): Promise<ActionResult> {
  const result = await attempt(async (db, ctx) => {
    const model = await getFinancialModel(db, ctx, text(form, "modelId"));
    const version = model.versions.findLast((v) => v.status === "published");
    if (!version)
      throw new DomainError(
        "invalid",
        `${model.name} has no published version yet.`,
      );
    return createAnalysis(db, ctx, {
      entityId: text(form, "entityId"),
      financialModelVersionId: version.id,
      name: text(form, "name"),
      projectionMode: projectionMode(text(form, "projectionMode")),
      projectionYears: Number(text(form, "projectionYears") || 0),
    });
  });
  if (!result.ok) return result;
  redirect(page(result.value.id));
}

export async function updateAnalysisAction(
  analysisId: string,
  patch: {
    name?: string;
    periodIds?: string[];
    projectionMode?: string;
    projectionYears?: number;
    postProjectKeys?: string[];
    status?: string;
    // The usage assumed for each line of credit, by line id.
    lineUsage?: unknown;
  },
): Promise<ActionResult> {
  return run((db, ctx) => {
    if (patch.periodIds !== undefined && !Array.isArray(patch.periodIds))
      throw invalid("Choose periods.");
    if (
      patch.postProjectKeys !== undefined &&
      !Array.isArray(patch.postProjectKeys)
    )
      throw invalid("Choose periods.");
    return updateAnalysis(db, ctx, analysisId, {
      name: patch.name === undefined ? undefined : String(patch.name),
      periodIds: patch.periodIds?.map(String),
      projectionMode:
        patch.projectionMode === undefined
          ? undefined
          : projectionMode(String(patch.projectionMode)),
      projectionYears:
        patch.projectionYears === undefined
          ? undefined
          : Number(patch.projectionYears),
      postProjectKeys: patch.postProjectKeys?.map(String),
      status:
        patch.status === undefined ? undefined : status(String(patch.status)),
      lineUsage:
        patch.lineUsage === undefined
          ? undefined
          : lineUsageFields(patch.lineUsage),
    });
  });
}

export async function deleteAnalysisAction(
  analysisId: string,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) =>
    deleteAnalysis(db, ctx, analysisId),
  );
  if (!result.ok) return result;
  redirect("/analyses");
}

export async function saveModelInputAction(
  analysisId: string,
  periodId: string,
  code: string,
  raw: string,
): Promise<ActionResult> {
  return run((db, ctx) =>
    setModelInput(
      db,
      ctx,
      analysisId,
      String(periodId),
      String(code),
      String(raw),
    ),
  );
}

export async function saveAnalysisChartsAction(
  analysisId: string,
  charts: ChartInput[],
): Promise<ActionResult> {
  return run((db, ctx) => {
    if (!Array.isArray(charts)) throw invalid("Charts must be a list.");
    return setAnalysisCharts(db, ctx, analysisId, charts);
  });
}

export async function addScenarioAction(
  analysisId: string,
  form: FormData,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) =>
    addScenario(db, ctx, analysisId, { name: text(form, "name") }),
  );
  if (!result.ok) return result;
  redirect(page(analysisId, result.value.id));
}

// Fields of an object from the client, as text.
const textFields = (value: object) =>
  Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, v === null ? "" : String(v)]),
  );

export async function updateScenarioAction(
  scenarioId: string,
  patch: {
    name?: string;
    overrides?: Record<string, string>;
    periodOverrides?: Record<string, Record<string, string>>;
    project?: ProjectInput | null;
    capex?: unknown[];
    covenants?: CovenantInput[] | null;
    // The lines of credit proposed for its deal; null keeps those in force.
    lines?: unknown[] | null;
    lineUsage?: unknown;
  },
): Promise<ActionResult> {
  return run((db, ctx) => {
    const { overrides, periodOverrides, project, capex, covenants, lines } =
      patch;
    if (lines !== undefined && lines !== null && !Array.isArray(lines))
      throw invalid("Proposed lines of credit must be a list.");
    if (capex !== undefined && !Array.isArray(capex))
      throw invalid("The capex plan must be a list of purchases.");
    if (
      covenants !== undefined &&
      covenants !== null &&
      !Array.isArray(covenants)
    )
      throw invalid("Covenants must be a list.");
    if (
      overrides !== undefined &&
      (typeof overrides !== "object" || overrides === null)
    ) {
      throw invalid("Overrides must be assumption values.");
    }
    const isObject = (value: unknown): value is object =>
      typeof value === "object" && value !== null;
    if (
      periodOverrides !== undefined &&
      (!isObject(periodOverrides) ||
        !Object.values(periodOverrides).every(isObject))
    )
      throw invalid("Values by year must be assumption values by period.");
    if (
      project !== undefined &&
      project !== null &&
      typeof project !== "object"
    )
      throw invalid("The project must be sources, uses and facilities.");
    return updateScenario(db, ctx, scenarioId, {
      name: patch.name === undefined ? undefined : String(patch.name),
      overrides: overrides && textFields(overrides),
      periodOverrides:
        periodOverrides &&
        Object.fromEntries(
          Object.entries(periodOverrides).map(([code, values]) => [
            code,
            textFields(values),
          ]),
        ),
      project,
      capex,
      covenants,
      lines: lines && lines.map(proposedLineFields),
      lineUsage:
        patch.lineUsage === undefined
          ? undefined
          : lineUsageFields(patch.lineUsage),
    });
  });
}

export async function saveProjectLoanAdjustmentsAction(
  scenarioId: string,
  loanId: string,
  adjustments: unknown[],
): Promise<ActionResult> {
  return run((db, ctx) =>
    setProjectLoanAdjustments(
      db,
      ctx,
      String(scenarioId),
      String(loanId),
      adjustmentFields(adjustments),
    ),
  );
}

export async function duplicateScenarioAction(
  analysisId: string,
  scenarioId: string,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) =>
    duplicateScenario(db, ctx, scenarioId),
  );
  if (!result.ok) return result;
  redirect(page(analysisId, result.value.id));
}

export async function deleteScenarioAction(
  analysisId: string,
  scenarioId: string,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) =>
    deleteScenario(db, ctx, scenarioId),
  );
  if (!result.ok) return result;
  redirect(page(analysisId));
}

export async function repinAnalysisAction(
  analysisId: string,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) => repinAnalysis(db, ctx, analysisId));
  if (!result.ok) return result;
  redirect(page(result.value.id));
}
