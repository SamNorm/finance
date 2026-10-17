import type { Issue } from "../errors";
import type { ScoringItem } from "../scoring-models/types";
import { readTable } from "../tabular";
import { parsePeriodHeader, parseValue } from "./values";

// Reads a spread pasted from the scoring system (§5.6). Rows are matched to
// items with no mapping: by code, or by exact label. A label used on two
// statements (e.g. "Net income") resolves to the next match in layout order,
// since the paste follows the source system's layout. Columns of figures are
// periods; their headers give the period ends when they can be read.

export interface PasteColumn {
  // Column index in the pasted table.
  index: number;
  header: string;
  periodEnd: string | null;
  months: number | null;
  guessed: boolean;
}

export interface PasteRow {
  // 1-based row in the pasted table.
  row: number;
  label: string;
  code: string | null;
  // Raw cell per value column, in the order of `columns`.
  cells: string[];
}

export interface PasteParse {
  columns: PasteColumn[];
  matched: PasteRow[];
  // Rows with figures that match no item.
  unmatched: PasteRow[];
  issues: Issue[];
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[:*]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

const isFigure = (cell: string) => {
  const parsed = parseValue(cell, "amount");
  return "value" in parsed && parsed.value !== null;
};

export function parseSpreadPaste(
  text: string,
  items: readonly ScoringItem[],
): PasteParse {
  const table = readTable(text);
  const issues = [...table.issues];
  const rows = table.rows
    .map((cells, i) => ({ cells: cells.map((c) => c.trim()), row: i + 1 }))
    .filter(({ cells }) => cells.some(Boolean));
  if (!rows.length) {
    return {
      columns: [],
      matched: [],
      unmatched: [],
      issues: [...issues, error("Nothing was pasted.")],
    };
  }

  // Figure columns: mostly numbers below the first row. Everything left of the
  // first one identifies the line (label, code, or both).
  const width = Math.max(...rows.map((r) => r.cells.length));
  const figureColumns: number[] = [];
  for (let c = 1; c < width; c++) {
    const cells = rows
      .slice(1)
      .map((r) => r.cells[c] ?? "")
      .filter(Boolean);
    const figures = cells.filter(isFigure).length;
    if (figures > 0 && figures >= cells.length * 0.6) figureColumns.push(c);
  }
  if (!figureColumns.length) {
    return {
      columns: [],
      matched: [],
      unmatched: [],
      issues: [
        ...issues,
        error(
          "No columns of figures found. Paste the labels with at least one column of amounts.",
        ),
      ],
    };
  }
  const firstFigure = figureColumns[0]!;

  const byCode = new Map(items.map((item) => [item.code.toUpperCase(), item]));
  const position = new Map(items.map((item, i) => [item.code, i]));
  const byLabel = new Map<string, ScoringItem[]>();
  for (const item of items) {
    const key = normalize(item.label);
    byLabel.set(key, [...(byLabel.get(key) ?? []), item]);
  }
  let cursor = 0;
  const match = (cells: string[]): ScoringItem | null => {
    const ids = cells.slice(0, firstFigure).filter(Boolean);
    for (const id of ids) {
      const item = byCode.get(id.toUpperCase());
      if (item) return item;
    }
    for (const id of ids) {
      const candidates = byLabel.get(normalize(id));
      if (!candidates) continue;
      return (
        candidates.find((c) => position.get(c.code)! >= cursor) ??
        candidates[0]!
      );
    }
    return null;
  };

  // The first row is a header when it names no item and has no figures.
  const first = rows[0]!;
  const hasHeader =
    !match(first.cells) &&
    figureColumns.every((c) => !isFigure(first.cells[c] ?? ""));
  const columns: PasteColumn[] = figureColumns.map((index) => {
    const header = hasHeader ? (first.cells[index] ?? "") : "";
    return { index, header, ...parsePeriodHeader(header) };
  });

  const matched: PasteRow[] = [];
  const unmatched: PasteRow[] = [];
  const seen = new Map<string, number>();
  for (const { cells, row } of hasHeader ? rows.slice(1) : rows) {
    const label = cells.slice(0, firstFigure).filter(Boolean).join(" · ");
    const values = figureColumns.map((c) => cells[c] ?? "");
    const item = match(cells);
    if (!item) {
      // Section titles with no figures ("ASSETS") are layout, not data.
      if (values.some(Boolean))
        unmatched.push({ row, label, code: null, cells: values });
      continue;
    }
    cursor = position.get(item.code)! + 1;
    const earlier = seen.get(item.code);
    if (earlier !== undefined) {
      issues.push({
        severity: "error",
        code: "duplicate_row",
        row,
        itemCode: item.code,
        message: `Rows ${earlier} and ${row} both match ${item.label} (${item.code}).`,
      });
      continue;
    }
    seen.set(item.code, row);
    matched.push({ row, label, code: item.code, cells: values });
  }

  for (const r of matched) {
    const item = byCode.get(r.code!.toUpperCase())!;
    r.cells.forEach((cell, i) => {
      const parsed = parseValue(cell, item.dataType);
      if ("error" in parsed) {
        issues.push({
          severity: "error",
          code: "value_invalid",
          row: r.row,
          itemCode: item.code,
          message: `${item.label}, column ${columns[i]!.header || i + 1}: ${parsed.error}`,
        });
      }
    });
  }
  for (const r of unmatched) {
    issues.push({
      severity: "warning",
      code: "row_unmatched",
      row: r.row,
      message: `"${r.label}" doesn't match any item's code or label, so its figures are skipped.`,
    });
  }
  return { columns, matched, unmatched, issues };
}

const error = (message: string): Issue => ({
  severity: "error",
  code: "paste_invalid",
  message,
});
