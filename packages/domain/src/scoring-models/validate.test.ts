import { describe, expect, it } from "vitest";
import { item } from "./test-helpers";
import { isStructural, validateItems } from "./validate";

const codes = (items: Parameters<typeof validateItems>[0]) =>
  validateItems(items).map((issue) => issue.code);

describe("validateItems", () => {
  it("accepts a well-formed tree", () => {
    expect(
      validateItems([
        item("CASH", { parentCode: "TCA" }),
        item("AR", { parentCode: "TCA" }),
        item("TCA", { kind: "subtotal" }),
      ]),
    ).toEqual([]);
  });

  it("rejects bad and duplicate codes, including by case", () => {
    const labelled = (code: string, label: string) => item(code, { label });
    expect(
      codes([
        labelled("has space", "1"),
        labelled("A", "2"),
        labelled("A", "3"),
        labelled("b", "4"),
        labelled("B", "5"),
      ]),
    ).toEqual(["code_invalid", "code_duplicate", "code_duplicate"]);
  });

  it("rejects missing labels and parents, and cycles", () => {
    expect(
      codes([item("A", { label: " " }), item("B", { parentCode: "NOPE" })]),
    ).toEqual(["label_missing", "parent_missing"]);
    const cycle = codes([
      item("A", { kind: "subtotal", parentCode: "B" }),
      item("B", { kind: "subtotal", parentCode: "A" }),
    ]);
    expect(cycle.filter((c) => c === "hierarchy_cycle")).toHaveLength(2);
  });

  it("checks what each kind of parent can hold", () => {
    expect(codes([item("A"), item("B", { parentCode: "A" })])).toEqual([
      "parent_is_input",
    ]);
    expect(
      codes([
        item("T", { kind: "subtotal" }),
        item("H", { kind: "header", parentCode: "T" }),
        item("X", { parentCode: "T" }),
      ]),
    ).toEqual(["header_under_subtotal", "header_empty"]);
  });

  it("keeps children on their parent's statement", () => {
    expect(
      codes([
        item("T", { kind: "subtotal" }),
        item("X", { parentCode: "T", statement: "cash_flow" }),
      ]),
    ).toEqual(["statement_mismatch"]);
  });

  it("requires subtotals to sum matching numbers", () => {
    expect(codes([item("T", { kind: "subtotal" })])).toEqual([
      "subtotal_empty",
    ]);
    expect(
      codes([
        item("T", { kind: "subtotal" }),
        item("X", { parentCode: "T", aggregation: "ignore" }),
      ]),
    ).toEqual(["subtotal_empty"]);
    expect(
      codes([
        item("T", { kind: "subtotal", dataType: "percent" }),
        item("X", { parentCode: "T", dataType: "percent" }),
      ]),
    ).toEqual(["subtotal_data_type"]);
    expect(
      codes([
        item("T", { kind: "subtotal" }),
        item("X", { parentCode: "T" }),
        item("Y", { parentCode: "T", dataType: "count" }),
      ]),
    ).toEqual(["child_data_type"]);
  });

  it("warns about duplicate labels within a statement only", () => {
    expect(
      codes([
        item("A", { label: "Other" }),
        item("B", { label: "other " }),
        item("C", { label: "Other", statement: "income_statement" }),
      ]),
    ).toEqual(["label_duplicate"]);
  });

  it("marks only identity and tree problems as structural", () => {
    const issues = validateItems([
      item("A"),
      item("B", { parentCode: "A" }),
      item("C", { parentCode: "X" }),
    ]);
    expect(issues.filter(isStructural).map((i) => i.code)).toEqual([
      "parent_missing",
    ]);
  });
});
