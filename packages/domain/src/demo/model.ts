import type { ScenarioInput } from "../analyses/service";
import type { ChartDefinition } from "../financial-models/charts";
import { assumption, calc, complete, header, type Line } from "./lines";

// The demo financial model: an annual review of debt service, leverage and
// liquidity, with covenant tests, simple projections and post-project
// financing read through the PROFORMA_ inputs. Codes refer to the fictional
// commercial banking template.

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
    "TOTAL_INTEREST_EXPENSE",
    "PREV(EXISTING_INTEREST)",
  ),
  calc(
    "INTEREST",
    "Interest expense",
    "amount",
    "EXISTING_INTEREST + PROFORMA_INTEREST",
    null,
    "Existing interest plus the scenario's post-project financing.",
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
    "IFERROR(PREV(CPLTD + CURRENT_LEASE_LIABILITIES), CPLTD + CURRENT_LEASE_LIABILITIES)",
    "PREV(EXISTING_PRINCIPAL)",
    "The current portion of long-term debt and leases at the previous year end.",
  ),
  calc(
    "PRINCIPAL",
    "Scheduled principal",
    "amount",
    "EXISTING_PRINCIPAL + PROFORMA_PRINCIPAL",
    null,
    "Existing principal plus the scenario's post-project financing.",
  ),
  calc("DEBT_SERVICE", "Debt service", "amount", "INTEREST + PRINCIPAL"),
  calc("DSCR", "Debt service coverage", "ratio", "CFADS / DEBT_SERVICE"),

  header("SEC_LEVERAGE", "Leverage and liquidity"),
  calc(
    "EXISTING_DEBT",
    "Existing funded debt",
    "amount",
    "BANK_INDEBTEDNESS + CPLTD + CURRENT_LEASE_LIABILITIES + LONG_TERM_DEBT + LEASE_LIABILITIES + SUBORDINATED_DEBT",
    "MAX(0, PREV(EXISTING_DEBT) - EXISTING_PRINCIPAL)",
  ),
  calc(
    "FUNDED_DEBT",
    "Funded debt",
    "amount",
    "EXISTING_DEBT + PROFORMA_DEBT",
    null,
    "Existing funded debt plus new loans outstanding.",
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
    "PREV(TNW) + EBITDA - DA - INTEREST - CASH_TAXES + CHANGE(PROFORMA_TO_EQUITY)",
    "Equity less intangibles and amounts due from related parties, plus debt subordinated to the lender.",
  ),

  header("SEC_COVENANTS", "Covenants"),
  assumption(
    "MIN_DSCR",
    "Minimum debt service coverage",
    "ratio",
    "1.25",
    "Covenant threshold.",
  ),
  assumption(
    "MAX_DEBT_TO_EBITDA",
    "Maximum funded debt to EBITDA",
    "ratio",
    "3.5",
    "Covenant threshold.",
  ),
  assumption(
    "MIN_CURRENT_RATIO",
    "Minimum current ratio",
    "ratio",
    "1.2",
    "Covenant threshold.",
  ),
  calc(
    "DSCR_TEST",
    "Debt service coverage covenant",
    "flag",
    "DSCR >= MIN_DSCR",
  ),
  calc(
    "LEVERAGE_TEST",
    "Leverage covenant",
    "flag",
    "DEBT_TO_EBITDA <= MAX_DEBT_TO_EBITDA",
  ),
  calc(
    "LIQUIDITY_TEST",
    "Current ratio covenant",
    "flag",
    "CURRENT_RATIO >= MIN_CURRENT_RATIO",
  ),
];

export const DEMO_MODEL = {
  name: "Annual review: debt service",
  description:
    "Debt service coverage, leverage and liquidity with covenant tests, a two-year projection and post-project financing.",
  charts: [
    {
      id: "dscr",
      title: "Debt service coverage",
      series: [{ code: "DSCR", mark: "line" }],
      threshold: "MIN_DSCR",
    },
    {
      id: "leverage",
      title: "Funded debt to EBITDA",
      series: [{ code: "DEBT_TO_EBITDA", mark: "line" }],
      threshold: "MAX_DEBT_TO_EBITDA",
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

// Scenarios added to each demo analysis: two stresses, and a project
// financed with a new equipment loan from 2025, with the shareholders'
// loans postponed in favour of the lender.
export function demoScenarios(shareholderLoans: string): ScenarioInput[] {
  return [
    { name: "Revenue −15%", overrides: { REVENUE_GROWTH: "-0.15" } },
    { name: "Margin squeeze", overrides: { MARGIN_SHIFT: "-0.02" } },
    {
      name: "Post-project: new equipment",
      adjustments: [
        {
          kind: "loan",
          name: "Equipment loan",
          amount: "2000000",
          rate: "0.068",
          years: 7,
          repayment: "blended",
          fromYear: 2025,
        },
        {
          kind: "subordination",
          name: "Shareholder loans postponed",
          amount: shareholderLoans,
          interestSaved: "0",
          principalSaved: "0",
          fromYear: 2025,
        },
      ],
    },
  ];
}
