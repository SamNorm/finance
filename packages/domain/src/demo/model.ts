import type { ScenarioInput } from "../analyses/service";
import type { CovenantInput } from "../covenants/covenants";
import type { ChartDefinition } from "../financial-models/charts";
import { assumption, calc, complete, header, type Line } from "./lines";

// The demo financial model: an annual review of debt service, leverage and
// liquidity, with covenant tests, simple projections and post-project
// financing read through the PROFORMA_ inputs. Coverage comes three ways:
// on cash flow available for debt service, and on free cash flow after
// distributions, with and without the capex plan's purchases paid from
// cash. Codes refer to the fictional commercial banking template.

const LINES: Line[] = [
  header("SEC_ASSUMPTIONS", "Projection assumptions"),
  assumption(
    "REVENUE_GROWTH",
    "Projected revenue growth",
    "percent",
    "0.03",
    "Annual growth applied in projected years.",
  ),
  assumption(
    "MARGIN_SHIFT",
    "EBITDA margin change",
    "percent",
    "0",
    "Added to the prior year's EBITDA margin each projected year.",
  ),
  assumption(
    "TAX_RATE",
    "Tax rate",
    "percent",
    "0.265",
    "On projected taxable income.",
  ),
  assumption(
    "ASSUMED_DIVIDENDS",
    "Dividends assumed",
    "amount",
    null,
    "Dividends a scenario assumes, year by year. Blank keeps those paid, and projected, last year's.",
  ),
  assumption(
    "ASSUMED_ADVANCES",
    "Advances to shareholders assumed",
    "amount",
    null,
    "Advances to shareholders a scenario assumes, year by year. Blank keeps the statements', and none projected.",
  ),

  header("SEC_PROFITABILITY", "Profitability"),
  calc(
    "SALES",
    "Revenue",
    "amount",
    "REVENUE",
    "PREV(SALES) * (1 + REVENUE_GROWTH)",
  ),
  calc("SALES_GROWTH", "Revenue growth", "percent", "GROWTH(SALES)"),
  calc(
    "EBITDA",
    "EBITDA",
    "amount",
    "OPERATING_INCOME + DEPRECIATION + AMORTIZATION",
    "SALES * EBITDA_MARGIN",
  ),
  calc(
    "EBITDA_MARGIN",
    "EBITDA margin",
    "percent",
    "EBITDA / SALES",
    "PREV(EBITDA_MARGIN) + MARGIN_SHIFT",
  ),

  header("SEC_DEBT_SERVICE", "Debt service coverage"),
  calc(
    "DA",
    "Depreciation and amortization",
    "amount",
    "DEPRECIATION + AMORTIZATION",
    "PREV(DA)",
  ),
  calc(
    "EXISTING_INTEREST",
    "Interest on existing debt",
    "amount",
    "IF(ISBLANK(DEBT_SCHEDULE_INTEREST), TOTAL_INTEREST_EXPENSE, DEBT_SCHEDULE_INTEREST)",
    "IF(ISBLANK(DEBT_SCHEDULE_INTEREST), PREV(EXISTING_INTEREST), DEBT_SCHEDULE_INTEREST)",
    "From the statements; post-project and projected, the debt schedule's interest.",
  ),
  calc(
    "INTEREST",
    "Interest expense",
    "amount",
    "EXISTING_INTEREST + PROFORMA_INTEREST + PROFORMA_LINE_INTEREST + CAPEX_INTEREST",
    null,
    "Existing interest plus the project's new loans and line of credit, and the capex plan's loans.",
  ),
  calc(
    "CASH_TAXES",
    "Cash taxes",
    "amount",
    "CURRENT_INCOME_TAX",
    "MAX(0, EBITDA - DA - INTEREST) * TAX_RATE",
  ),
  calc(
    "MAINT_CAPEX",
    "Maintenance capex",
    "amount",
    "MAINTENANCE_CAPEX",
    "PREV(MAINT_CAPEX)",
  ),
  calc(
    "CFADS",
    "Cash flow available for debt service",
    "amount",
    "EBITDA - CASH_TAXES - MAINT_CAPEX",
    null,
    "EBITDA less cash taxes and the capex needed to sustain operations.",
  ),
  calc(
    "EXISTING_PRINCIPAL",
    "Principal on existing debt",
    "amount",
    "IF(ISBLANK(DEBT_SCHEDULE_PRINCIPAL), IFERROR(PREV(CPLTD + CURRENT_LEASE_LIABILITIES), CPLTD + CURRENT_LEASE_LIABILITIES) * MONTHS() / 12, DEBT_SCHEDULE_PRINCIPAL)",
    "IF(ISBLANK(DEBT_SCHEDULE_PRINCIPAL), PREV(EXISTING_PRINCIPAL), DEBT_SCHEDULE_PRINCIPAL)",
    "The current portion at the previous year end; post-project and projected, the debt schedule's principal.",
  ),
  calc(
    "PRINCIPAL",
    "Scheduled principal",
    "amount",
    "EXISTING_PRINCIPAL + PROFORMA_PRINCIPAL + CAPEX_PRINCIPAL",
    null,
    "Existing principal plus the project's new loans and the capex plan's.",
  ),
  calc("DEBT_SERVICE", "Debt service", "amount", "INTEREST + PRINCIPAL"),
  calc("DSCR", "Debt service coverage", "ratio", "CFADS / DEBT_SERVICE"),

  header("SEC_FREE_CASH_FLOW", "Free cash flow coverage"),
  calc(
    "DIVIDENDS",
    "Dividends",
    "amount",
    "IF(ISBLANK(ASSUMED_DIVIDENDS), CF_DIVIDENDS, ASSUMED_DIVIDENDS)",
    "IF(ISBLANK(ASSUMED_DIVIDENDS), PREV(DIVIDENDS), ASSUMED_DIVIDENDS)",
    "Paid, from the cash flow statement, unless the scenario assumes an amount for the year; projected, last year's.",
  ),
  calc(
    "ADVANCES",
    "Advances to shareholders",
    "amount",
    "IF(ISBLANK(ASSUMED_ADVANCES), MAX(0, -CF_SHAREHOLDER_ADVANCES), ASSUMED_ADVANCES)",
    null,
    "Net advances to shareholders from the cash flow statement, unless the scenario assumes an amount for the year.",
  ),
  calc(
    "CAPEX_FROM_CASH",
    "Capex paid from cash",
    "amount",
    "CAPEX_SPENT - CAPEX_FINANCED",
    null,
    "The capex plan's purchases its loans don't finance, on top of maintenance capex.",
  ),
  calc(
    "FREE_CASH_FLOW",
    "Free cash flow",
    "amount",
    "CFADS - DIVIDENDS - ADVANCES - CAPEX_FROM_CASH",
    null,
    "Cash flow available for debt service, less distributions to shareholders and capex paid from cash.",
  ),
  calc(
    "FCF_COVERAGE",
    "Free cash flow coverage",
    "ratio",
    "FREE_CASH_FLOW / DEBT_SERVICE",
  ),
  calc(
    "FCF_COVERAGE_BEFORE_CAPEX",
    "Free cash flow coverage before capex",
    "ratio",
    "(FREE_CASH_FLOW + CAPEX_FROM_CASH) / DEBT_SERVICE",
    null,
    "After distributions, without penalizing capex paid from cash.",
  ),

  header("SEC_LEVERAGE", "Leverage and liquidity"),
  calc(
    "FUNDED_DEBT",
    "Funded debt",
    "amount",
    "BANK_INDEBTEDNESS + CPLTD + CURRENT_LEASE_LIABILITIES + LONG_TERM_DEBT + LEASE_LIABILITIES + SUBORDINATED_DEBT",
    "MAX(0, PREV(FUNDED_DEBT) - PRINCIPAL + CAPEX_FINANCED)",
    "Interest-bearing debt on the balance sheet, which post-project includes the new loans; projected, less principal repaid, plus what the capex plan borrows.",
  ),
  calc(
    "DEBT_TO_EBITDA",
    "Funded debt to EBITDA",
    "ratio",
    "FUNDED_DEBT / EBITDA",
  ),
  calc(
    "CURRENT_RATIO",
    "Current ratio",
    "ratio",
    "TOTAL_CURRENT_ASSETS / TOTAL_CURRENT_LIABILITIES",
    "PREV(CURRENT_RATIO)",
  ),
  calc(
    "TNW",
    "Tangible net worth",
    "amount",
    "TOTAL_EQUITY - GOODWILL - INTANGIBLES - DUE_FROM_RELATED_LT + PROFORMA_TO_EQUITY",
    "PREV(TNW) + EBITDA - DA - INTEREST - CASH_TAXES",
    "Equity less intangibles and amounts due from related parties, plus debt subordinated to the lender.",
  ),
];

