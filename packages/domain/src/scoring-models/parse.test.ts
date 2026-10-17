import { describe, expect, it } from "vitest";
import { parseItemTable } from "./parse";
import { fixture } from "./test-helpers";
import { validateItems } from "./validate";

describe("parseItemTable", () => {
  it("reads the fictional commercial banking template with no issues", () => {
    const { items, issues } = parseItemTable(fixture("commercial-banking.csv"));
    expect(issues).toEqual([]);
    expect(validateItems(items)).toEqual([]);
    expect(items).toHaveLength(101);
    expect(items.find((i) => i.code === "TOTAL_ASSETS")).toMatchObject({
      kind: "subtotal",
      statement: "balance_sheet",
      parentCode: null,
    });
    expect(items.find((i) => i.code === "ACCUM_DEPRECIATION")).toMatchObject({
      aggregation: "subtract",
      expectedSign: "positive",
    });
  });

  it("applies defaults: inferred kind, inherited statement, amount, add, any", () => {
    const { items, issues } = parseItemTable(
      "code,label,statement,parent\nCASH,Cash,,TCA\nTCA,Total current assets,BS,\n",
    );
    expect(issues).toEqual([]);
    expect(items).toEqual([
      {
        code: "CASH",
        label: "Cash",
        statement: "balance_sheet",
        parentCode: "TCA",
        kind: "input",
        dataType: "amount",
        aggregation: "add",
        expectedSign: "any",
        description: null,
        attributes: {},
      },
      expect.objectContaining({
        code: "TCA",
        kind: "subtotal",
        statement: "balance_sheet",
      }),
    ]);
  });

  it("detects tab and semicolon delimiters", () => {
    for (const sep of ["\t", ";"]) {
      const { items, issues } = parseItemTable(
        `code${sep}label\nA${sep}Alpha\n`,
      );
      expect(issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(items.map((i) => [i.code, i.label])).toEqual([["A", "Alpha"]]);
    }
  });

  it("matches column names and values loosely, in English or French", () => {
    const { items, issues } = parseItemTable(
      [
        "Code;Libellé;État;Code parent;Type de ligne;Format;Signe;Signe attendu",
        "BS1;Encaisse;Bilan;T1;;$;+;positif",
        "T1;Total;Bilan;;sous-total;montant;;",
        "PCT;Taux;Autre;;;%;;",
      ].join("\n"),
    );
    expect(issues).toEqual([]);
    expect(items[0]).toMatchObject({
      label: "Encaisse",
      statement: "balance_sheet",
      parentCode: "T1",
      dataType: "amount",
      aggregation: "add",
      expectedSign: "positive",
    });
    expect(items[1]).toMatchObject({ kind: "subtotal" });
    expect(items[2]).toMatchObject({ statement: "other", dataType: "percent" });
  });

  it("uses a description column as the label when there's no label column", () => {
    const { items } = parseItemTable("Account Code,Description\n1000,Cash\n");
    expect(items[0]).toMatchObject({
      code: "1000",
      label: "Cash",
      description: null,
    });
  });

  it("keeps unknown columns as attributes", () => {
    const { items } = parseItemTable(
      'code,label,Line #,Source Note\nA,Alpha,12,""\n',
    );
    expect(items[0]?.attributes).toEqual({ "Line #": "12" });
  });

  it("handles a byte order mark, quoted commas and blank rows", () => {
    const { items } = parseItemTable('﻿code,label\n\nA,"Gain, net"\n,\n');
    expect(items.map((i) => i.label)).toEqual(["Gain, net"]);
  });

  it("reports unknown values with their spreadsheet row", () => {
    const { issues } = parseItemTable(
      "code,label,statement\nA,Alpha,BS\nB,Beta,Equity\n",
    );
    expect(issues.filter((i) => i.severity === "error")).toEqual([
      expect.objectContaining({
        code: "value_invalid",
        row: 3,
        severity: "error",
      }),
    ]);
    expect(issues[0]?.message).toContain("balance_sheet");
  });

  it("warns when a root item has no statement", () => {
    const { items, issues } = parseItemTable("code,label\nA,Alpha\n");
    expect(items[0]?.statement).toBe("other");
    expect(issues).toEqual([
      expect.objectContaining({
        code: "statement_defaulted",
        severity: "warning",
        row: 2,
      }),
    ]);
  });

  it("fails without code and label columns", () => {
    expect(parseItemTable("label,statement\nCash,BS\n").issues).toEqual([
      expect.objectContaining({ code: "column_missing" }),
    ]);
    expect(parseItemTable("").issues).toEqual([
      expect.objectContaining({ code: "file_invalid" }),
    ]);
  });

  it("reports rows without a code and columns read twice", () => {
    const { issues } = parseItemTable("code,label,name\n,Alpha,\n");
    expect(issues.map((i) => i.code)).toEqual([
      "column_duplicate",
      "code_missing",
    ]);
  });
});
