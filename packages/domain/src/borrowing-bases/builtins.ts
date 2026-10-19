import type { ChartDefinition } from "../financial-models/charts";
import type {
  BorrowingBaseDefinition,
  BorrowingBaseDefinitionInput,
} from "./definition";

// The built-in borrowing bases a line starts from (borrowing-base-plan.md
// §5.6), with Canadian defaults as lines. Nothing about them is fixed: a
// client's own copy adds, removes and changes lines to its credit agreement.

export interface BuiltInBorrowingBase {
  id: string;
  name: string;
  description: string;
  definition: BorrowingBaseDefinitionInput;
}

const PRIOR_CLAIMS = [
  {
    kind: "prior_claim",
    code: "SOURCE_DEDUCTIONS",
    label: "Source deductions",
    description:
      "Income tax, Canada or Québec Pension Plan and Employment Insurance withheld and not remitted.",
  },
  {
    kind: "prior_claim",
    code: "SALES_TAXES",
    label: "GST/HST and QST not remitted",
  },
  {
    kind: "prior_claim",
    code: "WAGES",
    label: "Unpaid wages and vacation pay",
    description:
      "The Bankruptcy and Insolvency Act priority behind the Wage Earner Protection Program Act (WEPPA).",
  },
];

const LETTERS_OF_CREDIT = {
  kind: "usage",
  code: "LCS",
  label: "Letters of credit",
};

// The charts a borrowing base shows when its definition names none: the
// borrowing base and usage against the limit, which steps with its
// seasons, and the margin surplus.
export const DEFAULT_BB_CHARTS: ChartDefinition[] = [
  {
    id: "base-usage",
    title: "Borrowing base and usage",
    series: [
      { code: "BB_TOTAL", mark: "bar" },
      { code: "BB_USAGE", mark: "bar" },
    ],
    threshold: "BB_LIMIT",
  },
  {
    id: "surplus",
    title: "Margin surplus (deficit)",
    series: [{ code: "BB_SURPLUS", mark: "line" }],
    threshold: null,
  },
];

// The definition's charts; the defaults when it names none, and none when
// it says so with an empty list.
export const chartsOf = (definition: BorrowingBaseDefinition) =>
  definition.charts ?? DEFAULT_BB_CHARTS;

