"use server";

import {
  addPeriod,
  createEntity,
  deleteEntity,
  deletePeriod,
  forceRetainedEarnings,
  pasteSpread,
  previewPaste,
  setDebtSchedule,
  setExistingLoanAdjustments,
  setPeriodControls,
  setValue,
  STATEMENT_QUALITIES,
  updateEntity,
  updatePeriod,
  type ExistingLoanInput,
  type PastePreview,
  type PasteTarget,
  type PeriodControlsInput,
  type PeriodInput,
  type ReconciliationLine,
  type StatementQuality,
} from "@finance/domain";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { adjustmentFields, attempt, invalid, run, text } from "@/lib/actions";

function quality(value: unknown): StatementQuality {
  if (!STATEMENT_QUALITIES.includes(value as StatementQuality)) {
    throw invalid(`"${String(value)}" isn't a statement quality.`);
  }
  return value as StatementQuality;
}

function readPeriod(form: FormData): PeriodInput {
  return {
    periodEnd: text(form, "periodEnd"),
    months: Number(text(form, "months")),
    quality: quality(text(form, "quality")),
    currency: text(form, "currency"),
    consolidated: form.get("consolidated") === "on",
  };
}

// The borrower's fields; a scoring model left blank keeps the current one.
function readEntity(form: FormData) {
  return {
    name: text(form, "name"),
    scoringModelId: text(form, "scoringModelId"),
    industry: text(form, "industry"),
    naicsCode: text(form, "naicsCode"),
    riskRating: text(form, "riskRating"),
    notes: text(form, "notes"),
  };
}

export async function createEntityAction(
  form: FormData,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) =>
    createEntity(db, ctx, readEntity(form)),
  );
  if (!result.ok) return result;
  redirect(`/borrowers/${result.value.id}`);
}

export async function updateEntityAction(
  entityId: string,
  form: FormData,
): Promise<ActionResult> {
  return run((db, ctx) => {
    const { scoringModelId, ...rest } = readEntity(form);
    return updateEntity(db, ctx, entityId, {
      ...rest,
      scoringModelId: scoringModelId || undefined,
    });
  });
}

export async function deleteEntityAction(
  entityId: string,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) => deleteEntity(db, ctx, entityId));
  if (!result.ok) return result;
  redirect("/borrowers");
}

export async function addPeriodAction(
  entityId: string,
  form: FormData,
): Promise<ActionResult> {
  return run((db, ctx) => addPeriod(db, ctx, entityId, readPeriod(form)));
}

// A period's details, and what its statements say beyond the figures: net
// income as printed and the retained earnings reconciliation. Saved
// together, or not at all.
export async function updatePeriodAction(
  periodId: string,
  form: FormData,
): Promise<ActionResult> {
  return run((db, ctx) =>
    db.transaction(async (tx) => {
      await updatePeriod(tx, ctx, periodId, readPeriod(form));
      // Only what the dialog shows: a check the scoring model turns off
      // leaves its figures alone.
      await setPeriodControls(tx, ctx, periodId, {
        reportedNetIncome: form.has("reportedNetIncome")
          ? text(form, "reportedNetIncome")
          : undefined,
        reconciliation: form.has("reconciliation")
          ? reconciliationLines(text(form, "reconciliation"))
          : undefined,
      });
    }),
  );
}

// Saves the reconciliation as typed, then forces retained earnings to roll
// forward with a line for what's left; returns the lines as saved.
export async function forceRetainedEarningsAction(
  periodId: string,
  reconciliation: unknown,
): Promise<ActionResult<ReconciliationLine[]>> {
  const result = await attempt((db, ctx) =>
    db.transaction(async (tx) => {
      await setPeriodControls(tx, ctx, periodId, {
        reconciliation: reconciliationLines(reconciliation),
      });
      return (await forceRetainedEarnings(tx, ctx, periodId)).reconciliation;
    }),
  );
  if (result.ok) refresh();
  return result;
}

// Reconciliation lines as the dialog sends them, as JSON or as a list.
function reconciliationLines(
  raw: unknown,
): PeriodControlsInput["reconciliation"] {
  let lines = raw;
  if (typeof raw === "string") {
    try {
      lines = raw ? JSON.parse(raw) : [];
    } catch {
      throw invalid("The reconciliation couldn't be read.");
    }
  }
  if (!Array.isArray(lines)) throw invalid("The reconciliation is a list.");
  return lines.map((line) => ({
    id: line?.id,
    label: String(line?.label ?? ""),
    amount: String(line?.amount ?? ""),
    forced: line?.forced === true,
  }));
}

export async function deletePeriodAction(
  periodId: string,
): Promise<ActionResult> {
  return run((db, ctx) => deletePeriod(db, ctx, periodId));
}

export async function setValueAction(
  periodId: string,
  code: string,
  raw: string,
): Promise<ActionResult> {
  return run((db, ctx) =>
    setValue(db, ctx, periodId, String(code), String(raw)),
  );
}

export async function previewPasteAction(
  entityId: string,
  source: string,
): Promise<ActionResult<PastePreview>> {
  return attempt((db, ctx) => previewPaste(db, ctx, entityId, String(source)));
}

export async function pasteSpreadAction(
  entityId: string,
  source: string,
  targets: PasteTarget[],
): Promise<ActionResult> {
  return run((db, ctx) => {
    if (!Array.isArray(targets)) throw invalid("Choose the columns to import.");
    const clean = targets.map((t) => ({
      index: Number(t.index),
      periodEnd: String(t.periodEnd),
      months: Number(t.months),
      quality: quality(t.quality),
    }));
    return pasteSpread(db, ctx, entityId, String(source), clean);
  });
}

export async function saveDebtScheduleAction(
  entityId: string,
  schedule: { asOf: string; loans: ExistingLoanInput[] },
): Promise<ActionResult> {
  return run((db, ctx) => {
    if (!Array.isArray(schedule?.loans)) throw invalid("Loans must be a list.");
    return setDebtSchedule(db, ctx, entityId, {
      asOf: String(schedule.asOf ?? ""),
      loans: schedule.loans.map((loan) =>
        Object.fromEntries(
          Object.entries(loan ?? {}).map(([k, v]) => [
            k,
            k === "adjustments" ? adjustmentFields(v ?? []) : String(v ?? ""),
          ]),
        ),
      ),
    });
  });
}

export async function saveLoanAdjustmentsAction(
  entityId: string,
  loanId: string,
  adjustments: unknown[],
): Promise<ActionResult> {
  return run((db, ctx) =>
    setExistingLoanAdjustments(
      db,
      ctx,
      String(entityId),
      String(loanId),
      adjustmentFields(adjustments),
    ),
  );
}
