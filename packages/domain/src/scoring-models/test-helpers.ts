import { readFileSync } from "node:fs";
import type { ScoringItem } from "./types";

export const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8");

export function item(
  code: string,
  overrides: Partial<ScoringItem> = {},
): ScoringItem {
  return {
    code,
    label: code.toLowerCase(),
    statement: "balance_sheet",
    parentCode: null,
    kind: "input",
    dataType: "amount",
    aggregation: "add",
    expectedSign: "any",
    description: null,
    attributes: {},
    ...overrides,
  };
}
