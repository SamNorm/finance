import ExcelJS from "exceljs";

// What every workbook shares: figures as Excel numbers in the app's formats,
// errors as Excel's own with the app's message in a note, and a sheet
// layout of title rows, a frozen header and the labels in the first column.
// Workbooks hold values, not formulas: lineage stays in the app.

export type CellFormat =
  "amount" | "percent" | "ratio" | "count" | "date" | "text" | "flag";

// Amounts in whole units, negatives in brackets, as on statements; the
// cell keeps every decimal.
const NUMBER_FORMATS: Partial<Record<CellFormat, string>> = {
  amount: "#,##0_);(#,##0)",
  percent: "0.00%",
  ratio: '0.00"x"',
  count: "#,##0",
  date: "yyyy-mm-dd",
};

export const COLORS = {
  muted: "FF6B7280",
  pass: "FF15803D",
  fail: "FFB91C1C",
  head: "FFF3F4F6",
  section: "FFE5E7EB",
  projected: "FFF5F5F4",
  post: "FFE8EEFB",
  line: "FFD1D5DB",
};

export const fill = (argb: string): ExcelJS.Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb },
});

export interface WorkbookFile {
  filename: string;
  data: Uint8Array;
}

export function newWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const now = new Date();
  workbook.creator = "Credit analysis";
  workbook.created = now;
  workbook.modified = now;
  return workbook;
}

export async function fileOf(
  workbook: ExcelJS.Workbook,
  name: string,
): Promise<WorkbookFile> {
  const data = await workbook.xlsx.writeBuffer();
  return {
    filename: `${name
      .replace(/[^\p{L}\p{N} .,()&'_-]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()}.xlsx`,
    data: new Uint8Array(data as ArrayBuffer),
  };
}

// A sheet name Excel takes: 31 characters at most, none of : \ / ? * [ ],
// and not one the workbook already has.
export function sheetName(workbook: ExcelJS.Workbook, wanted: string) {
  const base =
    wanted
      .replace(/[:\\/?*[\]]/g, " ")
      .replace(/^'+|'+$/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 31) || "Sheet";
  const taken = new Set(workbook.worksheets.map((s) => s.name.toLowerCase()));
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  return name;
}

export function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  landscape = true,
): ExcelJS.Worksheet {
  return workbook.addWorksheet(sheetName(workbook, name), {
    pageSetup: {
      orientation: landscape ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
}

// "2024-12-31" as an Excel date.
export const excelDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

const EXCEL_ERRORS = new Set([
  "#N/A",
  "#REF!",
  "#NAME?",
  "#DIV/0!",
  "#NULL!",
  "#VALUE!",
  "#NUM!",
]);

// Writes a figure: a number in its format, a date, text, Pass or Fail for
// a flag, or the engine's error as Excel's, its message in a note.
export function setFigure(
  cell: ExcelJS.Cell,
  value: string | null,
  format: CellFormat,
  error: { code: string; message: string } | null = null,
) {
  if (error) {
    cell.value = {
      error: (EXCEL_ERRORS.has(error.code)
        ? error.code
        : "#REF!") as ExcelJS.CellErrorValue["error"],
    };
    cell.note = error.message;
    cell.font = { ...cell.font, color: { argb: COLORS.fail } };
    return;
  }
  if (value === null || value === "") return;
  if (format === "flag") {
    const pass = value.toLowerCase() === "true";
    const fail = value.toLowerCase() === "false";
    cell.value = pass ? "Pass" : fail ? "Fail" : value;
    if (pass || fail)
      cell.font = {
        ...cell.font,
        color: { argb: pass ? COLORS.pass : COLORS.fail },
      };
    cell.alignment = { horizontal: "right" };
    return;
  }
  if (format === "text") {
    cell.value = value;
    return;
  }
  if (format === "date") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      cell.value = excelDate(value);
      cell.numFmt = NUMBER_FORMATS.date!;
    } else cell.value = value;
    return;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    cell.value = value;
    return;
  }
  cell.value = n;
  cell.numFmt = NUMBER_FORMATS[format]!;
}

// The sheet's title and the lines under it, then a blank row; returns the
// next free row.
export function titleRows(
  sheet: ExcelJS.Worksheet,
  title: string,
  lines: readonly string[] = [],
): number {
  sheet.getCell(1, 1).value = title;
  sheet.getCell(1, 1).font = { bold: true, size: 14 };
  lines.forEach((text, i) => {
    const cell = sheet.getCell(2 + i, 1);
    cell.value = text;
    cell.font = { color: { argb: COLORS.muted } };
  });
  return lines.length + 3;
}

// A header row: bold on a band, a line under it.
export function headerRow(row: ExcelJS.Row, from = 1, to = row.cellCount) {
  for (let c = from; c <= to; c++) {
    const cell = row.getCell(c);
    cell.font = { ...cell.font, bold: true };
    cell.fill = fill(COLORS.head);
    cell.border = { bottom: { style: "thin", color: { argb: COLORS.line } } };
    cell.alignment = { ...cell.alignment, vertical: "top", wrapText: true };
  }
}

// A section's title across the columns used.
export function sectionRow(row: ExcelJS.Row, label: string, to: number) {
  row.getCell(1).value = label;
  for (let c = 1; c <= to; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true };
    cell.fill = fill(COLORS.section);
  }
}

// A line's or an item's code, set apart from the figures before it.
export function setCode(cell: ExcelJS.Cell, code: string) {
  cell.value = code;
  cell.font = { color: { argb: COLORS.muted } };
  cell.alignment = { indent: 1 };
}

// Labels in the first column and the header rows stay in view.
export function freeze(sheet: ExcelJS.Worksheet, rows: number, columns = 1) {
  sheet.views = [{ state: "frozen", xSplit: columns, ySplit: rows }];
}

// Facts as label and value pairs, from `row`; returns the next free row.
export function factRows(
  sheet: ExcelJS.Worksheet,
  row: number,
  facts: readonly (readonly [string, string | number | Date | null])[],
): number {
  for (const [label, value] of facts) {
    if (value === null) continue;
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 1).font = { color: { argb: COLORS.muted } };
    const cell = sheet.getCell(row, 2);
    cell.value = value;
    if (value instanceof Date) cell.numFmt = NUMBER_FORMATS.date!;
    cell.alignment = { horizontal: "left" };
    row++;
  }
  return row;
}
