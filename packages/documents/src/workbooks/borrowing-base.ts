import type { Db } from "@finance/db";
import {
  runBorrowingBaseOf,
  type BorrowingBaseFormat,
  type Context,
} from "@finance/domain";
import type ExcelJS from "exceljs";
import { locale } from "../locale";
import {
  addSheet,
  COLORS,
  excelDate,
  fileOf,
  fill,
  freeze,
  headerRow,
  newWorkbook,
  sectionRow,
  setFigure,
  titleRows,
  type WorkbookFile,
} from "./sheet";

// A margined line's borrowing base as a workbook: the waterfall month by
// month, with its tests under it, then the certificates and what the app
// flagged in each.

const l = locale("en");

const QUALITIES = { reported: "Reported", verified: "Verified" };

export async function borrowingBaseWorkbook(
  db: Db,
  ctx: Context,
  lineId: string,
): Promise<WorkbookFile> {
  const { detail, run, issues } = await runBorrowingBaseOf(db, ctx, lineId);
  const { line, entity } = detail;
  const workbook = newWorkbook();
  const sheet = addSheet(workbook, "Borrowing base");
  const months = run.months;
  const last = months.length + 1;
  let row = titleRows(sheet, `${entity.name}: ${line.name}`, [
    `${line.currency} · limit ${l.limit(line.limit)} · ${l.figure(line.rate, "percent")}`,
    `Downloaded ${l.date(new Date().toISOString().slice(0, 10))}`,
  ]);

  const head = sheet.getRow(row);
  const qualities = sheet.getRow(row + 1);
  head.getCell(1).value = "Line";
  months.forEach((m, i) => {
    head.getCell(i + 2).value = excelDate(m.end);
    head.getCell(i + 2).numFmt = "mmm yyyy";
    qualities.getCell(i + 2).value = m.quality
      ? QUALITIES[m.quality]
      : "No certificate";
  });
  for (const r of [head, qualities]) {
    headerRow(r, 1, last);
    for (let c = 2; c <= last; c++)
      r.getCell(c).alignment = { horizontal: "right" };
  }
  freeze(sheet, row + 1);
  row += 2;
  // Months with no certificate show nothing to rely on: shaded.
  const shade = (r: ExcelJS.Row) =>
    months.forEach((m, i) => {
      if (!m.quality) r.getCell(i + 2).fill = fill(COLORS.projected);
    });

  for (const waterfall of run.rows) {
    const r = sheet.getRow(row++);
    const label = `${waterfall.label}${waterfall.currency && waterfall.currency !== line.currency ? ` (${waterfall.currency})` : ""}`;
    if (waterfall.kind === "section") {
      sectionRow(r, label, last);
      continue;
    }
    r.getCell(1).value = label;
    r.getCell(1).alignment = { indent: waterfall.depth };
    const cells = run.cells[waterfall.code] ?? [];
    months.forEach((_, i) => {
      const cell = cells[i];
      if (cell)
        setFigure(
          r.getCell(i + 2),
          cell.value,
          waterfall.format as BorrowingBaseFormat,
          cell.error,
        );
    });
    if (waterfall.kind === "detail")
      r.getCell(1).font = { color: { argb: COLORS.muted } };
    if (waterfall.kind === "subtotal" || waterfall.kind === "total")
      for (let c = 1; c <= last; c++) {
        const cell = r.getCell(c);
        cell.font = { ...cell.font, bold: true };
        cell.border = { top: { style: "thin", color: { argb: COLORS.line } } };
      }
    shade(r);
  }

  if (run.tests.length) {
    row++;
    sectionRow(sheet.getRow(row++), "Tests", last);
    for (const test of run.tests) {
      const format = (run.rows.find((r) => r.code === test.metric)?.format ??
        "amount") as BorrowingBaseFormat;
      const name = sheet.getRow(row++);
      const threshold = sheet.getRow(row++);
      const margin = sheet.getRow(row++);
      name.getCell(1).value =
        `${test.name} (${test.test === "min" ? "at least" : "at most"})`;
      name.getCell(1).font = { bold: true };
      threshold.getCell(1).value = "   Threshold";
      margin.getCell(1).value = "   Room before a breach";
      for (const r of [threshold, margin])
        r.getCell(1).font = { color: { argb: COLORS.muted } };
      test.months.forEach((m, i) => {
        if (m.pass === null) return;
        setFigure(name.getCell(i + 2), m.value, format, m.error);
        name.getCell(i + 2).font = {
          bold: true,
          color: { argb: m.pass ? COLORS.pass : COLORS.fail },
        };
        setFigure(threshold.getCell(i + 2), m.threshold, format);
        setFigure(margin.getCell(i + 2), m.margin, format);
      });
      for (const r of [name, threshold, margin]) shade(r);
    }
  }
  sheet.getColumn(1).width = 44;
  for (let c = 2; c <= last; c++) sheet.getColumn(c).width = 14;

  // The certificates as they came in, and what each month's flags.
  const certificates = addSheet(workbook, "Certificates", false);
  row = titleRows(certificates, `${line.name}: certificates`, [
    ...issues.general.map((issue) => issue.message),
  ]);
  const certificateHead = certificates.getRow(row++);
  certificateHead.values = ["Month", "Quality", "Received", "Note", "Flags"];
  headerRow(certificateHead, 1, 5);
  for (const month of detail.months) {
    const r = certificates.getRow(row++);
    r.getCell(1).value = month.month;
    r.getCell(2).value = QUALITIES[month.quality];
    if (month.receivedOn) setFigure(r.getCell(3), month.receivedOn, "date");
    r.getCell(4).value = month.note ?? "";
    const flags = issues.byMonth[month.month] ?? [];
    if (flags.length) {
      r.getCell(5).value = flags.map((issue) => issue.message).join("\n");
      r.getCell(5).alignment = { wrapText: true, vertical: "top" };
      r.getCell(5).font = {
        color: {
          argb: flags.some((issue) => issue.severity === "error")
            ? COLORS.fail
            : COLORS.muted,
        },
      };
    }
  }
  certificates.getColumn(1).width = 10;
  certificates.getColumn(2).width = 12;
  certificates.getColumn(3).width = 12;
  certificates.getColumn(4).width = 40;
  certificates.getColumn(5).width = 80;
  return fileOf(workbook, `${entity.name} - ${line.name} - Borrowing base`);
}
