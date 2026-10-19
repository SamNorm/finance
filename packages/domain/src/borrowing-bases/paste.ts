import type { Issue } from "../errors";
import type { ScoringItem } from "../scoring-models/types";
import { parseSpreadPaste, type PasteRow } from "../spreads/paste";
import type { WaterfallRow } from "./compile";

// A borrowing base certificate, or a history of them, pasted out of Excel or
// a CSV (borrowing-base-plan.md §7.2): rows matched to the entered lines by
// code or exact label, as a spread paste matches items (a label used twice,
// such as an aging bucket's, takes the next match in the borrowing base's
// order), and columns of figures read as months from their headers.

export interface BorrowingBasePasteColumn {
  index: number;
  header: string;
  // "YYYY-MM", when the header reads as a date.
  month: string | null;
  // Day and month order assumed, for the analyst to confirm.
  guessed: boolean;
}

export interface BorrowingBasePaste {
  columns: BorrowingBasePasteColumn[];
  matched: PasteRow[];
  unmatched: PasteRow[];
  issues: Issue[];
}

export function parseBorrowingBasePaste(
  text: string,
  inputs: readonly WaterfallRow[],
): BorrowingBasePaste {
  // The spread's parser reads codes, labels and data types alone.
  const items = inputs.map(
    (row) =>
      ({
        code: row.code,
        label: row.label,
        dataType: row.format === "ratio" ? "ratio" : "amount",
      }) as ScoringItem,
  );
  const parsed = parseSpreadPaste(text, items);
  return {
    columns: parsed.columns.map((c) => ({
      index: c.index,
      header: c.header,
      month: c.periodEnd?.slice(0, 7) ?? null,
      guessed: c.guessed,
    })),
    matched: parsed.matched,
    unmatched: parsed.unmatched,
    issues: parsed.issues,
  };
}
