import type { schema } from "@finance/db";

export type FinancialModel = typeof schema.financialModels.$inferSelect;
export type FinancialModelVersion =
  typeof schema.financialModelVersions.$inferSelect;

// A line as the domain sees it; its position is its index in the list.
export type ModelLine = Omit<
  typeof schema.financialModelLines.$inferSelect,
  "versionId" | "position"
>;

export type LineKind = ModelLine["kind"];
export type LineFormat = ModelLine["format"];
