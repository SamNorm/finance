import { checkModel, Dec, type Value } from "@finance/engine";
import type { Issue } from "../errors";
import { CODE_PATTERN } from "../scoring-models/validate";
import { parseValue } from "../spreads/values";
import type { LineFormat, LineKind, ModelLine } from "./types";

// Issues a draft can't be saved with; formula problems only block publishing,
// so a model can be written in any order.
const STRUCTURAL = new Set(["code_invalid", "code_duplicate", "label_missing"]);
export const isStructuralLineIssue = (issue: Issue) =>
  STRUCTURAL.has(issue.code);

// An assumption's value as typed, made canonical: numbers as decimal strings
// ("5%" → "0.05"), flags as TRUE or FALSE, text as is.
export function normalizeAssumption(
  raw: string,
  format: LineFormat,
): { value: string | null } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null };
  if (format === "text") return { value: trimmed };
  if (format === "flag") {
    const upper = trimmed.toUpperCase();
    if (["TRUE", "YES", "1"].includes(upper)) return { value: "TRUE" };
    if (["FALSE", "NO", "0"].includes(upper)) return { value: "FALSE" };
    return { error: `"${trimmed}" isn't TRUE or FALSE.` };
  }
  return parseValue(trimmed, format);
}

// The value an assumption feeds the engine.
export function assumptionValue(raw: string | null, format: LineFormat): Value {
  if (raw === null) return null;
  if (format === "flag") return raw === "TRUE";
  if (format === "text") return raw;
  return new Dec(raw);
}

export function validateLines(
  lines: readonly ModelLine[],
  inputCodes: readonly string[],
): Issue[] {
  const issues: Issue[] = [];
  const error = (code: string, itemCode: string, message: string) =>
    issues.push({ severity: "error", code, itemCode, message });

  const seen = new Map<string, string>();
  for (const line of lines) {
    if (!CODE_PATTERN.test(line.code)) {
      error(
        "code_invalid",
        line.code,
        `Code "${line.code}" must be 1 to 64 letters, digits or _ . : / -.`,
      );
    }
    const prior = seen.get(line.code.toUpperCase());
    if (prior !== undefined) {
      error(
        "code_duplicate",
        line.code,
        prior === line.code
          ? `Code "${line.code}" is used more than once.`
          : `Codes "${prior}" and "${line.code}" differ only by case.`,
      );
    } else {
      seen.set(line.code.toUpperCase(), line.code);
    }
    if (!line.label.trim())
      error("label_missing", line.code, `"${line.code}" has no label.`);
    if (line.kind === "input" && line.breaksDown !== null) {
      if (!inputCodes.includes(line.breaksDown)) {
        error(
          "breaks_down_unknown",
          line.code,
          `"${line.label}" breaks down "${line.breaksDown}", which isn't an item of the scoring model.`,
        );
      } else if (line.format !== "amount" && line.format !== "count") {
        error(
          "breaks_down_format",
          line.code,
          `"${line.label}" breaks down an item, so it must be an amount or a count.`,
        );
      }
    }
    // A blank assumption is allowed: a scenario can give it a value, year by
    // year, and formulas fall back with ISBLANK where none is given.
    if (line.kind === "assumption" && line.defaultValue !== null) {
      const parsed = normalizeAssumption(line.defaultValue, line.format);
      if ("error" in parsed) error("assumption_value", line.code, parsed.error);
    }
  }

  const formulaLines = lines.filter((l) => l.kind !== "header");
  for (const issue of checkModel(
    formulaLines.map((l) => ({
      code: l.code,
      kind: l.kind as Exclude<LineKind, "header">,
      formula: l.formula,
      projectionFormula: l.projectionFormula,
    })),
    inputCodes,
  )) {
    error(
      "formula",
      issue.lineCode,
      issue.field === "projectionFormula"
        ? `Projection formula: ${issue.message}`
        : issue.message,
    );
  }
  return issues;
}