export const DEMO_MODEL = {
  name: "Annual review: debt service",
  description:
    "Debt service coverage, before and after distributions, leverage and liquidity, the ratios borrowers' covenants test, with a two-year projection and post-project financing.",
  charts: [
    {
      id: "dscr",
      title: "Debt service coverage",
      series: [{ code: "DSCR", mark: "line" }],
      threshold: null,
    },
    {
      id: "free-cash-flow",
      title: "Coverage before and after distributions",
      series: [
        { code: "DSCR", mark: "line" },
        { code: "FCF_COVERAGE", mark: "line" },
      ],
      threshold: null,
    },
    {
      id: "leverage",
      title: "Funded debt to EBITDA",
      series: [{ code: "DEBT_TO_EBITDA", mark: "line" }],
      threshold: null,
    },
    {
      id: "revenue",
      title: "Revenue and EBITDA",
      series: [
        { code: "SALES", mark: "bar" },
        { code: "EBITDA", mark: "bar" },
      ],
      threshold: null,
    },
  ] satisfies ChartDefinition[],
  lines: complete(LINES),
};

// The covenants of each demo borrower's credit agreement, kept on the
// borrower: coverage, leverage stepping down after 2025, and liquidity.
export const DEMO_COVENANTS: CovenantInput[] = [
  {
    name: "Debt service coverage",
    metric: "DSCR",
    test: "min",
    threshold: "1.25",
    note: "Cash flow available for debt service over interest and scheduled principal, at each fiscal year end.",
  },
  {
    name: "Funded debt to EBITDA",
    metric: "DEBT_TO_EBITDA",
    test: "max",
    thresholds: [{ value: "3.5" }, { from: "2026", value: "3.0" }],
  },
  {
    name: "Current ratio",
    metric: "CURRENT_RATIO",
    test: "min",
    threshold: "1.2",
  },
];

