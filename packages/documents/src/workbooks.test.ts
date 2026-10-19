import { randomUUID } from "node:crypto";
import type { Db } from "@finance/db";
import { addComment, getAnalysis, type Context } from "@finance/domain";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { marginedNorthwind } from "./fixture";
import {
  analysisWorkbook,
  borrowingBaseWorkbook,
  debtWorkbook,
  spreadWorkbook,
  type WorkbookFile,
} from "./workbooks";

let db: Db;
let ctx: Context;
let analysisId: string;
let entityId: string;
let lineId: string;

const rejects = (promise: Promise<unknown>, kind: string) =>
  expect(promise).rejects.toMatchObject({ name: "DomainError", kind });

beforeAll(async () => {
  ({ db, ctx, analysisId, entityId, lineId } = await marginedNorthwind());
});

async function read(file: WorkbookFile) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.data.buffer as ArrayBuffer);
  return workbook;
}

// The first row whose cell in `column` reads `label`.
function rowOf(sheet: ExcelJS.Worksheet, label: string, column = 1) {
  let found: ExcelJS.Row | undefined;
  sheet.eachRow((row) => {
    if (!found && row.getCell(column).value === label) found = row;
  });
  if (!found) throw new Error(`No row "${label}" in ${sheet.name}.`);
  return found;
}

describe("workbooks", () => {
  it("lay an analysis out as its results: a sheet per scenario", async () => {
    await addComment(db, ctx, { analysisId }, "Coverage holds in every year.");
    const file = await analysisWorkbook(db, ctx, analysisId);
    expect(file.filename).toBe(
      "Northwind Precision Inc. - Annual review 2024.xlsx",
    );
    const workbook = await read(file);
    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      "Summary",
      "Base case",
      "Post-project new equipment",
    ]);
    const summary = workbook.getWorksheet("Summary")!;
    expect(rowOf(summary, "Borrower").getCell(2).value).toBe(
      "Northwind Precision Inc.",
    );
    expect(rowOf(summary, "Comments")).toBeTruthy();

    // The model's lines over three years and two projected, values as
    // numbers in the line's format, the code and formula after them.
    const base = workbook.getWorksheet("Base case")!;
    expect(base.getRow(2).getCell(1).value).toBe(
      "Annual review 2024 · Northwind Precision Inc. · Annual review: debt service v1",
    );
    const dscr = rowOf(base, "DSCR", 7);
    expect(dscr.getCell(1).value).toBe("Debt service coverage");
    expect(typeof dscr.getCell(2).value).toBe("number");
    expect(dscr.getCell(2).numFmt).toBe('0.00"x"');
    expect(dscr.getCell(8).value).toBe("CFADS / DEBT_SERVICE");
    expect(rowOf(base, "Revenue").getCell(2).numFmt).toBe("#,##0_);(#,##0)");
    expect(rowOf(base, "Covenants in force")).toBeTruthy();
    expect(base.views[0]).toMatchObject({ state: "frozen", xSplit: 1 });

    // The deal: a post-project column beside 2024, its own covenants, and
    // its sources and uses.
    const deal = workbook.getWorksheet("Post-project new equipment")!;
    const kinds = deal.getRow(6);
    expect(kinds.getCell(4).value).toBe("12 mo · Audited");
    expect(kinds.getCell(5).value).toBe("Post-project");
    expect(
      rowOf(deal, "Covenants proposed for Post-project: new equipment"),
    ).toBeTruthy();
    expect(rowOf(deal, "Total sources").getCell(2).value).toBe(2_000_000);
    expect(rowOf(deal, "Total uses").getCell(2).value).toBe(2_000_000);
    expect(String(rowOf(deal, "Equipment loan").getCell(3).value)).toMatch(
      /^New loan at 6\.8%, 7 years/,
    );
  });

  it("lay a spread out by statement, and its checks", async () => {
    const workbook = await read(await spreadWorkbook(db, ctx, entityId));
    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      "Balance sheet",
      "Income statement",
      "Cash flow",
      "Other",
      "Checks",
    ]);
    const sheet = workbook.getWorksheet("Balance sheet")!;
    const assets = rowOf(sheet, "Total assets");
    expect(typeof assets.getCell(2).value).toBe("number");
    expect(assets.getCell(2).font.bold).toBe(true);
    await rejects(spreadWorkbook(db, ctx, randomUUID()), "not_found");
  });

  it("schedule each existing loan's payments until it's repaid", async () => {
    const workbook = await read(await debtWorkbook(db, ctx, entityId));
    const [summary, ...loans] = workbook.worksheets;
    expect(summary!.name).toBe("Existing debt");
    expect(rowOf(summary!, "Operating line").getCell(2).value).toBe("CAD");
    expect(loans.length).toBeGreaterThan(0);
    const schedule = loans[0]!;
    const balances = schedule
      .getColumn(7)
      .values.filter((v): v is number => typeof v === "number");
    expect(balances.at(-1)).toBeCloseTo(0, 2);
  });

  it("lay a borrowing base out month by month, with its certificates", async () => {
    const file = await borrowingBaseWorkbook(db, ctx, lineId);
    const workbook = await read(file);
    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      "Borrowing base",
      "Certificates",
    ]);
    const sheet = workbook.getWorksheet("Borrowing base")!;
    expect(sheet.getRow(6).getCell(2).value).toBe("Reported");
    expect(rowOf(sheet, "Tests")).toBeTruthy();
    const certificates = workbook.getWorksheet("Certificates")!;
    expect(rowOf(certificates, "2024-06").getCell(2).value).toBe("Verified");
    expect(rowOf(certificates, "2024-11").getCell(3).value).toEqual(
      new Date("2024-12-12T00:00:00Z"),
    );
    // Only the organization's own.
    const { entity } = await getAnalysis(db, ctx, analysisId);
    expect(entity.id).toBe(entityId);
    await rejects(
      borrowingBaseWorkbook(db, { organizationId: randomUUID() }, lineId),
      "not_found",
    );
  });
});
