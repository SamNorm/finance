"use server";

import {
  fillLineUsage,
  fillSeasonalAssumption,
  importProjectedBorrowingBasePaste,
  previewProjectedBorrowingBasePaste,
  setAnalysisBorrowingBase,
  setProjectedBorrowingBaseValues,
  setScenarioBorrowingBase,
  type BorrowingBasePaste,
} from "@finance/domain";
import { refresh } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { attempt, invalid, run } from "@/lib/actions";

// Borrowing bases projected in an analysis (borrowing-base-plan.md §8): how
// each margined line is projected, the client's projected figures, a
// scenario's changes, and filling usage or a season once. Thin wrappers
// over the domain, as the analysis's other actions are.

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Values by code as typed: one for every month, and one per calendar month
// (the analysis's) or per month "YYYY-MM" (a scenario's).
function assumptionFields(raw: unknown) {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) throw invalid("Give assumptions by code.");
  return Object.fromEntries(
    Object.entries(raw).map(([code, given]) => {
      if (given === null) return [code, null];
      if (!isObject(given))
        throw invalid("Give an assumption's value, or its values by month.");
      const { value, byMonth, months } = given;
      if (byMonth !== undefined && !Array.isArray(byMonth))
        throw invalid("Give a value for each calendar month.");
      if (months !== undefined && !isObject(months))
        throw invalid("Give values by month.");
      return [
        code,
        {
          ...(value === undefined ? {} : { value: String(value ?? "") }),
          ...(byMonth
            ? { byMonth: byMonth.map((v: unknown) => String(v ?? "")) }
            : {}),
          ...(months
            ? {
                months: Object.fromEntries(
                  Object.entries(months).map(([m, v]) => [m, String(v ?? "")]),
                ),
              }
            : {}),
        },
      ];
    }),
  );
}

// Where a line's projection comes from, over how many months, and the base
// case's assumption values.
export async function setAnalysisBorrowingBaseAction(
  analysisId: string,
  key: string,
  input: { source?: string; months?: number; assumptions?: unknown },
): Promise<ActionResult> {
  return run((db, ctx) => {
    if (!isObject(input)) throw invalid("Settings are a set of fields.");
    return setAnalysisBorrowingBase(db, ctx, String(analysisId), String(key), {
      source: input.source === undefined ? undefined : String(input.source),
      months: input.months === undefined ? undefined : Number(input.months),
      assumptions: assumptionFields(input.assumptions),
    });
  });
}

// A scenario's own assumption values and figures for a line, replacing
// those it had; null clears them.
export async function setScenarioBorrowingBaseAction(
  scenarioId: string,
  key: string,
  input: { assumptions?: unknown; figures?: unknown } | null,
): Promise<ActionResult> {
  return run((db, ctx) => {
    if (input !== null && !isObject(input))
      throw invalid("A scenario's changes are a set of fields.");
    if (input?.figures !== undefined && !isObject(input.figures))
      throw invalid("Give figures by month, then code.");
    return setScenarioBorrowingBase(
      db,
      ctx,
      String(scenarioId),
      String(key),
      input && {
        assumptions: assumptionFields(input.assumptions),
        figures:
          input.figures &&
          Object.fromEntries(
            Object.entries(input.figures).map(([month, codes]) => {
              if (!isObject(codes)) throw invalid("Give figures by code.");
              return [
                month,
                Object.fromEntries(
                  Object.entries(codes).map(([c, v]) => [c, String(v ?? "")]),
                ),
              ];
            }),
          ),
      },
    );
  });
}

// The client's projected figures by month and code, as typed; blank clears
// one.
export async function setProjectedBorrowingBaseValuesAction(
  analysisId: string,
  key: string,
  entries: { month: string; code: string; value: string }[],
): Promise<ActionResult> {
  return run((db, ctx) => {
    if (!Array.isArray(entries)) throw invalid("Figures must be a list.");
    return setProjectedBorrowingBaseValues(
      db,
      ctx,
      String(analysisId),
      String(key),
      entries.map((e) => ({
        month: String(e?.month ?? ""),
        code: String(e?.code ?? ""),
        value: e?.value === null ? null : String(e?.value ?? ""),
      })),
    );
  });
}

// The client's projections pasted, read without saving anything.
export async function previewProjectedBorrowingBasePasteAction(
  analysisId: string,
  key: string,
  text: string,
): Promise<ActionResult<BorrowingBasePaste>> {
  return attempt((db, ctx) =>
    previewProjectedBorrowingBasePaste(
      db,
      ctx,
      String(analysisId),
      String(key),
      String(text ?? ""),
    ),
  );
}

// Saves the pasted projections; `months` gives a month to columns whose
// header didn't, by column index.
export async function importProjectedBorrowingBasePasteAction(
  analysisId: string,
  key: string,
  text: string,
  months: Record<number, string>,
): Promise<ActionResult<{ figures: number; months: string[] }>> {
  const result = await attempt((db, ctx) => {
    if (!isObject(months)) throw invalid("Give columns' months by column.");
    return importProjectedBorrowingBasePaste(
      db,
      ctx,
      String(analysisId),
      String(key),
      String(text ?? ""),
      Object.fromEntries(
        Object.entries(months).map(([index, month]) => [
          Number(index),
          String(month ?? ""),
        ]),
      ),
    );
  });
  if (result.ok) refresh();
  return result;
}

// Fills a line's usage month by month, once, from the certificates' same
// months a year earlier or from the balance projected: the analysis's, or
// the scenario's when one is given.
export async function fillLineUsageAction(
  analysisId: string,
  scenarioId: string | null,
  key: string,
  from: string,
): Promise<ActionResult> {
  return run((db, ctx) => {
    if (from !== "certificates" && from !== "projection")
      throw invalid("Fill from the certificates or the projection.");
    return fillLineUsage(
      db,
      ctx,
      {
        analysisId: String(analysisId),
        scenarioId: scenarioId ? String(scenarioId) : null,
      },
      String(key),
      from,
    );
  });
}

// Fills a seasonal assumption once: each calendar month's share of a
// typical month of a figure, over the last three years of certificates.
export async function fillSeasonalAssumptionAction(
  analysisId: string,
  key: string,
  assumption: string,
  from: string,
): Promise<ActionResult> {
  return run((db, ctx) =>
    fillSeasonalAssumption(
      db,
      ctx,
      String(analysisId),
      String(key),
      String(assumption),
      String(from),
    ),
  );
}
