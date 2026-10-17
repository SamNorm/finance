import { Dec } from "@finance/engine";
import { describe, expect, it } from "vitest";
import { demoCompanies } from "../demo/companies";
import { parseItemTable } from "../scoring-models/parse";
import { fixture } from "../scoring-models/test-helpers";
import { checkPeriod } from "../spreads/checks";
import { periodModes } from "./common";
import {
  balanceSheetSides,
  normalizeProject,
  projectItemAdjustments,
  projectTotals,
  projectValues,
  type FinancingItems,
} from "./financing";

const { items } = parseItemTable(fixture("commercial-banking.csv"));
const sides = balanceSheetSides(items);
const mapping: FinancingItems = {
  longTermDebt: "LONG_TERM_DEBT",
  currentDebt: "CPLTD",
  cash: "CASH",
};

// Equipment bought with a new loan, equity and cash on hand, and closing
// costs expensed; plus a line of credit increase and postponed advances.
const project = normalizeProject(
  {
    closing: "2024-12-31",
    sources: [
      {
        kind: "loan",
        name: "Equipment loan",
        amount: "1,200,000",
        rate: "6%",
        repayment: "equal_principal",
        years: "10",
      },
      {
        kind: "funds",
        name: "Equity injection",
        amount: "300000",
        item: "SHARE_CAPITAL",
      },
      { kind: "funds", name: "Cash on hand", amount: "100000", item: "CASH" },
    ],
    uses: [
      { name: "Machinery", amount: "1500000", item: "MACHINERY" },
      { name: "Closing costs", amount: "100000", item: "RETAINED_EARNINGS" },
    ],
    lines: [
      { name: "Line increase", increase: "500000", usage: "60%", rate: "7%" },
    ],
    subordinations: [
      {
        name: "Shareholder advances",
        amount: "300000",
        interestSaved: "12000",
        principalSaved: "0",
      },
    ],
  },
  { sides, items: mapping },
)!;

const periods = [
  { end: "2024-12-31", months: 12, mode: "proForma" as const },
  { end: "2025-09-30", months: 9, mode: "proForma" as const },
  { end: "2025-12-31", months: 12, mode: "projected" as const },
  { end: "2026-12-31", months: 12, mode: "projected" as const },
];
const round = (value: Dec | null) => value?.toFixed(2) ?? null;

describe("periodModes", () => {
  it("makes the last fiscal year and later actual periods pro forma", () => {
    const periods = [
      { months: 12, projected: false },
      { months: 12, projected: false },
      { months: 9, projected: false },
      { months: 12, projected: true },
    ];
    expect(periodModes(periods, true)).toEqual([
      "actual",
      "proForma",
      "proForma",
      "projected",
    ]);
    expect(periodModes(periods, false)).toEqual([
      "actual",
      "actual",
      "actual",
      "projected",
    ]);
  });
});

describe("balanceSheetSides", () => {
  it("sorts balance sheet amounts into assets and claims", () => {
    expect(sides.get("MACHINERY")).toBe("assets");
    expect(sides.get("CASH")).toBe("assets");
    expect(sides.get("LONG_TERM_DEBT")).toBe("claims");
    expect(sides.get("SHARE_CAPITAL")).toBe("claims");
    expect(sides.has("REVENUE")).toBe(false);
  });
});

