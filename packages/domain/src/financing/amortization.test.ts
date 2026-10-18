import { describe, expect, it } from "vitest";
import { amortize, monthIndex } from "./amortization";
import { parseTerms } from "./common";

const round = (value: { toFixed: (n: number) => string } | null) =>
  value?.toFixed(2) ?? null;

describe("moratoriums and payment frequencies", () => {
  const start = monthIndex("2025-09-30");

  it("repays principal over what's left when the amortization includes the moratorium", () => {
    // 20 years with a year of interest only: principal over the next 19.
    const terms = {
      balance: "2280000",
      rate: "0.06",
      repayment: "equal_principal" as const,
      months: 240,
    };
    const within = amortize(
      {
        ...terms,
        moratorium: { kind: "principal", months: 12, included: true },
      },
      start,
    );
    const first = within.flows(start, start + 12);
    expect(round(first.principal)).toBe("0.00");
    expect(round(first.interest)).toBe("136800.00");
    expect(round(within.balanceAt(start + 12))).toBe("2280000.00");
    // 2,280,000 over 228 months.
    expect(round(within.flows(start + 12, start + 24).principal)).toBe(
      "120000.00",
    );
    expect(within.payments()).toHaveLength(240);
    expect(round(within.balanceAt(start + 240))).toBe("0.00");
    expect(within.payments().filter((p) => p.moratorium)).toHaveLength(12);

    // Before the amortization: 20 more years after the moratorium.
    const before = amortize(
      {
        ...terms,
        moratorium: { kind: "principal", months: 12, included: false },
      },
      start,
    );
    expect(round(before.flows(start + 12, start + 24).principal)).toBe(
      "114000.00",
    );
    expect(before.payments()).toHaveLength(252);
    expect(round(before.balanceAt(start + 251))).toBe("9500.00");
  });

  it("capitalizes interest in a moratorium on principal and interest", () => {
    const loan = amortize(
      {
        balance: "100000",
        rate: "0.12",
        repayment: "blended",
        months: 12,
        moratorium: { kind: "full", months: 3, included: false },
      },
      start,
    );
    const held = loan.flows(start, start + 3);
    expect(round(held.interest)).toBe("0.00");
    expect(round(held.principal)).toBe("0.00");
    expect(
      loan
        .payments()
        .slice(0, 3)
        .map((p) => round(p.capitalized)),
    ).toEqual(["1000.00", "1010.00", "1020.10"]);
    expect(round(loan.balanceAt(start + 3))).toBe("103030.10");
    // Level payments of 9,154.10 on the larger balance, repaid in a year.
    const year = loan.flows(start + 3, start + 15);
    expect(round(year.interest.plus(year.principal))).toBe("109849.19");
    expect(round(loan.balanceAt(start + 15))).toBe("0.00");
  });

  it("pays once a period at the period's rate", () => {
    const quarterly = amortize(
      {
        balance: "100000",
        rate: "0.08",
        repayment: "blended",
        months: 60,
        frequency: "quarterly",
      },
      start,
    );
    expect(round(quarterly.flows(start, start + 2).interest)).toBe("0.00");
    const first = quarterly.flows(start, start + 3);
    expect(round(first.interest)).toBe("2000.00");
    expect(round(first.interest.plus(first.principal))).toBe("6115.67");
    expect(quarterly.payments().map((p) => p.month - start)).toEqual(
      Array.from({ length: 20 }, (_, i) => (i + 1) * 3),
    );
    // Between payments the balance holds.
    expect(round(quarterly.balanceAt(start + 5))).toBe(
      round(quarterly.balanceAt(start + 3)),
    );
    expect(round(quarterly.balanceAt(start + 60))).toBe("0.00");
  });

  it("runs an existing loan in a moratorium back on moratorium payments", () => {
    const principal = amortize(
      {
        balance: "500000",
        rate: "0.06",
        repayment: "blended",
        months: 120,
        moratorium: { kind: "principal", months: 6, included: false },
      },
      start,
      true,
    );
    expect(round(principal.flows(start - 3, start).interest)).toBe("7500.00");
    expect(round(principal.flows(start - 3, start).principal)).toBe("0.00");
    expect(round(principal.balanceAt(start - 3))).toBe("500000.00");

    const full = amortize(
      {
        balance: "103030.10",
        rate: "0.12",
        repayment: "blended",
        months: 12,
        moratorium: { kind: "full", months: 3, included: false },
      },
      start,
      true,
    );
    expect(round(full.flows(start - 3, start).interest)).toBe("0.00");
    expect(round(full.balanceAt(start - 3))).toBe("100000.00");
  });

  it("reads terms as typed and as saved", () => {
    expect(
      parseTerms(
        {
          repayment: "blended",
          years: "20",
          frequency: "quarterly",
          moratorium: "principal",
          moratoriumMonths: "12",
          moratoriumIncluded: "true",
        },
        "Loan",
      ),
    ).toEqual({
      repayment: "blended",
      months: 240,
      frequency: "quarterly",
      moratorium: { kind: "principal", months: 12, included: true },
    });
    // A saved loan, copied.
    expect(
      parseTerms(
        {
          repayment: "equal_principal",
          months: 60,
          frequency: "monthly",
          moratorium: { kind: "full", months: 6, included: false },
        },
        "Loan",
      ).moratorium,
    ).toEqual({ kind: "full", months: 6, included: false });
    // Monthly unless said otherwise; no moratorium on interest only.
    expect(
      parseTerms(
        { repayment: "interest_only", moratorium: "full", moratoriumMonths: 6 },
        "Loan",
      ),
    ).toEqual({ repayment: "interest_only", months: 0, frequency: "monthly" });

    const bad = [
      // Not a whole number of quarters.
      { repayment: "blended", years: "7.4", frequency: "quarterly" },
      { repayment: "blended", years: "5", frequency: "weekly" },
      { repayment: "blended", years: "5", moratorium: "sometimes" },
      { repayment: "blended", years: "5", moratorium: "full" },
      {
        repayment: "blended",
        years: "5",
        frequency: "semiannual",
        moratorium: "principal",
        moratoriumMonths: "4",
      },
      {
        repayment: "blended",
        years: "1",
        moratorium: "principal",
        moratoriumMonths: "12",
        moratoriumIncluded: "true",
      },
    ];
    for (const terms of bad) expect(() => parseTerms(terms, "Loan")).toThrow();
  });
});
