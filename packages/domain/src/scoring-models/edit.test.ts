import { describe, expect, it } from "vitest";
import { DomainError } from "../errors";
import { diffItems } from "./diff";
import { insertItem, moveItem, removeItem, updateItem } from "./edit";
import { item } from "./test-helpers";

const list = [
  item("CASH", { parentCode: "TCA" }),
  item("AR", { parentCode: "TCA" }),
  item("TCA", { kind: "subtotal" }),
];
const order = (items: { code: string }[]) => items.map((i) => i.code);

describe("item edits", () => {
  it("inserts with defaults, at the end or at a position", () => {
    const appended = insertItem(list, {
      code: "INV",
      label: "Inventory",
      statement: "balance_sheet",
    });
    expect(appended.at(-1)).toEqual(item("INV", { label: "Inventory" }));
    expect(order(insertItem(list, item("INV"), 1))).toEqual([
      "CASH",
      "INV",
      "AR",
      "TCA",
    ]);
    expect(list).toHaveLength(3);
  });

  it("re-points children when a code is renamed", () => {
    const next = updateItem(list, "TCA", { code: "TOTAL_CA" });
    expect(next.map((i) => i.parentCode)).toEqual([
      "TOTAL_CA",
      "TOTAL_CA",
      null,
    ]);
    expect(() => updateItem(list, "NOPE", {})).toThrow(DomainError);
  });

  it("refuses to remove an item that still has children", () => {
    expect(order(removeItem(list, "AR"))).toEqual(["CASH", "TCA"]);
    expect(() => removeItem(list, "TCA")).toThrow(/still has items under it/);
  });

  it("moves an item, clamping the position", () => {
    expect(order(moveItem(list, "TCA", 0))).toEqual(["TCA", "CASH", "AR"]);
    expect(order(moveItem(list, "CASH", 99))).toEqual(["AR", "TCA", "CASH"]);
  });
});

describe("diffItems", () => {
  it("lists added, removed and changed items by code", () => {
    const after = updateItem(removeItem(list, "AR"), "CASH", {
      label: "Cash and equivalents",
    });
    expect(
      diffItems(list, insertItem(after, item("INV", { parentCode: "TCA" }))),
    ).toEqual({
      added: ["INV"],
      removed: ["AR"],
      changed: [
        {
          code: "CASH",
          changes: [
            { field: "label", before: "cash", after: "Cash and equivalents" },
          ],
        },
      ],
    });
  });
});
