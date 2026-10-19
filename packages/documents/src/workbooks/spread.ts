import type { Db } from "@finance/db";
import {
  getScoringModel,
  getSpread,
  type Context,
  type ScoringItem,
  type Statement,
} from "@finance/domain";
import { locale } from "../locale";
import {
  addSheet,
  COLORS,
  excelDate,
  fileOf,
  freeze,
  headerRow,
  newWorkbook,
  sectionRow,
  setCode,
  setFigure,
  titleRows,
  type WorkbookFile,
} from "./sheet";

// A borrower's spread as a workbook: a sheet per statement laid out as the
// scoring model has it, figures entered and subtotals summed, by period;
// then the checks against the statements. A consolidated client's figures
// are its members' added up, less eliminations.

const l = locale("en");

const STATEMENTS: Record<Statement, string> = {
  balance_sheet: "Balance sheet",
  income_statement: "Income statement",
  cash_flow: "Cash flow",
  other: "Other",
};

// How deep each item sits under its parents, for indenting.
function depths(items: readonly ScoringItem[]) {
  const parentOf = new Map(items.map((item) => [item.code, item.parentCode]));
  return new Map(
    items.map((item) => {
      let depth = 0;
      for (
        let code = item.parentCode;
        code && depth < 20;
        code = parentOf.get(code) ?? null
      )
        depth++;
      return [item.code, depth];
    }),
  );
}

export async function spreadWorkbook(
  db: Db,
  ctx: Context,
  entityId: string,
): Promise<WorkbookFile> {
  const spread = await getSpread(db, ctx, entityId);
  const scoring = await getScoringModel(db, ctx, spread.entity.scoringModelId);
  const { entity, periods, layout } = spread;
  const items = layout?.items ?? [];
  const depth = depths(items);
  const workbook = newWorkbook();
  const subtitle = [
    [
      `${scoring.name}${layout ? ` v${layout.versionNumber}` : ""}`,
      spread.consolidation &&
        `Consolidated: ${spread.consolidation.members.map((m) => m.name).join(" + ")}, less eliminations`,
    ]
      .filter(Boolean)
      .join(" · "),
    `Downloaded ${l.date(new Date().toISOString().slice(0, 10))}`,
  ];
  const last = periods.length + 1;
  const codeColumn = last + 1;

  for (const [statement, label] of Object.entries(STATEMENTS) as [
    Statement,
    string,
  ][]) {
    const rows = items.filter((item) => item.statement === statement);
    if (!rows.length) continue;
    const sheet = addSheet(workbook, label);
    let row = titleRows(sheet, `${entity.name}: ${label}`, subtitle);
    // Each period's end, what it covers and how it was prepared, and its
    // currency.
    const dates = sheet.getRow(row);
    const kinds = sheet.getRow(row + 1);
    const currencies = sheet.getRow(row + 2);
    dates.getCell(1).value = "Item";
    periods.forEach((p, i) => {
      dates.getCell(i + 2).value = excelDate(p.periodEnd);
      dates.getCell(i + 2).numFmt = "mmm d, yyyy";
      kinds.getCell(i + 2).value = l.w.periodMonths(
        p.months,
        l.w.qualities[p.quality],
      );
      currencies.getCell(i + 2).value =
        `${p.currency}${p.consolidated ? " · consolidated" : ""}`;
    });
    dates.getCell(codeColumn).value = "Code";
    for (const r of [dates, kinds, currencies]) {
      headerRow(r, 1, codeColumn);
      for (let c = 2; c <= last; c++)
        r.getCell(c).alignment = { horizontal: "right", wrapText: true };
    }
    freeze(sheet, row + 2);
    row += 3;

    for (const item of rows) {
      const r = sheet.getRow(row++);
      if (item.kind === "header") {
        sectionRow(r, item.label, codeColumn);
        r.getCell(1).alignment = { indent: depth.get(item.code) ?? 0 };
        continue;
      }
      r.getCell(1).value = item.label;
      r.getCell(1).alignment = { indent: depth.get(item.code) ?? 0 };
      periods.forEach((p, i) =>
        setFigure(
          r.getCell(i + 2),
          spread.values[p.id]?.[item.code] ??
            spread.computed[p.id]?.[item.code] ??
            null,
          item.dataType,
        ),
      );
      if (item.kind === "subtotal")
        for (let c = 1; c <= last; c++) {
          const cell = r.getCell(c);
          cell.font = { ...cell.font, bold: true };
          cell.border = {
            top: { style: "thin", color: { argb: COLORS.line } },
          };
        }
      setCode(r.getCell(codeColumn), item.code);
    }
    sheet.getColumn(1).width = 46;
    for (let c = 2; c <= last; c++) sheet.getColumn(c).width = 15;
    sheet.getColumn(codeColumn).width = 26;
  }

  // What the checks against the statements flag, period by period.
  const flagged = periods.filter((p) => spread.checks[p.id]?.length);
  const checks = addSheet(workbook, "Checks", false);
  let row = titleRows(checks, `${entity.name}: checks`, [
    flagged.length
      ? "Errors keep a period out of analyses until fixed; warnings only flag."
      : "Every period passes its checks.",
  ]);
  if (flagged.length) {
    const head = checks.getRow(row++);
    head.values = ["Period", "Severity", "Check"];
    headerRow(head, 1, 3);
    for (const p of flagged)
      for (const issue of spread.checks[p.id]!) {
        const r = checks.getRow(row++);
        r.getCell(1).value = `${p.periodEnd} (${p.months} mo)`;
        r.getCell(2).value = issue.severity === "error" ? "Error" : "Warning";
        r.getCell(2).font = {
          color: {
            argb: issue.severity === "error" ? COLORS.fail : COLORS.muted,
          },
        };
        r.getCell(3).value = issue.message;
        r.getCell(3).alignment = { wrapText: true, vertical: "top" };
      }
  }
  checks.getColumn(1).width = 22;
  checks.getColumn(2).width = 12;
  checks.getColumn(3).width = 100;
  return fileOf(workbook, `${entity.name} - Spread`);
}
