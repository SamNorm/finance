"use server";

import {
  addLine,
  createFinancialModel,
  createFinancialModelDraft,
  deleteFinancialModel,
  discardFinancialModelDraft,
  duplicateFinancialModel,
  moveLine,
  publishFinancialModelVersion,
  removeLine,
  setFinancialModelCharts,
  setScoringVersion,
  updateFinancialModel,
  updateLine,
  type ChartInput,
  type ModelLine,
} from "@finance/domain";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { attempt, invalid, run, text } from "@/lib/actions";

const page = (modelId: string, version?: number) =>
  `/financial-models/${modelId}${version ? `?v=${version}` : ""}`;

const KINDS = ["assumption", "calculation", "input", "header"] as const;
const FORMATS = [
  "amount",
  "percent",
  "ratio",
  "count",
  "flag",
  "text",
] as const;

function pick<T extends string>(
  form: FormData,
  name: string,
  options: readonly T[],
): T {
  const value = text(form, name);
  if (!options.includes(value as T))
    throw invalid(`"${value}" isn't a valid ${name}.`);
  return value as T;
}

function readLine(form: FormData): ModelLine {
  return {
    code: text(form, "code"),
    label: text(form, "label"),
    kind: pick(form, "kind", KINDS),
    format: pick(form, "format", FORMATS),
    formula: text(form, "formula") || null,
    projectionFormula: text(form, "projectionFormula") || null,
    defaultValue: text(form, "defaultValue") || null,
    breaksDown: text(form, "breaksDown") || null,
    description: text(form, "description") || null,
  };
}

export async function createFinancialModelAction(
  form: FormData,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) =>
    createFinancialModel(db, ctx, {
      name: text(form, "name"),
      description: text(form, "description"),
      scoringModelId: text(form, "scoringModelId"),
    }),
  );
  if (!result.ok) return result;
  redirect(page(result.value.model.id));
}

export async function updateFinancialModelAction(
  modelId: string,
  form: FormData,
): Promise<ActionResult> {
  return run((db, ctx) =>
    updateFinancialModel(db, ctx, modelId, {
      name: text(form, "name"),
      description: text(form, "description"),
    }),
  );
}

export async function duplicateFinancialModelAction(
  modelId: string,
  form: FormData,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) =>
    duplicateFinancialModel(db, ctx, modelId, { name: text(form, "name") }),
  );
  if (!result.ok) return result;
  redirect(page(result.value.model.id));
}

export async function deleteFinancialModelAction(
  modelId: string,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) =>
    deleteFinancialModel(db, ctx, modelId),
  );
  if (!result.ok) return result;
  redirect("/financial-models");
}

// Adds a line, or updates the one named by originalCode.
export async function saveLineAction(form: FormData): Promise<ActionResult> {
  return run(async (db, ctx) => {
    const versionId = text(form, "versionId");
    const originalCode = text(form, "originalCode");
    const line = readLine(form);
    if (originalCode) {
      await updateLine(db, ctx, versionId, originalCode, line);
    } else {
      const position = Number(text(form, "position"));
      await addLine(
        db,
        ctx,
        versionId,
        line,
        Number.isFinite(position) ? position : undefined,
      );
    }
  });
}

export async function saveModelChartsAction(
  versionId: string,
  charts: ChartInput[],
): Promise<ActionResult> {
  return run((db, ctx) => {
    if (!Array.isArray(charts)) throw invalid("Charts must be a list.");
    return setFinancialModelCharts(db, ctx, versionId, charts);
  });
}

export async function removeLineAction(
  versionId: string,
  code: string,
): Promise<ActionResult> {
  return run((db, ctx) => removeLine(db, ctx, versionId, code));
}

export async function moveLineAction(
  versionId: string,
  code: string,
  position: number,
): Promise<ActionResult> {
  return run((db, ctx) => moveLine(db, ctx, versionId, code, Number(position)));
}

export async function setScoringVersionAction(
  versionId: string,
  scoringModelVersionId: string,
): Promise<ActionResult> {
  return run((db, ctx) =>
    setScoringVersion(db, ctx, versionId, scoringModelVersionId),
  );
}

export async function publishFinancialModelAction(
  versionId: string,
  notes: string,
): Promise<ActionResult> {
  return run((db, ctx) =>
    publishFinancialModelVersion(db, ctx, versionId, notes.trim() || undefined),
  );
}

export async function createFinancialModelDraftAction(
  modelId: string,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) =>
    createFinancialModelDraft(db, ctx, modelId),
  );
  if (!result.ok) return result;
  redirect(page(modelId, result.value.number));
}

export async function discardFinancialModelDraftAction(
  modelId: string,
  versionId: string,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) =>
    discardFinancialModelDraft(db, ctx, versionId),
  );
  if (!result.ok) return result;
  redirect(page(modelId));
}
