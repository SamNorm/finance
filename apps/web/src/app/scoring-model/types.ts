import type { Issue, ItemChange, Statement } from "@finance/domain";

export type { ActionResult } from "@/lib/action-result";

export interface ImportPreview {
  total: number;
  statements: { statement: Statement; items: number; subtotals: number }[];
  // Parse and validation issues, with the spreadsheet row when known.
  issues: Issue[];
  // Compared with the latest published version, when there is one.
  diff: {
    against: number;
    added: string[];
    removed: string[];
    changed: ItemChange[];
  } | null;
  canImport: boolean;
}
