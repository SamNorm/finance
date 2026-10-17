import type { ScoringItem } from "./types";

// What changed between two item lists, matched by code. Order and attributes
// are left out: they don't change what an item means.

const COMPARED = [
  "label",
  "statement",
  "parentCode",
  "kind",
  "dataType",
  "aggregation",
  "expectedSign",
  "description",
] as const;

export type ComparedField = (typeof COMPARED)[number];

export interface ItemChange {
  code: string;
  changes: {
    field: ComparedField;
    before: string | null;
    after: string | null;
  }[];
}

export interface ItemDiff {
  added: string[];
  removed: string[];
  changed: ItemChange[];
}

export function diffItems(
  before: readonly ScoringItem[],
  after: readonly ScoringItem[],
): ItemDiff {
  const old = new Map(before.map((item) => [item.code, item]));
  const current = new Set(after.map((item) => item.code));
  const diff: ItemDiff = {
    added: [],
    removed: before
      .filter((item) => !current.has(item.code))
      .map((item) => item.code),
    changed: [],
  };
  for (const item of after) {
    const prior = old.get(item.code);
    if (!prior) {
      diff.added.push(item.code);
      continue;
    }
    const changes = COMPARED.filter(
      (field) => prior[field] !== item[field],
    ).map((field) => ({
      field,
      before: prior[field],
      after: item[field],
    }));
    if (changes.length) diff.changed.push({ code: item.code, changes });
  }
  return diff;
}
