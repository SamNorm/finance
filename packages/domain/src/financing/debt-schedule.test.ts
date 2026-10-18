import { describe, expect, it } from "vitest";
import { amortize, monthIndex } from "./amortization";
import { debtScheduleValues, normalizeDebtSchedule } from "./debt-schedule";

const round = (value: { toFixed: (n: number) => string } | null) =>
  value?.toFixed(2) ?? null;

describe("amortize", () => {
  const date = "2025-09-30";
  const start = monthIndex(date);

  it("runs forward from its date and back before it on the same payments", () => {
    const loan = amortize(
      {
        balance: "1200000",
        rate: "0.06",
        repayment: "equal_principal",
        months: 120,
      },
      date,
      true,
    );
    // October to December: three payments of 10,000.
    expect(round(loan.flows(start, start + 3).principal)).toBe("30000.00");
    expect(round(loan.balanceAt(start + 3))).toBe("1170000.00");
    // January to September, before the schedule's date.
    expect(round(loan.flows(start - 9, start).principal)).toBe("90000.00");
    expect(round(loan.balanceAt(start - 9))).toBe("1290000.00");
    // Interest on the opening balance of each month.
    expect(round(loan.flows(start, start + 1).interest)).toBe("6000.00");
    expect(round(loan.flows(start - 1, start).interest)).toBe("6050.00");
  });

  it("owes nothing before a new loan is drawn", () => {
    const loan = amortize(
      { balance: "100000", rate: "0.06", repayment: "blended", months: 60 },
      date,
    );
    expect(round(loan.balanceAt(start - 1))).toBe("0.00");
    expect(round(loan.flows(start - 12, start).interest)).toBe("0.00");
    expect(round(loan.balanceAt(start + 60))).toBe("0.00");
    // Level payments of 1,933.28 a month.
    const year = loan.flows(start, start + 12);
    expect(round(year.interest.plus(year.principal))).toBe("23199.36");
  });
});

describe("debt schedule", () => {
  const schedule = normalizeDebtSchedule({
    asOf: "2025-09-30",
    loans: [
      {
        name: "Term loan",
        balance: "1,200,000",
        rate: "6%",
        repayment: "equal_principal",
        years: "10",
      },
      {
        name: "Shareholder advance",
        balance: "300000",
        rate: "4",
        repayment: "interest_only",
      },
    ],
  });

  it("reads loans as typed", () => {
    expect(
      schedule.loans.map((l) => [l.name, l.balance, l.rate, l.months]),
    ).toEqual([
      ["Term loan", "1200000", "0.06", 120],
      ["Shareholder advance", "300000", "0.04", 0],
    ]);
    expect(normalizeDebtSchedule({ asOf: "", loans: [] })).toEqual({
      asOf: null,
      loans: [],
    });
    for (const bad of [
      {
        asOf: "soon",
        loans: [
          {
            name: "A",
            balance: "1",
            rate: "1%",
            repayment: "blended",
            years: 1,
          },
        ],
      },
      {
        asOf: "2025-09-30",
        loans: [
          {
            name: "A",
            balance: "0",
            rate: "1%",
            repayment: "blended",
            years: 1,
          },
        ],
      },
      {
        asOf: "2025-09-30",
        loans: [
          {
            name: "A",
            balance: "1",
            rate: "1%",
            repayment: "balloon",
            years: 1,
          },
        ],
      },
      {
        asOf: "2025-09-30",
        loans: [
          {
            name: "A",
            balance: "1",
            rate: "1%",
            repayment: "blended",
            years: 0,
          },
        ],
      },
    ])
      expect(() => normalizeDebtSchedule(bad)).toThrow();
  });

  it("fills projected years, leaves actual ones blank, and shows a year ahead post-project", () => {
    const periods = [
      { end: "2024-12-31", months: 12, mode: "actual" as const },
      { end: "2025-09-30", months: 9, mode: "actual" as const },
      { end: "2025-12-31", months: 12, mode: "projected" as const },
    ];
    const asIs = debtScheduleValues(schedule, periods);
    expect(asIs.principal.slice(0, 2)).toEqual([null, null]);
    // The whole of 2025: nine months before the schedule's date, three after.
    expect(round(asIs.principal[2]!.value)).toBe("120000.00");
    expect(round(asIs.balance[2]!.value)).toBe("1470000.00");
    expect(asIs.interest[2]!.parts.map((p) => p.name)).toEqual([
      "Term loan",
      "Shareholder advance",
    ]);

    const post = debtScheduleValues(
      schedule,
      periods.map((p) => ({
        ...p,
        mode: p.mode === "actual" ? ("proForma" as const) : p.mode,
      })),
      monthIndex("2025-10-31"),
    );
    // Twelve months after closing, scaled to nine months for the YTD.
    expect(round(post.principal[0]!.value)).toBe("120000.00");
    expect(round(post.principal[1]!.value)).toBe("90000.00");
    expect(round(post.balance[0]!.value)).toBe("1490000.00");
  });
});