// Northwind's capex plan: a second machining line in mid-2026, 75% on a
// ten-year loan, and warehouse racking before that, paid from cash.
export const DEMO_CAPEX_SCENARIO: ScenarioInput = {
  name: "Capex plan: second line in 2026",
  capex: [
    {
      name: "Warehouse racking",
      date: "2025-09-30",
      amount: "150000",
    },
    {
      name: "Second machining line",
      date: "2026-06-30",
      amount: "1800000",
      financed: "75%",
      rate: "7%",
      repayment: "blended",
      years: 10,
    },
  ],
};

// Scenarios added to each demo analysis: two stresses, and new equipment
// financed by a term loan and an equity injection, with a larger operating
// line and the shareholders' loans postponed in favour of the lender. The
// deal proposes covenants of its own: coverage eased, and leverage given
// room until the new line pays off. It also assumes dividends held to half
// of the last year's (`dividends`) until 2026, then three quarters.
export function demoScenarios(
  shareholderLoans: string,
  dividends = "0",
): ScenarioInput[] {
  const share = (rate: number) => String(Math.round(Number(dividends) * rate));
  return [
    { name: "Revenue −15%", overrides: { REVENUE_GROWTH: "-0.15" } },
    { name: "Margin squeeze", overrides: { MARGIN_SHIFT: "-0.02" } },
    {
      name: "Post-project: new equipment",
      ...(Number(dividends) > 0
        ? {
            periodOverrides: {
              ASSUMED_DIVIDENDS: {
                "2024-12-31": share(0.5),
                "2025-12-31": share(0.5),
                "2026-12-31": share(0.75),
              },
            },
          }
        : {}),
      project: {
        closing: "2025-01-31",
        sources: [
          {
            kind: "loan",
            name: "Equipment loan",
            amount: "1600000",
            rate: "6.8%",
            repayment: "blended",
            years: "7",
          },
          {
            kind: "funds",
            name: "Equity injection",
            amount: "400000",
            item: "SHARE_CAPITAL",
          },
        ],
        uses: [
          { name: "New equipment", amount: "1950000", item: "MACHINERY" },
          {
            name: "Closing and installation costs",
            amount: "50000",
            item: "RETAINED_EARNINGS",
          },
        ],
        lines: [
          {
            name: "Operating line increase",
            increase: "500000",
            usage: "60%",
            rate: "7.2%",
          },
        ],
        subordinations:
          Number(shareholderLoans) > 0
            ? [
                {
                  name: "Shareholder loans postponed",
                  amount: shareholderLoans,
                  interestSaved: "0",
                  principalSaved: "0",
                },
              ]
            : [],
      },
      covenants: [
        { ...DEMO_COVENANTS[0]!, threshold: "1.20" },
        {
          ...DEMO_COVENANTS[1]!,
          thresholds: [{ value: "4.0" }, { from: "2027", value: "3.5" }],
        },
        DEMO_COVENANTS[2]!,
      ],
    },
  ];
}
