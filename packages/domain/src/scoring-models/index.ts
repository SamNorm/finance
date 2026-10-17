export * from "./types";
export {
  diffItems,
  type ComparedField,
  type ItemChange,
  type ItemDiff,
} from "./diff";
export type { ItemPatch, NewScoringItem } from "./edit";
export { parseItemTable, type ParseResult } from "./parse";
export * from "./service";
export { isStructural, validateItems } from "./validate";
