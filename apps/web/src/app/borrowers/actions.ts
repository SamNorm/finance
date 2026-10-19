"use server";

import {
  addConsolidatedPeriod,
  addConsolidationMember,
  addCreditLine,
  addPeriod,
  createConsolidatedClient,
  createEntity,
  deleteEntity,
  deletePeriod,
  forceRetainedEarnings,
  pasteSpread,
  previewPaste,
  removeConsolidationMember,
  removeCreditLine,
  setConsolidatedStatements,
  setCovenants,
  setDebtSchedule,
  setEliminations,
  setExistingLoanAdjustments,
  setItemEliminations,
  setPeriodControls,
  setValue,
  STATEMENT_QUALITIES,
  updateCreditLine,
  updateEntity,
  updatePeriod,
  type CovenantInput,
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
import {
  adjustmentFields,
  attempt,
  creditLineFields,
  invalid,
  run,
  text,
} from "@/lib/actions";

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

export async function createConsolidatedClientAction(
  form: FormData,
): Promise<ActionResult> {
  const result = await attempt((db, ctx) =>
    createConsolidatedClient(db, ctx, {
      ...readEntity(form),
      memberIds: form.getAll("memberIds").map(String),
    }),
  );
  if (!result.ok) return result;
  redirect(`/borrowers/${result.value.id}`);
}

export async function addConsolidationMemberAction(
  entityId: string,
  memberId: string,
): Promise<ActionResult> {
  return run((db, ctx) =>
    addConsolidationMember(db, ctx, String(entityId), String(memberId)),
  );
}

export async function removeConsolidationMemberAction(
  entityId: string,
  memberId: string,
): Promise<ActionResult> {
  return run((db, ctx) =>
    removeConsolidationMember(db, ctx, String(entityId), String(memberId)),
  );
}

// A consolidated period as its dialog sends it: its end and length, the
// statement chosen for each member (null for none), its eliminations and its
// own retained earnings lines.
export interface ConsolidatedPeriodForm {
  periodEnd: string;
  months: string;
  statements: { memberId: string; periodId: string | null }[];
  eliminations: { id?: string; name: string; item: string; amount: string }[];
  reconciliation: { id?: string; label: string; amount: string }[];
}

// Adds or changes a consolidated period, whole or not at all.
export async function saveConsolidatedPeriodAction(
  entityId: string,
  periodId: string | null,
  input: ConsolidatedPeriodForm,
): Promise<ActionResult> {
  return run((db, ctx) => {
    const list = <T>(value: unknown, what: string): T[] => {
      if (!Array.isArray(value)) throw invalid(`${what} must be a list.`);
      return value as T[];
    };
    const statements = list<ConsolidatedPeriodForm["statements"][number]>(
      input?.statements,
      "Statements",
    ).map((s) => ({
      memberId: String(s?.memberId ?? ""),
      periodId: s?.periodId ? String(s.periodId) : null,
    }));
    const eliminations = list<Record<string, unknown>>(
      input.eliminations,
      "Eliminations",
    ).map((e) => ({
      id: e?.id,
      name: String(e?.name ?? ""),
      item: String(e?.item ?? ""),
      amount: String(e?.amount ?? ""),
    }));
    const reconciliation = reconciliationLines(
      list(input.reconciliation, "Reconciliation lines"),
    );
    const period = {
      periodEnd: String(input.periodEnd ?? ""),
      months: Number(input.months),
    };
    return db.transaction(async (tx) => {
      let id = periodId ? String(periodId) : null;
      if (id) {
        await updatePeriod(tx, ctx, id, period);
        await setConsolidatedStatements(tx, ctx, id, statements);
      } else {
        id = (
          await addConsolidatedPeriod(tx, ctx, String(entityId), {
            ...period,
            statements: statements.flatMap((s) =>
              s.periodId
                ? [{ memberId: s.memberId, periodId: s.periodId }]
                : [],
            ),
          })
        ).id;
      }
      await setEliminations(tx, ctx, id, eliminations);
      await setPeriodControls(tx, ctx, id, { reconciliation });
    });
  });
}

// Replaces the borrower's covenants in force, each as typed.
export async function saveCovenantsAction(
  entityId: string,
  covenants: CovenantInput[],
): Promise<ActionResult> {
  return run((db, ctx) => {
    if (!Array.isArray(covenants)) throw invalid("Covenants must be a list.");
    return setCovenants(db, ctx, String(entityId), covenants);
  });
}

// Replaces the eliminations on one item of a consolidated period, as the
// worksheet edits them; the period's others stay.
export async function setItemEliminationsAction(
  periodId: string,
  item: string,
  entries: { id?: string; name?: string; amount: string }[],
): Promise<ActionResult> {
  return run((db, ctx) => {
    if (!Array.isArray(entries)) throw invalid("Eliminations must be a list.");
    return setItemEliminations(
      db,
      ctx,
      String(periodId),
      String(item),
      entries.map((e) => ({
        id: e?.id,
        name: String(e?.name ?? ""),
        amount: String(e?.amount ?? ""),
      })),
    );
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

// A borrower's lines of credit, a line at a time, as typed.
export async function addCreditLineAction(
  entityId: string,
  line: unknown,
): Promise<ActionResult> {
  return run((db, ctx) =>
    addCreditLine(db, ctx, String(entityId), creditLineFields(line)),
  );
}

export async function updateCreditLineAction(
  lineId: string,
  line: unknown,
): Promise<ActionResult> {
  return run((db, ctx) =>
    updateCreditLine(db, ctx, String(lineId), creditLineFields(line)),
  );
}

export async function removeCreditLineAction(
  lineId: string,
): Promise<ActionResult> {
  return run((db, ctx) => removeCreditLine(db, ctx, String(lineId)));
}
