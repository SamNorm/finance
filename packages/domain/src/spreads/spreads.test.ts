import { describe, expect, it } from "vitest";
import { parseItemTable } from "../scoring-models/parse";
import { fixture } from "../scoring-models/test-helpers";
import { checkPeriod, effectiveAmounts } from "./checks";
import { parseSpreadPaste } from "./paste";
import { parsePeriodHeader, parseValue } from "./values";

const { items } = parseItemTable(fixture("commercial-banking.csv"));

describe("parseValue", () => {
  it.each([
    ["1,234,567", "1234567"],
    ["(1,234.50)", "-1234.5"],
    ["1234-", "-1234"],
    ["-12", "-12"],
    ["$ 2 500", "2500"],
    ["1 234,56", "1234.56"],
    ["1.234,5", "1234.5"],
    ["12,5", "12.5"],
    ["15%", "0.15"],
    [" 0.1 ", "0.1"],
  ])("reads %s as %s", (raw, expected) => {
    expect(parseValue(raw, "amount")).toEqual({ value: expected });
  });

  it("treats dashes and n/a as blank, keeps text, rejects junk", () => {
    expect(parseValue("—", "amount")).toEqual({ value: null });
    expect(parseValue("n/a", "amount")).toEqual({ value: null });
    expect(parseValue(" Going concern ", "text")).toEqual({
      value: "Going concern",
    });
    expect(parseValue("12 apples", "amount")).toEqual({
      error: '"12 apples" isn\'t a number.',
    });
    expect(parseValue("2.5", "count")).toEqual({
      error: '"2.5" isn\'t a whole number.',
    });
  });
});

describe("parsePeriodHeader", () => {
  it.each([
    ["2024-12-31", "2024-12-31", null, false],
    ["Dec 31, 2024", "2024-12-31", null, false],
    ["31-déc-24", "2024-12-31", null, false],
    ["Jun-24", "2024-06-30", null, false],
    ["30 juin 2024", "2024-06-30", null, false],
    ["12M 31/12/2024", "2024-12-31", 12, false],
    ["6 mois 2024-06-30", "2024-06-30", 6, false],
    ["FY2023", "2023-12-31", null, true],
    ["2022", "2022-12-31", null, true],
    ["03/04/2024", null, null, false],
    ["Projection", null, null, false],
  ])("reads %s", (raw, periodEnd, months, guessed) => {
    expect(parsePeriodHeader(raw)).toEqual({ periodEnd, months, guessed });
  });
});

describe("parseSpreadPaste", () => {
  it("matches rows by label in layout order, with headers as periods", () => {
    const text = [
      "\tFY2023\tFY2024",
      "BALANCE SHEET\t\t",
      "Cash and equivalents\t100\t120",
      "Total current assets\t(50)\t1,000",
      "INCOME STATEMENT\t\t",
      "Net income\t30\t40",
      "CASH FLOW\t\t",
      "Net income\t30\t40",
      "Mystery line\t5\t6",
    ].join("\n");
    const result = parseSpreadPaste(text, items);
    expect(
      result.columns.map((c) => [c.index, c.periodEnd, c.guessed]),
    ).toEqual([
      [1, "2023-12-31", true],
      [2, "2024-12-31", true],
    ]);
    expect(result.matched.map((r) => [r.code, r.cells])).toEqual([
      ["CASH", ["100", "120"]],
      ["TOTAL_CURRENT_ASSETS", ["(50)", "1,000"]],
      ["NET_INCOME", ["30", "40"]],
      ["CF_NET_INCOME", ["30", "40"]],
    ]);
    expect(result.unmatched.map((r) => r.label)).toEqual(["Mystery line"]);
    expect(result.issues.map((i) => i.code)).toEqual(["row_unmatched"]);
  });

  it("matches by code in any identifier column and reports bad figures", () => {
    const result = parseSpreadPaste(
      "code\tlabel\t2024-12-31\nrevenue\tSales\t1000\nCOST_OF_SALES\tCOGS\tabc\nSELLING_EXPENSES\tSelling\t50\nNET_INCOME\tNet\t10\n",
      items,
    );
    expect(result.matched.map((r) => r.code)).toEqual([
      "REVENUE",
      "COST_OF_SALES",
      "SELLING_EXPENSES",
      "NET_INCOME",
    ]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "value_invalid",
        row: 3,
        itemCode: "COST_OF_SALES",
      }),
    ]);
  });

  it("refuses duplicate rows and pastes without figures", () => {
    expect(
      parseSpreadPaste("CASH\t1\nCASH\t2\nINVENTORY\t3", items).issues.map(
        (i) => i.code,
      ),
    ).toEqual(["duplicate_row"]);
    expect(
      parseSpreadPaste("Cash\tlots", items).issues.map((i) => i.code),
    ).toEqual(["paste_invalid"]);
  });
});

describe("statement checks", () => {
  const entered = (values: Record<string, string>) =>
    new Map(Object.entries(values));

  it("sums subtotals that weren't entered, with subtraction", () => {
    const { amounts } = effectiveAmounts(
      items,
      entered({ LAND: "100", BUILDINGS: "400", ACCUM_DEPRECIATION: "150" }),
    );
    expect(amounts.get("GROSS_FIXED_ASSETS")?.toString()).toBe("500");
    expect(amounts.get("NET_FIXED_ASSETS")?.toString()).toBe("350");
    expect(amounts.get("TOTAL_ASSETS")?.toString()).toBe("350");
    expect(amounts.has("TOTAL_EQUITY")).toBe(false);
  });

  it("flags subtotals that don't reconcile, imbalance and wrong signs", () => {
    const issues = checkPeriod(
      items,
      entered({
        CASH: "100",
        INVENTORY: "-20",
        TOTAL_CURRENT_ASSETS: "90",
        AP_TRADE: "50",
        SHARE_CAPITAL: "10",
        GHOST: "1",
      }),
    );
    expect(issues.map((i) => [i.code, i.itemCode])).toEqual([
      ["balance", "TOTAL_ASSETS"],
      ["sign", "INVENTORY"],
      ["subtotal", "TOTAL_CURRENT_ASSETS"],
      ["unknown_code", "GHOST"],
    ]);
    expect(issues[0]?.message).toBe(
      "The balance sheet doesn't balance: Total assets 90 vs Total liabilities and equity 60 (difference 30).",
    );
  });

  it("accepts a balanced sheet within a rounding difference", () => {
    expect(
      checkPeriod(
        items,
        entered({ CASH: "100.4", AP_TRADE: "60", SHARE_CAPITAL: "40" }),
      ),
    ).toEqual([]);
  });
});
