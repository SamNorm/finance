"use server";

import {
  definitionAsTyped,
  getBorrowingBase,
  importBorrowingBasePaste,
  previewBorrowingBasePaste,
  removeBorrowingBaseMonth,
  setBorrowingBaseDefinition,
  setBorrowingBaseMonth,
  setBorrowingBaseTerm,
  setBorrowingBaseValues,
  startBorrowingBase,
  updateCreditLine,
  type BorrowingBasePaste,
  type BorrowingBaseQuality,
  type Issue,
} from "@finance/domain";
import { refresh } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { attempt, invalid, run, termFields } from "@/lib/actions";

// A margined line's borrowing base: its figures month by month, each
// month's certificate, and its definition. Thin wrappers over the domain,
// as the borrower's actions are.

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Figures by month and code, as typed; blank clears one.
export async function setBorrowingBaseValuesAction(
  lineId: string,
  entries: { month: string; code: string; value: string }[],
): Promise<ActionResult> {
  return run((db, ctx) => {
    if (!Array.isArray(entries)) throw invalid("Figures must be a list.");
    return setBorrowingBaseValues(
      db,
      ctx,
      String(lineId),
      entries.map((e) => ({
        month: String(e?.month ?? ""),
        code: String(e?.code ?? ""),
        value: e?.value === null ? null : String(e?.value ?? ""),
      })),
    );
  });
}

// A month's quality, the day its certificate came in and a note, adding the
// month when it isn't there.
export async function setBorrowingBaseMonthAction(
  lineId: string,
  month: string,
  fields: { quality?: string; receivedOn?: string; note?: string },
): Promise<ActionResult> {
  return run((db, ctx) => {
    if (!isObject(fields)) throw invalid("A month is a set of fields.");
    return setBorrowingBaseMonth(db, ctx, String(lineId), String(month), {
      quality:
        fields.quality === undefined
          ? undefined
          : (String(fields.quality) as BorrowingBaseQuality),
      receivedOn:
        fields.receivedOn === undefined ? undefined : String(fields.receivedOn),
      note: fields.note === undefined ? undefined : String(fields.note),
    });
  });
}

export async function removeBorrowingBaseMonthAction(
  lineId: string,
  month: string,
): Promise<ActionResult> {
  return run((db, ctx) =>
    removeBorrowingBaseMonth(db, ctx, String(lineId), String(month)),
  );
}

// A certificate or a history pasted, read without saving anything.
export async function previewBorrowingBasePasteAction(
  lineId: string,
  text: string,
): Promise<ActionResult<BorrowingBasePaste>> {
  return attempt((db, ctx) =>
    previewBorrowingBasePaste(db, ctx, String(lineId), String(text ?? "")),
  );
}

// Saves a paste's figures; `months` gives a month to columns whose header
// didn't, and `skip` leaves columns out, by column index.
export async function importBorrowingBasePasteAction(
  lineId: string,
  text: string,
  months: Record<number, string>,
  skip: number[] = [],
): Promise<ActionResult<{ figures: number; months: string[] }>> {
  const result = await attempt(async (db, ctx) => {
    if (!isObject(months)) throw invalid("Give columns' months by column.");
    if (!Array.isArray(skip)) throw invalid("Columns left out are a list.");
    const { figures, months: saved } = await importBorrowingBasePaste(
      db,
      ctx,
      String(lineId),
      String(text ?? ""),
      Object.fromEntries(
        Object.entries(months).map(([index, month]) => [
          Number(index),
          String(month ?? ""),
        ]),
      ),
      skip.map(Number),
    );
    return { figures, months: saved };
  });
  if (result.ok) refresh();
  return result;
}

// A definition as the editor sends it: its lines' fields and its tests as
// typed, terms and thresholds as an amount or with seasons and steps.
// Charts go through as they are; the domain reads them strictly.
function definitionFields(raw: unknown) {
  if (!isObject(raw)) throw invalid("A borrowing base is a set of fields.");
  if (!Array.isArray(raw.lines)) throw invalid("Its lines must be a list.");
  if (raw.tests !== undefined && !Array.isArray(raw.tests))
    throw invalid("Its tests must be a list.");
  return {
    ...raw,
    lines: raw.lines.map((line) => {
      if (!isObject(line)) throw invalid("Each line is a set of fields.");
      const terms = Object.fromEntries(
        (["rate", "cap", "amount"] as const)
          .filter((name) => line[name] !== undefined && line[name] !== null)
          .map((name) => [name, termFields(line[name])]),
      );
      return { ...line, ...terms };
    }),
    ...(raw.tests
      ? {
          tests: raw.tests.map((test: unknown) => {
            if (!isObject(test)) throw invalid("Each test is a set of fields.");
            return { ...test, threshold: termFields(test.threshold) };
          }),
        }
      : {}),
  };
}

