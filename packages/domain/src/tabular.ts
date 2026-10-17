import Papa from "papaparse";
import type { Issue } from "./errors";

// Reads CSV, or cells copied out of Excel (tab-separated), into rows of cells.
// Blank lines stay, so row indexes match the spreadsheet's.
export function readTable(text: string): { rows: string[][]; issues: Issue[] } {
  const source = text.replace(/^﻿/, "");
  const parsed = Papa.parse<string[]>(source, {
    delimiter: detectDelimiter(source),
    skipEmptyLines: false,
  });
  const issues: Issue[] = parsed.errors
    .filter((e) => e.type === "Quotes")
    .map((e) => ({
      severity: "error",
      code: "file_invalid",
      row: (e.row ?? 0) + 1,
      message: e.message,
    }));
  return { rows: parsed.data, issues };
}

// Papa's own guess fails on short pastes, so the first row decides: whichever
// delimiter it contains most, tabs first (cells copied out of Excel).
function detectDelimiter(text: string) {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  let best = { delimiter: ",", count: 0 };
  for (const delimiter of ["\t", ";", ",", "|"]) {
    const count = first.split(delimiter).length - 1;
    if (count > best.count) best = { delimiter, count };
  }
  return best.delimiter;
}
