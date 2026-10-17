import type { ScenarioInput } from "../analyses/service";
import type { ChartDefinition } from "../financial-models/charts";
import type { DemoPeriod } from "./companies";
import { assumption, calc, complete, header } from "./lines";

// A fictional income property spread on the fictional real estate template
// (fixtures/real-estate.csv): a 48-unit apartment building, simulated year by
// year so its statements hold together, with a mortgage amortized monthly.
// Any resemblance to a real property is coincidental (§10.1).

export interface DemoProperty {
  name: string;
  industry: string;
  naicsCode: string;
  riskRating: string;
  notes: string;
  periods: DemoPeriod[];
}

const UNITS = 48;
const YEARS = [2022, 2023, 2024];

// Monthly blended payments on the mortgage taken in January 2020.
const MORTGAGE = { amount: 7_600_000, rate: 0.0365, years: 25, from: 2020 };

function mortgageYears() {
  const i = MORTGAGE.rate / 12;
  const n = MORTGAGE.years * 12;
  const payment = (MORTGAGE.amount * i) / (1 - (1 + i) ** -n);
  let balance = MORTGAGE.amount;
  const years = new Map<
    number,
    { interest: number; principal: number; balance: number }
  >();
  for (let year = MORTGAGE.from; year <= 2025; year++) {
    let interest = 0;
    let principal = 0;
    for (let m = 0; m < 12; m++) {
      const owed = balance * i;
      interest += owed;
      principal += payment - owed;
      balance -= payment - owed;
    }
    years.set(year, { interest, principal, balance });
  }
  return { payment, years };
}

export function demoProperty(): DemoProperty {
  const { payment, years: schedule } = mortgageYears();
  const round = Math.round;
  let propertyCost = 9_900_000;
  let accumDep = 1_110_000;
  let equity = 2_050_000;
  const periods = YEARS.map((year, i): DemoPeriod => {
    const baseRent = UNITS * [1_720, 1_795, 1_880][i]! * 12;
    const parking = [34_200, 35_300, 36_400][i]!;
    const other = [11_800, 12_300, 12_900][i]!;
    const vacancyRate = [0.032, 0.021, 0.026][i]!;
    const gpi = baseRent + parking + other;
    const vacancy = round(gpi * vacancyRate);
    const egi = gpi - vacancy;
    const expenses = {
      RE_PROPERTY_TAXES: [118_400, 122_900, 127_600][i]!,
      RE_INSURANCE: [36_200, 41_500, 45_800][i]!,
      RE_UTILITIES: [62_300, 64_100, 66_900][i]!,
      RE_REPAIRS: [68_500, 74_200, 79_800][i]!,
      RE_MANAGEMENT: round(egi * 0.04),
      RE_PAYROLL: [40_200, 41_500, 42_700][i]!,
      RE_OTHER_EXPENSES: [14_100, 14_600, 15_200][i]!,
    };
    const opex = Object.values(expenses).reduce((a, b) => a + b, 0);
    const noi = egi - opex;

    const mortgage = schedule.get(year)!;
    const next = schedule.get(year + 1)!;
    const interest = round(mortgage.interest);
    const improvements = [95_000, 140_000, 120_000][i]!;
    propertyCost += improvements;
    // The building, not the land, depreciates.
    const depreciation = round((propertyCost - 2_500_000) * 0.025);
    accumDep += depreciation;
    const distributions = [180_000, 200_000, 220_000][i]!;
    equity += noi - interest - depreciation - distributions;

    const receivables = [9_800, 8_900, 11_200][i]!;
    const otherAssets = 18_500;
    const payables = round(opex * 0.08);
    const balance = round(mortgage.balance);
    const current = round(next.principal);
    const shareholderLoans = 450_000;
    // Cash balances the sheet.
    const cash =
      payables +
      balance +
      shareholderLoans +
      equity -
      (receivables + otherAssets + propertyCost - accumDep);

    const values: Record<string, number | string> = {
      RE_BASE_RENT: baseRent,
      RE_PARKING: parking,
      RE_OTHER_INCOME: other,
      RE_VACANCY: vacancy,
      ...expenses,
      RE_INTEREST: interest,
      RE_DEPRECIATION: depreciation,
      RE_CASH: round(cash),
      RE_RECEIVABLES: receivables,
      RE_PROPERTY_COST: propertyCost,
      RE_ACCUM_DEP: accumDep,
      RE_OTHER_ASSETS: otherAssets,
      RE_PAYABLES: payables,
      RE_MORTGAGE_CURRENT: current,
      RE_MORTGAGE: balance - current,
      RE_SHAREHOLDER_LOANS: shareholderLoans,
      RE_EQUITY: round(equity),
      RE_PROPERTY_TYPE: "Multi-residential",
      RE_RENTABLE_AREA: 41_800,
      RE_UNITS: UNITS,
      RE_OCCUPANCY: String(1 - vacancyRate),
      RE_MORTGAGE_PAYMENTS: round(payment * 12),
      RE_APPRAISED_VALUE: [11_600_000, 12_400_000, 12_400_000][i]!,
      RE_APPRAISAL_CAP_RATE: String([0.0525, 0.055, 0.055][i]!),
    };
    return {
      year,
      quality: i === 2 ? "review" : "compilation",
      values: Object.fromEntries(
        Object.entries(values).map(([code, v]) => [code, String(v)]),
      ),
    };
  });
  return {
    name: "Rue Saint-Denis Holdings Inc.",
    industry: "Multi-residential rental",
    naicsCode: "531110",
    riskRating: "4",
    notes: "48-unit apartment building in Montréal, owned since 2019.",
    periods,
  };
}

