import type { schema } from "@finance/db";

export type ScoringModel = typeof schema.scoringModels.$inferSelect;
export type ScoringModelVersion =
  typeof schema.scoringModelVersions.$inferSelect;

// An item as the domain sees it. Its position is its index in the item list,
// so an ordered array of items is the whole layout of a version.
export type ScoringItem = Omit<
  typeof schema.scoringModelItems.$inferSelect,
  "versionId" | "position"
>;

export type Statement = ScoringItem["statement"];
export type ItemKind = ScoringItem["kind"];
export type ItemDataType = ScoringItem["dataType"];
export type ItemAggregation = ScoringItem["aggregation"];
export type ItemSign = ScoringItem["expectedSign"];
