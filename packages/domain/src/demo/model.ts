import type { ModelLine } from "../financial-models/types";

// The demo financial model: an annual review of debt service, leverage and
// liquidity, with covenant tests and simple projections. Codes refer to the
// fictional commercial banking template.

type Line = Pick<ModelLine, "code" | "label" | "kind"> & Partial<ModelLine>;

const header = (code: string, label: string): Line => ({
  code,
  label,
  kind: "header",
});
const assumption = (
  code: string,
  label: string,
  format: ModelLine["format"],
  defaultValue: string,
  description: string,
): Line => ({
  code,
  label,
  kind: "assumption",
  format,
  defaultValue,
  description,
});
const calc = (
  code: string,
  label: string,
  format: ModelLine["format"],
  formula: string,
  projectionFormula: string | null = null,
  description: string | null = null,
): Line => ({
  code,
  label,
  kind: "calculation",
  format,
  formula,
  projectionFormula,
  description,
});

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
    "INTEREST",
    "Interest expense",
    "amount",
    "TOTAL_INTEREST_EXPENSE",
    "PREV(INTEREST)",
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
    "PRINCIPAL",
    "Scheduled principal",
    "amount",
    "IFERROR(PREV(CPLTD + CURRENT_LEASE_LIABILITIES), CPLTD + CURRENT_LEASE_LIABILITIES)",
    "PREV(PRINCIPAL)",
    "The current portion of long-term debt and leases at the previous year end.",
  ),
  calc("DEBT_SERVICE", "Debt service", "amount", "INTEREST + PRINCIPAL"),
  calc("DSCR", "Debt service coverage", "ratio", "CFADS / DEBT_SERVICE"),

  header("SEC_LEVERAGE", "Leverage and liquidity"),
  calc(
    "FUNDED_DEBT",
    "Funded debt",
    "amount",
    "BANK_INDEBTEDNESS + CPLTD + CURRENT_LEASE_LIABILITIES + LONG_TERM_DEBT + LEASE_LIABILITIES + SUBORDINATED_DEBT",
    "MAX(0, PREV(FUNDED_DEBT) - PRINCIPAL)",
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
    "TOTAL_EQUITY + SHAREHOLDER_LOANS - GOODWILL - INTANGIBLES - DUE_FROM_RELATED_LT",
    "PREV(TNW) + EBITDA - DA - INTEREST - CASH_TAXES",
    "Equity plus postponed shareholder loans, less intangibles and amounts due from related parties.",
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
    "Debt service coverage, leverage and liquidity with covenant tests and a two-year projection.",
  lines: LINES.map((line): ModelLine => ({
    format: "amount",
    formula: null,
    projectionFormula: null,
    defaultValue: null,
    breaksDown: null,
    description: null,
    ...line,
  })),
};

// Scenarios added to each demo analysis.
export const DEMO_SCENARIOS: {
  name: string;
  overrides: Record<string, string>;
}[] = [
  { name: "Revenue −15%", overrides: { REVENUE_GROWTH: "-0.15" } },
  { name: "Margin squeeze", overrides: { MARGIN_SHIFT: "-0.02" } },
];