export const BUILT_IN_BORROWING_BASES: BuiltInBorrowingBase[] = [
  {
    id: "receivables-inventory",
    name: "Receivables and inventory",
    description:
      "Trade receivables aged, over 90 days ineligible, at 75%; inventory by type, finished goods at 60%, raw materials at 50%, work in process at 0%.",
    definition: {
      outstandingReconcilesWith: "BANK_INDEBTEDNESS",
      lines: [
        {
          kind: "group",
          code: "RECEIVABLES",
          label: "Receivables",
          collateral: "receivables",
        },
        {
          kind: "collateral",
          code: "AR",
          label: "Trade receivables",
          collateral: "receivables",
          group: "RECEIVABLES",
          aging: true,
          rate: "75%",
          reconcilesWith: "AR_TRADE",
          projection: "IFERROR(PREV(AR, 12), PREV(AR)) * (1 + GROWTH)",
        },
        {
          kind: "ineligible",
          code: "AR_CONTRAS",
          label: "Contras",
          of: "AR",
          description: "Customers who are also suppliers.",
        },
        {
          kind: "ineligible",
          code: "AR_RELATED",
          label: "Related parties and intercompany",
          of: "AR",
        },
        {
          kind: "ineligible",
          code: "AR_FOREIGN",
          label: "Foreign receivables not insured",
          of: "AR",
        },
        {
          kind: "ineligible",
          code: "AR_GOVERNMENT",
          label: "Government (Crown) receivables",
          of: "AR",
        },
        {
          kind: "ineligible",
          code: "AR_CROSS_AGED",
          label: "Cross-aged accounts",
          of: "AR",
          description:
            "Customers mostly past the cutoff, ineligible in full; the part over 90 days is already out.",
        },
        {
          kind: "ineligible",
          code: "AR_DISPUTED",
          label: "Disputed or doubtful accounts",
          of: "AR",
        },
        {
          kind: "group",
          code: "INVENTORY",
          label: "Inventory",
          collateral: "inventory",
        },
        {
          kind: "collateral",
          code: "RAW",
          label: "Raw materials",
          collateral: "inventory",
          group: "INVENTORY",
          rate: "50%",
          reconcilesWith: "INVENTORY",
          projection: "IFERROR(PREV(RAW, 12), PREV(RAW)) * (1 + GROWTH)",
        },
        {
          kind: "ineligible",
          code: "RAW_IN_TRANSIT",
          label: "Goods in transit",
          of: "RAW",
        },
        {
          kind: "ineligible",
          code: "RAW_UNPAID_SUPPLIERS",
          label: "Unpaid suppliers' 30-day goods",
          of: "RAW",
          description:
            "Goods delivered in the last 30 days and not paid for, which suppliers can repossess under the Bankruptcy and Insolvency Act.",
        },
        {
          kind: "collateral",
          code: "WIP",
          label: "Work in process",
          collateral: "inventory",
          group: "INVENTORY",
          rate: "0%",
          reconcilesWith: "INVENTORY",
          projection: "IFERROR(PREV(WIP, 12), PREV(WIP)) * (1 + GROWTH)",
        },
        {
          kind: "collateral",
          code: "FINISHED",
          label: "Finished goods",
          collateral: "inventory",
          group: "INVENTORY",
          rate: "60%",
          reconcilesWith: "INVENTORY",
          projection:
            "IFERROR(PREV(FINISHED, 12), PREV(FINISHED)) * (1 + GROWTH)",
        },
        {
          kind: "ineligible",
          code: "FINISHED_OBSOLETE",
          label: "Obsolete or slow-moving stock",
          of: "FINISHED",
        },
        {
          kind: "ineligible",
          code: "FINISHED_CONSIGNED",
          label: "Consigned goods",
          of: "FINISHED",
        },
        ...PRIOR_CLAIMS,
        {
          kind: "prior_claim",
          code: "RENT_ARREARS",
          label: "Rent arrears",
        },
        {
          kind: "assumption",
          code: "GROWTH",
          label: "Growth over a year earlier",
          format: "percent",
          value: "0%",
          description:
            "Projected collateral and sales: the same month a year earlier, grown by this much.",
        },
        LETTERS_OF_CREDIT,
        {
          kind: "driver",
          code: "SALES",
          label: "Sales for the month",
          format: "amount",
          projection: "IFERROR(PREV(SALES, 12), PREV(SALES)) * (1 + GROWTH)",
        },
        {
          kind: "calculation",
          code: "AR_AGED_SHARE",
          label: "Receivables over 90 days",
          format: "percent",
          formula: "IFERROR(AR.AGED_OUT / AR, 0)",
          description: "The share of receivables past the cutoff.",
        },
        {
          kind: "calculation",
          code: "DSO",
          label: "Days sales outstanding",
          format: "count",
          formula: "IFERROR(AR / SALES * 30, 0)",
        },
      ],
      charts: [
        ...DEFAULT_BB_CHARTS,
        {
          id: "aged",
          title: "Receivables over 90 days",
          series: [{ code: "AR_AGED_SHARE", mark: "line" }],
          threshold: null,
        },
      ],
    },
  },
  {
    id: "receivables-currencies",
    name: "Receivables, CAD and USD, insured",
    description:
      "Receivables in Canadian and US dollars aged, over 90 days ineligible, at 75%; insured receivables at 90%. US dollars converted at each month's rate.",
    definition: {
      outstandingReconcilesWith: "BANK_INDEBTEDNESS",
      lines: [
        {
          kind: "group",
          code: "RECEIVABLES",
          label: "Receivables",
          collateral: "receivables",
        },
        {
          kind: "collateral",
          code: "AR_CAD",
          label: "Receivables, CAD",
          collateral: "receivables",
          group: "RECEIVABLES",
          aging: true,
          rate: "75%",
          reconcilesWith: "AR_TRADE",
          projection: "IFERROR(PREV(AR_CAD, 12), PREV(AR_CAD)) * (1 + GROWTH)",
        },
        {
          kind: "ineligible",
          code: "AR_CAD_CONTRAS",
          label: "Contras",
          of: "AR_CAD",
        },
        {
          kind: "collateral",
          code: "AR_USD",
          label: "Receivables, USD",
          collateral: "receivables",
          group: "RECEIVABLES",
          currency: "USD",
          aging: true,
          rate: "75%",
          reconcilesWith: "AR_TRADE",
          projection: "IFERROR(PREV(AR_USD, 12), PREV(AR_USD)) * (1 + GROWTH)",
        },
        {
          kind: "ineligible",
          code: "AR_USD_CONTRAS",
          label: "Contras",
          of: "AR_USD",
        },
        {
          kind: "collateral",
          code: "AR_INSURED",
          label: "Insured receivables",
          collateral: "receivables",
          group: "RECEIVABLES",
          rate: "90%",
          reconcilesWith: "AR_TRADE",
          description:
            "Covered by credit insurance, such as Export Development Canada's, assigned to the lender.",
          projection:
            "IFERROR(PREV(AR_INSURED, 12), PREV(AR_INSURED)) * (1 + GROWTH)",
        },
        {
          kind: "ineligible",
          code: "AR_INSURED_EXCESS",
          label: "Over the insured limits",
          of: "AR_INSURED",
        },
        ...PRIOR_CLAIMS,
        {
          kind: "assumption",
          code: "GROWTH",
          label: "Growth over a year earlier",
          format: "percent",
          value: "0%",
          description:
            "Projected collateral and sales: the same month a year earlier, grown by this much.",
        },
        LETTERS_OF_CREDIT,
        {
          kind: "driver",
          code: "SALES",
          label: "Sales for the month",
          format: "amount",
        },
      ],
    },
  },
  {
    id: "construction",
    name: "Construction",
    description:
      "Progress billings aged, over 90 days ineligible, at 75%, less holdbacks and bonded jobs; service billings at 75%; unpaid subcontractors as a prior claim.",
    definition: {
      outstandingReconcilesWith: "BANK_INDEBTEDNESS",
      lines: [
        {
          kind: "group",
          code: "RECEIVABLES",
          label: "Receivables",
          collateral: "receivables",
        },
        {
          kind: "collateral",
          code: "PROGRESS",
          label: "Progress billings",
          collateral: "receivables",
          group: "RECEIVABLES",
          aging: {
            buckets: ["Current", "31–60 days", "61–90 days", "Over 90 days"],
            ineligibleFrom: 3,
          },
          rate: "75%",
          reconcilesWith: "AR_TRADE",
        },
        {
          kind: "ineligible",
          code: "HOLDBACKS",
          label: "Holdbacks",
          of: "PROGRESS",
          formula: "PROGRESS * HOLDBACK_RATE",
          description:
            "Retained by owners until the work is accepted; taken as a share of progress billings.",
        },
        {
          kind: "ineligible",
          code: "BONDED",
          label: "Bonded jobs",
          of: "PROGRESS",
        },
        {
          kind: "collateral",
          code: "SERVICE",
          label: "Service billings",
          collateral: "receivables",
          group: "RECEIVABLES",
          rate: "75%",
          reconcilesWith: "AR_TRADE",
        },
        ...PRIOR_CLAIMS,
        {
          kind: "prior_claim",
          code: "SUBTRADES",
          label: "Unpaid subcontractors",
          description: "Amounts subcontractors can claim under liens.",
        },
        LETTERS_OF_CREDIT,
        {
          kind: "assumption",
          code: "HOLDBACK_RATE",
          label: "Holdback rate",
          format: "percent",
          value: "10%",
        },
      ],
    },
  },
];
