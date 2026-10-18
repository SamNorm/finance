import { describe, expect, it } from "vitest";
import {
  amortize,
  monthIndex,
  paymentCount,
  paymentDate,
} from "./amortization";
import { parseTerms } from "./common";

const round = (value: { toFixed: (n: number) => string } | null) =>
  value?.toFixed(2) ?? null;

describe("moratoriums and payment frequencies", () => {
  const date = "2025-09-30";
  const start = monthIndex(date);

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
        moratorium: { kind: "principal", payments: 12, included: true },
      },
      date,
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
        moratorium: { kind: "principal", payments: 12, included: false },
      },
      date,
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
        moratorium: { kind: "full", payments: 3, included: false },
      },
      date,
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
      date,
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

  it("dates payments by the frequency", () => {
    // A month-end start pays at month ends; other days keep their day.
    expect(paymentDate(date, "monthly", 1)).toBe("2025-10-31");
    expect(paymentDate("2025-01-31", "monthly", 1)).toBe("2025-02-28");
    expect(paymentDate("2025-01-15", "quarterly", 1)).toBe("2025-04-15");
    expect(paymentDate(date, "weekly", 1)).toBe("2025-10-07");
    expect(paymentDate(date, "biweekly", -1)).toBe("2025-09-16");
    // Twice a month: the 15th and the last day, from the next month.
    expect(
      [-2, -1, 0, 1, 2, 3].map((k) => paymentDate(date, "semimonthly", k)),
    ).toEqual([
      "2025-08-31",
      "2025-09-15",
      "2025-09-30",
      "2025-10-15",
      "2025-10-31",
      "2025-11-15",
    ]);
    expect(paymentCount(240, "weekly")).toBe(1040);
    expect(paymentCount(89, "quarterly")).toBe(30);
  });

  it("pays every two weeks, counting a moratorium in payments", () => {
    const loan = amortize(
      {
        balance: "52000",
        rate: "0.052",
        repayment: "equal_principal",
        months: 12,
        frequency: "biweekly",
        moratorium: { kind: "principal", payments: 10, included: false },
      },
      date,
    );
    const payments = loan.payments();
    expect(payments).toHaveLength(36);
    expect(round(payments[0]!.interest)).toBe("104.00");
    // Ten two-week periods of interest only, then 26 payments of 2,000.
    expect(payments.filter((p) => p.moratorium)).toHaveLength(10);
    expect(payments[10]!.date).toBe("2026-03-03");
    expect(round(payments[10]!.principal)).toBe("2000.00");
    // 22 of the 26 paid by the end of 2026.
    expect(round(loan.balanceAt(monthIndex("2026-12-31")))).toBe("8000.00");
  });

  it("counts 52 weekly payments in any twelve months", () => {
    const loan = amortize(
      {
        balance: "1040000",
        rate: "0.05",
        repayment: "equal_principal",
        months: 240,
        frequency: "weekly",
      },
      // A Thursday: 2026 has 53 of them, but counts 52 payments.
      "2025-12-25",
    );
    const twelve = (end: string) =>
      loan.flows(monthIndex(end) - 12, monthIndex(end)).principal;
    for (const end of ["2026-12-31", "2027-12-31", "2028-06-30", "2044-03-31"])
      expect(round(twelve(end))).toBe("52000.00");
    expect(loan.payments()).toHaveLength(1040);
    expect(loan.payments().at(-1)!.month).toBe(monthIndex("2045-12-31"));
  });

  it("pays twice a month", () => {
    const loan = amortize(
      {
        balance: "240000",
        rate: "0.06",
        repayment: "equal_principal",
        months: 120,
        frequency: "semimonthly",
      },
      date,
    );
    const october = loan.flows(start, start + 1);
    expect(round(october.principal)).toBe("2000.00");
    expect(round(october.interest)).toBe("1197.50");
    expect(round(loan.balanceAt(start + 12))).toBe("216000.00");
  });

  it("runs an existing loan in a moratorium back on moratorium payments", () => {
    const principal = amortize(
      {
        balance: "500000",
        rate: "0.06",
        repayment: "blended",
        months: 120,
        moratorium: { kind: "principal", payments: 6, included: false },
      },
      date,
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
        moratorium: { kind: "full", payments: 3, included: false },
      },
      date,
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
          frequency: "biweekly",
          moratorium: "principal",
          moratoriumPayments: "10",
          moratoriumIncluded: "true",
        },
        "Loan",
      ),
    ).toEqual({
      repayment: "blended",
      months: 240,
      frequency: "biweekly",
      moratorium: { kind: "principal", payments: 10, included: true },
    });
    // A saved loan, copied.
    expect(
      parseTerms(
        {
          repayment: "equal_principal",
          months: 60,
          frequency: "monthly",
          moratorium: { kind: "full", payments: 6, included: false },
        },
        "Loan",
      ).moratorium,
    ).toEqual({ kind: "full", payments: 6, included: false });
    // Monthly unless said otherwise; no moratorium on interest only.
    expect(
      parseTerms(
        {
          repayment: "interest_only",
          moratorium: "full",
          moratoriumPayments: 6,
        },
        "Loan",
      ),
    ).toEqual({ repayment: "interest_only", months: 0, frequency: "monthly" });

    const bad = [
      { repayment: "blended", years: "5", frequency: "daily" },
      { repayment: "blended", years: "5", moratorium: "sometimes" },
      { repayment: "blended", years: "5", moratorium: "full" },
      {
        repayment: "blended",
        years: "5",
        moratorium: "principal",
        moratoriumPayments: "2.5",
      },
      // More than ten years of weekly payments.
      {
        repayment: "blended",
        years: "25",
        frequency: "weekly",
        moratorium: "principal",
        moratoriumPayments: "521",
      },
      // A year of biweekly payments is 26.
      {
        repayment: "blended",
        years: "1",
        frequency: "biweekly",
        moratorium: "principal",
        moratoriumPayments: "26",
        moratoriumIncluded: "true",
      },
    ];
    for (const terms of bad) expect(() => parseTerms(terms, "Loan")).toThrow();
  });
});