// Lines renamed in the editor, old code → new, so their figures follow.
function renameFields(raw: unknown): Record<string, string> {
  if (!isObject(raw)) throw invalid("Renamed lines are given by code.");
  return Object.fromEntries(
    Object.entries(raw).map(([from, to]) => [from, String(to ?? "")]),
  );
}

// Saves the whole definition, or none to stop margining the line (its
// months are kept). Errors refuse it; warnings come back.
export async function setBorrowingBaseDefinitionAction(
  lineId: string,
  definition: unknown,
  renames: Record<string, string> = {},
): Promise<ActionResult<Issue[]>> {
  const result = await attempt(async (db, ctx) => {
    const { issues } = await setBorrowingBaseDefinition(
      db,
      ctx,
      String(lineId),
      definition === null ? null : definitionFields(definition),
      renameFields(renames),
    );
    return issues;
  });
  if (result.ok) refresh();
  return result;
}

// Replaces the borrowing base's charts, the rest of its definition as
// saved. With none, it shows the default charts.
export async function saveBorrowingBaseChartsAction(
  lineId: string,
  charts: unknown,
): Promise<ActionResult> {
  return run(async (db, ctx) => {
    if (!Array.isArray(charts)) throw invalid("Charts must be a list.");
    const { definition } = await getBorrowingBase(db, ctx, String(lineId));
    return setBorrowingBaseDefinition(db, ctx, String(lineId), {
      ...definitionAsTyped(definition),
      charts,
    });
  });
}

// Changes an advance rate, a cap or a reserve's amount from a month on, or
// from the start when no month is given.
export async function setBorrowingBaseTermAction(
  lineId: string,
  input: { code: string; term: string; value: string; from: string | null },
): Promise<ActionResult<Issue[]>> {
  const result = await attempt(async (db, ctx) => {
    if (!isObject(input)) throw invalid("A term change is a set of fields.");
    const term = String(input.term);
    if (term !== "rate" && term !== "cap" && term !== "amount")
      throw invalid(`"${term}" isn't a term of a borrowing base.`);
    const { issues } = await setBorrowingBaseTerm(db, ctx, String(lineId), {
      code: String(input.code ?? ""),
      term,
      value: input.value === null ? null : String(input.value ?? ""),
      from: input.from ? String(input.from) : null,
    });
    return issues;
  });
  if (result.ok) refresh();
  return result;
}

// Starts a line's borrowing base from a built-in, one of the
// organization's templates or another line's, replacing any it has. The
// dialog then opens its terms.
export async function startBorrowingBaseAction(
  lineId: string,
  from: { builtIn: string } | { templateId: string } | { lineId: string },
): Promise<ActionResult> {
  const result = await attempt((db, ctx) => {
    const raw: unknown = from;
    if (!isObject(raw)) throw invalid("Choose what to start from.");
    return startBorrowingBase(
      db,
      ctx,
      String(lineId),
      typeof raw.builtIn === "string"
        ? { builtIn: raw.builtIn }
        : typeof raw.templateId === "string"
          ? { templateId: raw.templateId }
          : { lineId: String(raw.lineId ?? "") },
    );
  });
  if (!result.ok) return result;
  refresh();
  return { ok: true, value: undefined };
}

// The line's own terms, from its borrowing base's page: its limit and the
// days after a month's end its certificate is due.
export async function updateMarginedLineAction(
  lineId: string,
  fields: { limit: unknown; certificateDueDays: string },
): Promise<ActionResult> {
  return run((db, ctx) => {
    if (!isObject(fields)) throw invalid("A line is a set of fields.");
    return updateCreditLine(db, ctx, String(lineId), {
      limit: termFields(fields.limit),
      certificateDueDays: String(fields.certificateDueDays ?? ""),
    });
  });
}
