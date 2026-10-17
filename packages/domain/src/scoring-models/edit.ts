import { DomainError } from "../errors";
import type { ScoringItem } from "./types";

// Pure edits on an ordered item list. They return a new list and leave
// validation to the caller, so a draft can pass through invalid states.

export type NewScoringItem = Pick<ScoringItem, "code" | "label" | "statement"> &
  Partial<ScoringItem>;

export type ItemPatch = Partial<ScoringItem>;

function indexOf(items: readonly ScoringItem[], code: string) {
  const index = items.findIndex((item) => item.code === code);
  if (index === -1)
    throw new DomainError("not_found", `No item with code "${code}".`);
  return index;
}

const clamp = (position: number | undefined, length: number) =>
  position === undefined
    ? length
    : Math.max(0, Math.min(Math.trunc(position), length));

export function insertItem(
  items: readonly ScoringItem[],
  item: NewScoringItem,
  position?: number,
): ScoringItem[] {
  const next = [...items];
  next.splice(clamp(position, items.length), 0, {
    parentCode: null,
    kind: "input",
    dataType: "amount",
    aggregation: "add",
    expectedSign: "any",
    description: null,
    attributes: {},
    ...item,
  });
  return next;
}

// Renaming a code re-points the children at the new code.
export function updateItem(
  items: readonly ScoringItem[],
  code: string,
  patch: ItemPatch,
): ScoringItem[] {
  const index = indexOf(items, code);
  const renamed =
    patch.code !== undefined && patch.code !== code ? patch.code : undefined;
  return items.map((item, i) => {
    if (i === index) return { ...item, ...patch };
    if (renamed && item.parentCode === code)
      return { ...item, parentCode: renamed };
    return item;
  });
}

export function removeItem(
  items: readonly ScoringItem[],
  code: string,
): ScoringItem[] {
  const index = indexOf(items, code);
  const children = items
    .filter((item) => item.parentCode === code)
    .map((item) => item.code);
  if (children.length) {
    throw new DomainError(
      "conflict",
      `"${code}" still has items under it (${children.join(", ")}). Move or remove them first.`,
    );
  }
  return items.filter((_, i) => i !== index);
}

export function moveItem(
  items: readonly ScoringItem[],
  code: string,
  position: number,
): ScoringItem[] {
  const index = indexOf(items, code);
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(clamp(position, next.length), 0, item!);
  return next;
}