describe("schedule adjustments", () => {
  const date = "2025-09-30";
  const start = monthIndex(date);
  const term = {
    balance: "120000",
    rate: "0.06",
    repayment: "equal_principal" as const,
    months: 120,
  };

  it("applies an extra payment and finishes sooner, or keeps the end", () => {
    const sooner = amortize(
      {
        ...term,
        adjustments: [
          {
            id: "a",
            kind: "extra",
            date: "2026-03-15",
            amount: "30000",
            keep: "payment",
          },
        ],
      },
      date,
    );
    const payments = sooner.payments();
    // With the March payment: 120,000 less six payments of 1,000 and 30,000.
    expect(payments[5]!.date).toBe("2026-03-31");
    expect(round(payments[5]!.extra)).toBe("30000.00");
    expect(round(payments[5]!.after)).toBe("84000.00");
    expect(payments).toHaveLength(90);
    // Extra payments stay apart from the scheduled principal.
    const year = sooner.flows(start, start + 12);
    expect(round(year.principal)).toBe("12000.00");
    expect(round(year.extra)).toBe("30000.00");

    const sameEnd = amortize(
      {
        ...term,
        adjustments: [
          {
            id: "a",
            kind: "extra",
            date: "2026-03-15",
            amount: "30000",
            keep: "end",
          },
        ],
      },
      date,
    ).payments();
    expect(sameEnd).toHaveLength(120);
    // 84,000 over the 114 payments left.
    expect(round(sameEnd[6]!.principal)).toBe("736.84");
  });

  it("changes the payment for a while, then goes back to it", () => {
    const loan = amortize(
      {
        balance: "100000",
        rate: "0.12",
        repayment: "blended",
        months: 60,
        adjustments: [
          {
            id: "a",
            kind: "payment",
            date: "2025-10-01",
            amount: "3000",
            until: "2026-09-30",
          },
        ],
      },
      date,
    ).payments();
    const total = (i: number) =>
      round(loan[i]!.interest.plus(loan[i]!.principal));
    expect(total(0)).toBe("3000.00");
    expect(loan.filter((p) => p.changed)).toHaveLength(12);
    // Back to the level payment, so the loan ends sooner.
    expect(total(12)).toBe("2224.44");
    expect(loan.length).toBeLessThan(60);

    // A payment short of the interest capitalizes the rest.
    const short = amortize(
      {
        balance: "100000",
        rate: "0.12",
        repayment: "blended",
        months: 60,
        adjustments: [
          {
            id: "a",
            kind: "payment",
            date: "2025-10-01",
            amount: "500",
            until: null,
          },
        ],
      },
      date,
    ).payments(24);
    expect(round(short[0]!.interest)).toBe("500.00");
    expect(round(short[0]!.capitalized)).toBe("500.00");
    expect(round(short[0]!.after)).toBe("100500.00");
  });

  it("skips payments, then ends later or keeps the end", () => {
    const later = amortize(
      {
        ...term,
        adjustments: [
          {
            id: "a",
            kind: "skip",
            date: "2026-01-01",
            payments: 3,
            suspends: "principal",
            keep: "payment",
          },
        ],
      },
      date,
    ).payments();
    expect(later).toHaveLength(123);
    expect(later.filter((p) => p.skipped).map((p) => p.date)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
    // Interest is still paid while principal is skipped.
    expect(round(later[3]!.interest)).toBe("585.00");
    expect(round(later[3]!.principal)).toBe("0.00");

    const sameEnd = amortize(
      {
        ...term,
        adjustments: [
          {
            id: "a",
            kind: "skip",
            date: "2025-10-01",
            payments: 2,
            suspends: "full",
            keep: "end",
          },
        ],
      },
      date,
    ).payments();
    // 120,000 with two months of interest capitalized, over 118 payments.
    expect(round(sameEnd[1]!.after)).toBe("121203.00");
    expect(round(sameEnd[2]!.principal)).toBe("1027.14");
    expect(sameEnd).toHaveLength(120);
  });

  it("keeps the payment a moratorium would have led to after an extra payment in it", () => {
    const loan = amortize(
      {
        balance: "100000",
        rate: "0.12",
        repayment: "blended",
        months: 12,
        moratorium: { kind: "full", payments: 3, included: false },
        adjustments: [
          {
            id: "a",
            kind: "extra",
            date: "2025-11-30",
            amount: "50000",
            keep: "payment",
          },
        ],
      },
      date,
    ).payments();
    expect(round(loan[2]!.after)).toBe("52530.10");
    // The 9,154.10 the loan pays without the extra payment.
    expect(round(loan[3]!.interest.plus(loan[3]!.principal))).toBe("9154.10");
    expect(loan.length).toBeLessThan(15);
  });
});
