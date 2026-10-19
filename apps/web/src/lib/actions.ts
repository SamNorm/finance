import "server-only";
import type { Db } from "@finance/db";
import {
  DomainError,
  type Context,
  type CreditLineInput,
  type ProposedLineInput,
  type TermInput,
} from "@finance/domain";
import { refresh } from "next/cache";
import type { ActionResult } from "./action-result";
import { getContext, getDb } from "./server";

// Helpers for server actions, which are thin wrappers over the domain package.
// Inputs are untrusted: every action resolves the caller's context itself and
// passes only IDs and field values on.

// Runs a change. Domain errors come back as values for the UI to show;
// anything else is a bug and throws.
export async function attempt<T>(
  work: (db: Db, ctx: Context) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await work(getDb(), await getContext()) };
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, message: error.message, issues: error.issues };
    }
    throw error;
  }
}

// Runs a change and re-renders the current page in the same response.
export async function run(
  work: (db: Db, ctx: Context) => Promise<unknown>,
): Promise<ActionResult> {
  const result = await attempt(work);
  if (!result.ok) return result;
  refresh();
  return { ok: true, value: undefined };
}

export const invalid = (message: string) => new DomainError("invalid", message);

// A loan's schedule adjustments, each a set of fields as text.
export function adjustmentFields(list: unknown): Record<string, string>[] {
  if (!Array.isArray(list)) throw invalid("Adjustments must be a list.");
  return list.map((entry) =>
    Object.fromEntries(
      Object.entries(entry ?? {}).map(([k, v]) => [k, String(v ?? "")]),
    ),
  );
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// A term as the client sends it: an amount, or one with seasons (months as
// numbers) and steps, values as text.
export function termFields(raw: unknown): TermInput {
  if (!isObject(raw)) return String(raw ?? "");
  const list = (value: unknown, what: string) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw invalid(`${what} must be a list.`);
    return value.map((entry) => (isObject(entry) ? entry : {}));
  };
  const seasons = (value: unknown) =>
    list(value, "Seasons").map((s) => ({
      months: Array.isArray(s.months)
        ? s.months.map(Number)
        : String(s.months ?? ""),
      value: String(s.value ?? ""),
    }));
  return {
    value: String(raw.value ?? ""),
    seasons: seasons(raw.seasons),
    steps: list(raw.steps, "Steps").map((s) => ({
      from: String(s.from ?? ""),
      value: String(s.value ?? ""),
      seasons: seasons(s.seasons),
    })),
  };
}

// A line of credit's fields as the client sends them. A closing date or
// certificate due days left out stay as they are.
export function creditLineFields(raw: unknown): CreditLineInput {
  if (!isObject(raw)) throw invalid("A line of credit is a set of fields.");
  return {
    name: String(raw.name ?? ""),
    currency: String(raw.currency ?? ""),
    limit: termFields(raw.limit),
    rate: String(raw.rate ?? ""),
    closedOn:
      raw.closedOn === undefined ? undefined : String(raw.closedOn ?? ""),
    certificateDueDays:
      raw.certificateDueDays === undefined
        ? undefined
        : String(raw.certificateDueDays ?? ""),
  };
}

// A line a scenario proposes: a line's fields, the id of the line in force
// it changes or a new line's, and whether the deal closes it.
export function proposedLineFields(raw: unknown): ProposedLineInput {
  const fields = creditLineFields(raw);
  const { id, closed } = raw as Record<string, unknown>;
  return {
    ...fields,
    id: typeof id === "string" ? id : undefined,
    closed: closed === true,
  };
}

// Usage assumed for lines of credit, by line id: a share and amounts by
// month, as text.
export function lineUsageFields(raw: unknown) {
  if (!isObject(raw)) throw invalid("Line usage is given by line.");
  return Object.fromEntries(
    Object.entries(raw).map(([id, usage]) => {
      if (usage === null) return [id, null];
      if (!isObject(usage))
        throw invalid("Give a line's usage as a share and months.");
      const { share, months } = usage;
      if (months !== undefined && months !== null && !isObject(months))
        throw invalid("Give months' usage by month.");
      return [
        id,
        {
          share: share === undefined || share === null ? "" : String(share),
          months:
            months &&
            Object.fromEntries(
              Object.entries(months).map(([month, v]) => [
                month,
                v === null ? "" : String(v),
              ]),
            ),
        },
      ];
    }),
  );
}

export function text(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}
