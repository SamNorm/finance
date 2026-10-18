import { describe, expect, it } from "vitest";
import { capexValues, capexYears, normalizeCapex, typedCapex } from "./capex";

// A press bought in mid-2026, 75% on a 10-year blended loan, and racking
// in 2027 paid from cash.
const plan = normalizeCapex([
  {
    name: "Second press",
    date: "2026-06-30",
    amount: "1,200,000",
    financed: "75%",
    rate: "7%",
    repayment: "blended",
    years: 10,
  },
  { name: "Racking", date: "2027-03-31", amount: "150000" },
]);

const periods = [
  { end: "2024-12-31", months: 12, mode: "actual" as const },
  { end: "2025-12-31", months: 12, mode: "projected" as const },
  { end: "2026-12-31", months: 12, mode: "projected" as const },
  { end: "2027-12-31", months: 12, mode: "projected" as const },
];

describe("normalizeCapex", () => {
  it("reads purchases as typed, and as saved", () => {
    expect(plan).toMatchObject([
      {
        name: "Second press",
        amount: "1200000",
        financed: "0.75",
        loan: { rate: "0.07", repayment: "blended", months: 120 },
      },
      { name: "Racking", financed: "0" },
    ]);
    expect(plan[1]).not.toHaveProperty("loan");
    // Copied, a fully financed purchase stays fully financed.
    const whole = normalizeCapex([{ ...plan[0]!, financed: "1" }]);
    expect(normalizeCapex(whole)).toEqual(whole);
    expect(normalizeCapex(plan.map(typedCapex))).toEqual(plan);
  });

  it("refuses what it can't read", () => {
    const press = { name: "Press", date: "2026-06-30", amount: "1" };
    for (const bad of [
      { ...press, name: "" },
      { ...press, date: "mid-2026" },
      { ...press, amount: "0" },
      // A share needs its percent sign: 80 would be 8,000%.
      { ...press, financed: "80" },
      // Financed, it needs a loan's terms.
      { ...press, financed: "80%" },
    ])
      expect(() => normalizeCapex([bad])).toThrow();
  });
});

describe("capexValues", () => {
  const values = capexValues(plan, periods);
  const show = (code: keyof typeof values) =>
    values[code].map((v) => v.value!.toDecimalPlaces(2).toFixed());

  it("counts purchases in their year, and their loans from then on", () => {
    expect(show("CAPEX_SPENT")).toEqual(["0", "0", "1200000", "150000"]);
    expect(show("CAPEX_FINANCED")).toEqual(["0", "0", "900000", "0"]);
    // Six monthly payments in 2026, twelve in 2027.
    const payment = (900000 * (0.07 / 12)) / (1 - (1 + 0.07 / 12) ** -120);
    const service = show("CAPEX_DEBT_SERVICE").map(Number);
    expect(service[2]).toBeCloseTo(6 * payment, 0);
    expect(service[3]).toBeCloseTo(12 * payment, 0);
    expect(service[0]).toBe(0);
    const [interest, principal] = [
      show("CAPEX_INTEREST").map(Number),
      show("CAPEX_PRINCIPAL").map(Number),
    ];
    expect(interest[3]! + principal[3]!).toBeCloseTo(service[3]!, 1);
    expect(Number(show("CAPEX_DEBT")[3])).toBeCloseTo(
      900000 - principal[2]! - principal[3]!,
      1,
    );
    expect(values.CAPEX_DEBT_SERVICE[3]!.parts).toMatchObject([
      { name: "Second press" },
    ]);
  });

  it("lays the plan out year by year", () => {
    const years = capexYears(
      plan,
      periods.map((p) => ({ ...p, projected: p.mode === "projected" })),
    );
    expect(years.map((y) => [y.end, y.spent, y.financed, y.cash])).toEqual([
      ["2025-12-31", "0", "0", "0"],
      ["2026-12-31", "1200000", "900000", "300000"],
      ["2027-12-31", "150000", "0", "150000"],
    ]);
  });
});
