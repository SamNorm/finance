import "server-only";
import type { Db } from "@finance/db";
import { DomainError, type Context } from "@finance/domain";
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

export function text(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}
