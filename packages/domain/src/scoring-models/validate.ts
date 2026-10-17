import type { Issue } from "../errors";
import type { ScoringItem } from "./types";

// Codes are referenced by statements and formulas, so they stay simple: no
// spaces or brackets. Case-insensitive duplicates are rejected below.
export const CODE_PATTERN = /^[A-Za-z0-9_.:/-]{1,64}$/;

// Issues a draft can't be saved with: they break identity or the tree itself.
// Every other error is allowed in a draft and only blocks publishing, so a
// model can be built in any order.
const STRUCTURAL = new Set([
  "code_invalid",
  "code_duplicate",
  "label_missing",
  "parent_missing",
  "hierarchy_cycle",
]);

export const isStructural = (issue: Issue) => STRUCTURAL.has(issue.code);

export function validateItems(items: readonly ScoringItem[]): Issue[] {
  const issues: Issue[] = [];
  const error = (code: string, itemCode: string, message: string) =>
    issues.push({ severity: "error", code, itemCode, message });
  const warn = (code: string, itemCode: string, message: string) =>
    issues.push({ severity: "warning", code, itemCode, message });

  const byCode = new Map<string, ScoringItem>();
  const byLowerCode = new Map<string, string>();
  for (const item of items) {
    if (!CODE_PATTERN.test(item.code)) {
      error(
        "code_invalid",
        item.code,
        `Code "${item.code}" must be 1 to 64 letters, digits or _ . : / -.`,
      );
    }
    const prior = byLowerCode.get(item.code.toLowerCase());
    if (prior === undefined) {
      byLowerCode.set(item.code.toLowerCase(), item.code);
      byCode.set(item.code, item);
    } else if (prior === item.code) {
      error(
        "code_duplicate",
        item.code,
        `Code "${item.code}" is used more than once.`,
      );
    } else {
      error(
        "code_duplicate",
        item.code,
        `Codes "${prior}" and "${item.code}" differ only by case.`,
      );
    }
    if (!item.label.trim())
      error("label_missing", item.code, `"${item.code}" has no label.`);
  }

  const children = new Map<string, ScoringItem[]>();
  for (const item of items) {
    if (item.parentCode === null) continue;
    const parent = byCode.get(item.parentCode);
    if (!parent) {
      error(
        "parent_missing",
        item.code,
        `Parent "${item.parentCode}" of "${item.code}" doesn't exist.`,
      );
      continue;
    }
    children.set(parent.code, [...(children.get(parent.code) ?? []), item]);
    if (parent.kind === "input") {
      error(
        "parent_is_input",
        item.code,
        `"${parent.code}" is an input, so "${item.code}" can't sit under it. Make "${parent.code}" a subtotal or a header.`,
      );
    }
    if (parent.kind === "subtotal" && item.kind === "header") {
      error(
        "header_under_subtotal",
        item.code,
        `Header "${item.code}" has no value to roll into subtotal "${parent.code}".`,
      );
    }
    if (parent.statement !== item.statement) {
      error(
        "statement_mismatch",
        item.code,
        `"${item.code}" is on ${item.statement} but its parent "${parent.code}" is on ${parent.statement}.`,
      );
    }
  }

  for (const item of items) {
    const seen = new Set<string>();
    let code = item.parentCode;
    while (code !== null && !seen.has(code)) {
      if (code === item.code) {
        error(
          "hierarchy_cycle",
          item.code,
          `"${item.code}" is its own ancestor.`,
        );
        break;
      }
      seen.add(code);
      code = byCode.get(code)?.parentCode ?? null;
    }
  }

  for (const item of items) {
    const kids = children.get(item.code) ?? [];
    if (item.kind === "header" && kids.length === 0) {
      warn(
        "header_empty",
        item.code,
        `Header "${item.code}" has no items under it.`,
      );
    }
    if (item.kind !== "subtotal") continue;
    if (item.dataType !== "amount" && item.dataType !== "count") {
      error(
        "subtotal_data_type",
        item.code,
        `Subtotal "${item.code}" is a ${item.dataType}; only amounts and counts can be summed.`,
      );
    }
    const summed = kids.filter((kid) => kid.aggregation !== "ignore");
    if (summed.length === 0) {
      error(
        "subtotal_empty",
        item.code,
        `Subtotal "${item.code}" has nothing rolling into it.`,
      );
    }
    for (const kid of summed) {
      if (kid.dataType !== item.dataType) {
        error(
          "child_data_type",
          kid.code,
          `"${kid.code}" is a ${kid.dataType} but rolls into ${item.dataType} subtotal "${item.code}". Change its data type or set its aggregation to ignore.`,
        );
      }
    }
  }

  // Pasted spreads can match lines by label (§5.6), which needs unique labels
  // within a statement.
  const byLabel = new Map<string, ScoringItem[]>();
  for (const item of items) {
    const key = `${item.statement}\u0000${item.label.trim().toLowerCase()}`;
    byLabel.set(key, [...(byLabel.get(key) ?? []), item]);
  }
  for (const group of byLabel.values()) {
    const [first, ...rest] = group;
    if (!first || rest.length === 0 || !first.label.trim()) continue;
    for (const item of rest) {
      warn(
        "label_duplicate",
        item.code,
        `"${item.code}" and "${first.code}" share the label "${item.label}", so pasted lines can't be matched to them by label.`,
      );
    }
  }

  return issues;
}