// From rent down to net operating income, its value at a capitalization
// rate, and the mortgage against both.
export const REAL_ESTATE_MODEL = {
  name: "Income property: NOI and value",
  description:
    "Net operating income, economic value at a capitalization rate, loan to value and debt service coverage.",
  lines: complete([
    header("SEC_ASSUMPTIONS", "Assumptions"),
    assumption(
      "CAP_RATE",
      "Capitalization rate",
      "percent",
      "0.0625",
      "Net operating income divided by value, from comparable sales.",
    ),
    assumption(
      "RENT_GROWTH",
      "Rent growth",
      "percent",
      "0.03",
      "Annual growth of potential income in projected years.",
    ),
    assumption(
      "VACANCY_RATE",
      "Vacancy and credit loss",
      "percent",
      "0.03",
      "Share of potential income lost in projected years.",
    ),
    assumption(
      "EXPENSE_GROWTH",
      "Operating expense growth",
      "percent",
      "0.035",
      "Annual growth of operating expenses in projected years.",
    ),

    header("SEC_INCOME", "Net operating income"),
    calc(
      "GPI",
      "Gross potential income",
      "amount",
      "RE_GROSS_POTENTIAL_INCOME",
      "PREV(GPI) * (1 + RENT_GROWTH)",
    ),
    calc(
      "VACANCY",
      "Vacancy and credit loss",
      "amount",
      "RE_VACANCY",
      "GPI * VACANCY_RATE",
    ),
    calc("EGI", "Effective gross income", "amount", "GPI - VACANCY"),
    calc(
      "OPEX",
      "Operating expenses",
      "amount",
      "RE_OPERATING_EXPENSES",
      "PREV(OPEX) * (1 + EXPENSE_GROWTH)",
    ),
    calc("NOI", "Net operating income", "amount", "EGI - OPEX"),
    calc("EXPENSE_RATIO", "Operating expense ratio", "percent", "OPEX / EGI"),

    header("SEC_VALUE", "Value and leverage"),
    calc(
      "ECONOMIC_VALUE",
      "Economic value",
      "amount",
      "NOI / CAP_RATE",
      null,
      "Net operating income capitalized at the cap rate.",
    ),
    calc("UNITS", "Units", "count", "RE_UNITS", "PREV(UNITS)"),
    calc(
      "VALUE_PER_UNIT",
      "Value per unit",
      "amount",
      "ECONOMIC_VALUE / UNITS",
    ),
    calc(
      "EXISTING_PRINCIPAL",
      "Principal on the existing mortgage",
      "amount",
      "RE_MORTGAGE_PAYMENTS - RE_INTEREST",
      "PREV(EXISTING_PRINCIPAL)",
    ),
    calc(
      "EXISTING_MORTGAGE",
      "Existing mortgage",
      "amount",
      "RE_MORTGAGE + RE_MORTGAGE_CURRENT",
      "MAX(0, PREV(EXISTING_MORTGAGE) - EXISTING_PRINCIPAL)",
    ),
    calc(
      "MORTGAGES",
      "Mortgages",
      "amount",
      "EXISTING_MORTGAGE + PROFORMA_DEBT",
      null,
      "The existing mortgage plus new loans outstanding.",
    ),
    calc("LTV", "Loan to value", "percent", "MORTGAGES / ECONOMIC_VALUE"),
    calc("DEBT_YIELD", "Debt yield", "percent", "NOI / MORTGAGES"),

    header("SEC_DEBT_SERVICE", "Debt service"),
    calc(
      "EXISTING_DEBT_SERVICE",
      "Existing mortgage payments",
      "amount",
      "RE_MORTGAGE_PAYMENTS",
      "PREV(EXISTING_DEBT_SERVICE)",
    ),
    calc(
      "DEBT_SERVICE",
      "Debt service",
      "amount",
      "EXISTING_DEBT_SERVICE + PROFORMA_INTEREST + PROFORMA_PRINCIPAL",
      null,
      "Existing payments plus the scenario's post-project financing.",
    ),
    calc("DSCR", "Debt service coverage", "ratio", "NOI / DEBT_SERVICE"),

    header("SEC_COVENANTS", "Covenants"),
    assumption(
      "MIN_DSCR",
      "Minimum debt service coverage",
      "ratio",
      "1.2",
      "Covenant threshold.",
    ),
    assumption(
      "MAX_LTV",
      "Maximum loan to value",
      "percent",
      "0.75",
      "Covenant threshold.",
    ),
    calc(
      "DSCR_TEST",
      "Debt service coverage covenant",
      "flag",
      "DSCR >= MIN_DSCR",
    ),
    calc("LTV_TEST", "Loan to value covenant", "flag", "LTV <= MAX_LTV"),
  ]),
  charts: [
    {
      id: "noi",
      title: "Income and net operating income",
      series: [
        { code: "EGI", mark: "bar" },
        { code: "NOI", mark: "bar" },
      ],
      threshold: null,
    },
    {
      id: "dscr",
      title: "Debt service coverage",
      series: [{ code: "DSCR", mark: "line" }],
      threshold: "MIN_DSCR",
    },
    {
      id: "ltv",
      title: "Loan to value",
      series: [{ code: "LTV", mark: "line" }],
      threshold: "MAX_LTV",
    },
  ] satisfies ChartDefinition[],
};

export const REAL_ESTATE_SCENARIOS: ScenarioInput[] = [
  { name: "Cap rate 7%", overrides: { CAP_RATE: "0.07" } },
  {
    name: "Post-project: renovation",
    overrides: { RENT_GROWTH: "0.055" },
    adjustments: [
      {
        kind: "loan",
        name: "Renovation loan",
        amount: "1800000",
        rate: "0.054",
        years: 25,
        repayment: "blended",
        fromYear: 2025,
      },
    ],
  },
];
