import { describe, expect, it } from "vitest";
import {
  financingValues,
  loanSchedule,
  normalizeAdjustments,
  type Loan,
} from "./financing";

const loan = (overrides: Partial<Loan> = {}): Loan => ({
  kind: "loan",
  id: "loan",
  name: "Equipment loan",
  amount: "1200000",
  rate: "0.06",
  years: 10,
  repayment: "equal_principal",
  fromYear: 2025,
  ...overrides,
});

const round = (value: { toFixed: (n: number) => string }) => value.toFixed(2);

describe("loanSchedule", () => {
  it("repays equal monthly principal with interest on the balance", () => {
    const [first, second] = loanSchedule(loan(), 2);
    expect(round(first!.principal)).toBe("120000.00");
    // 0.5% a month on 1,200,000 down to 1,090,000.
    expect(round(first!.interest)).toBe("68700.00");
    expect(round(first!.balance)).toBe("1080000.00");
    expect(round(second!.interest)).toBe("61500.00");
  });

  it("blends principal and interest in level payments", () => {
    const schedule = loanSchedule(
      loan({ amount: "1000000", years: 25, repayment: "blended" }),
      26,
    );
    // A level payment of 6,443.014 a month.
    for (const year of schedule.slice(0, 25))
      expect(round(year.interest.plus(year.principal))).toBe("77316.17");
    expect(round(schedule[0]!.interest)).toBe("59515.78");
    expect(round(schedule[24]!.balance)).toBe("0.00");
    expect(round(schedule[25]!.principal)).toBe("0.00");
  });

  it("charges interest only when asked", () => {
    const [first] = loanSchedule(
      loan({ repayment: "interest_only", years: 0 }),
      1,
    );
    expect(round(first!.interest)).toBe("72000.00");
    expect(round(first!.principal)).toBe("0.00");
    expect(round(first!.balance)).toBe("1200000.00");
  });
});

describe("financingValues", () => {
  const periods = [
    { end: "2024-12-31", months: 12 },
    { end: "2025-12-31", months: 12 },
    { end: "2026-12-31", months: 12 },
  ];

  it("applies loans and subordinations from their year on", () => {
    const values = financingValues(
      [
        loan(),
        {
          kind: "subordination",
          id: "sub",
          name: "Shareholder loans postponed",
          amount: "500000",
          interestSaved: "25000",
          principalSaved: "0",
          fromYear: 2026,
        },
      ],
      periods,
    );
    const show = (code: keyof typeof values) =>
      values[code].map((v) => round(v.value));
    expect(show("PROFORMA_DEBT")).toEqual(["0.00", "1080000.00", "960000.00"]);
    expect(show("PROFORMA_DEBT_CURRENT")).toEqual([
      "0.00",
      "120000.00",
      "120000.00",
    ]);
    expect(show("PROFORMA_PROCEEDS")).toEqual(["0.00", "1200000.00", "0.00"]);
    expect(show("PROFORMA_PRINCIPAL")).toEqual([
      "0.00",
      "120000.00",
      "120000.00",
    ]);
    expect(show("PROFORMA_INTEREST")).toEqual(["0.00", "68700.00", "36500.00"]);
    expect(show("PROFORMA_TO_EQUITY")).toEqual(["0.00", "0.00", "500000.00"]);
    expect(values.PROFORMA_INTEREST[2]!.parts).toEqual([
      { id: "loan", name: "Equipment loan", value: "61500" },
      { id: "sub", name: "Shareholder loans postponed", value: "-25000" },
    ]);
  });

  it("scales flows to the months a period covers", () => {
    const values = financingValues(
      [loan()],
      [{ end: "2025-06-30", months: 6 }],
    );
    expect(round(values.PROFORMA_PRINCIPAL[0]!.value)).toBe("60000.00");
    expect(round(values.PROFORMA_DEBT[0]!.value)).toBe("1080000.00");
  });
});

describe("normalizeAdjustments", () => {
  it("reads amounts and rates as typed", () => {
    const [normalized, sub] = normalizeAdjustments([
      {
        kind: "loan",
        name: " Building loan ",
        amount: "3,000,000",
        rate: "6.5",
        years: "20",
        repayment: "blended",
        fromYear: "2025",
      },
      {
        kind: "subordination",
        name: "Postponed advances",
        amount: "$400,000",
        fromYear: 2025,
      },
    ]);
    expect(normalized).toMatchObject({
      kind: "loan",
      name: "Building loan",
      amount: "3000000",
      rate: "0.065",
      years: 20,
      fromYear: 2025,
    });
    expect(normalized!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sub).toMatchObject({
      amount: "400000",
      interestSaved: "0",
      principalSaved: "0",
    });
    expect(
      normalizeAdjustments([
        {
          kind: "loan",
          id: "keep",
          name: "A",
          amount: "1",
          rate: "5%",
          years: 1,
          repayment: "blended",
          fromYear: 2025,
        },
      ])[0],
    ).toMatchObject({ id: "keep", rate: "0.05" });
  });

  it("refuses what can't be financed", () => {
    const base = {
      kind: "loan",
      name: "A",
      amount: "100",
      rate: "5%",
      years: 5,
      repayment: "blended",
      fromYear: 2025,
    };
    for (const bad of [
      { name: " " },
      { amount: "0" },
      { amount: "-5" },
      { rate: "150%" },
      { years: 0 },
      { repayment: "balloon" },
      { fromYear: "soon" },
      { kind: "grant" },
    ]) {
      expect(() => normalizeAdjustments([{ ...base, ...bad }])).toThrow();
    }
  });
});
