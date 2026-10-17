"use server";

import {
  addScenario,
  createAnalysis,
  deleteAnalysis,
  deleteScenario,
  DomainError,
  getFinancialModel,
  repinAnalysis,
  updateAnalysis,
  updateScenario,
} from "@finance/domain";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { attempt, invalid, run, text } from "@/lib/actions";
import { isOneOf, PROJECTION_MODES } from "@/lib/labels";

const page = (analysisId: string, scenarioId?: string) =>
  `/analyses/${analysisId}${scenarioId ? `?scenario=${scenarioId}` : ""}`;

function projectionMode(value: string) {
  if (!isOneOf(PROJECTION_MODES, value))
    throw invalid(`"${value}" isn't a projection mode.`);
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
  },
): Promise<ActionResult> {
  return run((db, ctx) => {
    if (patch.periodIds !== undefined && !Array.isArray(patch.periodIds))
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

export async function updateScenarioAction(
  scenarioId: string,
  patch: { name?: string; overrides?: Record<string, string> },
): Promise<ActionResult> {
  return run((db, ctx) => {
    const overrides = patch.overrides;
    if (
      overrides !== undefined &&
      (typeof overrides !== "object" || overrides === null)
    ) {
      throw invalid("Overrides must be assumption values.");
    }
    return updateScenario(db, ctx, scenarioId, {
      name: patch.name === undefined ? undefined : String(patch.name),
      overrides:
        overrides &&
        Object.fromEntries(
          Object.entries(overrides).map(([k, v]) => [k, String(v)]),
        ),
    });
  });
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