describe("normalizeProject", () => {
  it("reads the project as typed and totals both sides", () => {
    expect(project.sources[0]).toMatchObject({
      kind: "loan",
      amount: "1200000",
      rate: "0.06",
      months: 120,
    });
    expect(project.lines[0]).toMatchObject({ usage: "0.6", rate: "0.07" });
    const totals = projectTotals(project);
    expect(totals.sources.toFixed()).toBe("1600000");
    expect(totals.difference.toFixed()).toBe("0");
    expect(normalizeProject({ sources: [] }, { sides, items: mapping })).toBe(
      null,
    );
  });

  it("refuses what can't post", () => {
    const base = { closing: "2024-12-31" };
    const context = { sides, items: mapping };
    for (const bad of [
      { ...base, uses: [{ name: "Truck", amount: "1", item: "REVENUE" }] },
      { ...base, uses: [{ name: "", amount: "1", item: "VEHICLES" }] },
      { closing: "soon", uses: [{ name: "A", amount: "1", item: "VEHICLES" }] },
      { ...base, sources: [{ kind: "grant", name: "A", amount: "1" }] },
    ])
      expect(() => normalizeProject(bad, context)).toThrow();
    // Loans need to know where new debt posts.
    expect(() =>
      normalizeProject(
        {
          ...base,
          sources: [
            {
              kind: "loan",
              name: "Loan",
              amount: "1",
              rate: "5%",
              repayment: "blended",
              years: 5,
            },
          ],
        },
        { sides, items: { longTermDebt: null, currentDebt: null, cash: null } },
      ),
    ).toThrow(/scoring model/);
  });
});

describe("projectValues", () => {
  const values = projectValues(project, periods);
  const show = (code: keyof typeof values) =>
    values[code].map((v) => round(v.value));

  it("is pro forma at closing in actual periods and on schedule after", () => {
    // A full year of payments in actual periods, scaled for the nine months.
    expect(show("PROFORMA_PRINCIPAL")).toEqual([
      "120000.00",
      "90000.00",
      "120000.00",
      "120000.00",
    ]);
    expect(show("PROFORMA_DEBT")).toEqual([
      "1200000.00",
      "1200000.00",
      "1080000.00",
      "960000.00",
    ]);
    expect(show("PROFORMA_DEBT_CURRENT")[0]).toBe("120000.00");
    // Loan interest less the advances' interest no longer paid.
    expect(show("PROFORMA_INTEREST")).toEqual([
      "56700.00",
      "42525.00",
      "56700.00",
      "49500.00",
    ]);
    expect(show("PROFORMA_LINE_INTEREST")).toEqual([
      "21000.00",
      "15750.00",
      "21000.00",
      "21000.00",
    ]);
    expect(show("PROFORMA_TO_EQUITY")[3]).toBe("300000.00");
    expect(values.PROFORMA_INTEREST[0]!.parts.map((p) => p.name)).toEqual([
      "Equipment loan",
      "Shareholder advances",
    ]);
  });

  it("applies nothing to projected years before closing", () => {
    const later = { ...project, closing: "2026-06-30" };
    const [, , y2025, y2026] = projectValues(later, periods).PROFORMA_DEBT;
    expect(round(y2025!.value)).toBe("0.00");
    // Six months of repayments after a June closing.
    expect(round(y2026!.value)).toBe("1140000.00");
  });
});

describe("projectItemAdjustments", () => {
  const adjustments = projectItemAdjustments(project, periods, sides, mapping);
  const delta = (p: number, code: string) =>
    adjustments[p]!.get(code)?.delta.toFixed() ?? null;

  it("posts sources and uses to their items", () => {
    expect(delta(0, "MACHINERY")).toBe("1500000");
    expect(delta(0, "SHARE_CAPITAL")).toBe("300000");
    expect(delta(0, "CASH")).toBe("-100000");
    expect(delta(0, "RETAINED_EARNINGS")).toBe("-100000");
    expect(delta(0, "CPLTD")).toBe("120000");
    expect(delta(0, "LONG_TERM_DEBT")).toBe("1080000");
    // Two years on: the loan amortized, out of cash.
    expect(delta(3, "LONG_TERM_DEBT")).toBe("840000");
    expect(delta(3, "CASH")).toBe("-340000");
    expect(adjustments[3]!.get("CASH")!.parts.map((p) => p.name)).toEqual([
      "Cash on hand",
      "Equipment loan",
    ]);
  });

  it("keeps the balance sheet balanced", () => {
    const year = demoCompanies()[0]!.periods[2]!;
    for (const changes of adjustments) {
      const entered = new Map(Object.entries(year.values));
      for (const [code, change] of changes)
        entered.set(code, change.delta.plus(entered.get(code) ?? 0).toFixed());
      expect(
        checkPeriod(items, entered).filter((i) => i.code === "balance"),
      ).toEqual([]);
    }
  });
});
