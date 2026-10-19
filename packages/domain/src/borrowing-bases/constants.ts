import type { schema } from "@finance/db";

// What a borrowing base's lines are, and the codes the app computes from
// them, apart from reading definitions, so the browser can name them too:
// it needs nothing Node.js has and the browser doesn't. Exported as
// "@finance/domain/borrowing-bases".

export type BorrowingBaseDefinition = schema.BorrowingBaseDefinition;
export type BorrowingBaseLine = schema.BorrowingBaseLine;
export type BorrowingBaseLineKind = BorrowingBaseLine["kind"];
export type BorrowingBaseFormat = schema.BorrowingBaseFormat;
export type BorrowingBaseTest = schema.BorrowingBaseTest;
export type CollateralType = schema.CollateralType;
export type LineOf<K extends BorrowingBaseLineKind> = Extract<
  BorrowingBaseLine,
  { kind: K }
>;

export const LINE_KINDS: Record<
  BorrowingBaseLineKind,
  { label: string; help: string }
> = {
  collateral: {
    label: "Collateral",
    help: "Receivables or inventory the line lends against: its amount, less ineligibles, times the advance rate, up to an optional cap. Entered, the sum of its aging buckets, or a formula; in another currency, converted at the month's rate.",
  },
  group: {
    label: "Group",
    help: "Collateral lines added up, such as all inventory, with an optional cap of their own.",
  },
  ineligible: {
    label: "Ineligible",
    help: "Part of a collateral line the lender doesn't lend against: past due, contras, related parties, obsolete stock. Entered, or a formula such as 5% of the line.",
  },
  prior_claim: {
    label: "Prior claim",
    help: "An amount that can rank ahead of the lender: source deductions, sales taxes, wages and vacation pay, rent arrears. Comes off the borrowing base.",
  },
  reserve: {
    label: "Reserve",
    help: "An amount the lender holds back: a set amount (which can step), entered each month, or a formula.",
  },
  usage: {
    label: "Usage",
    help: "Drawn under the line besides its outstanding balance, such as letters of credit.",
  },
  driver: {
    label: "Driver",
    help: "A monthly figure outside the waterfall, such as sales or purchases, for ratios and projections.",
  },
  assumption: {
    label: "Assumption",
    help: "A value formulas read, such as sales growth; one for every month, or one per calendar month for a seasonal profile.",
  },
  calculation: {
    label: "Calculation",
    help: "A formula over the other lines, such as days sales outstanding or a custom test.",
  },
};

export const COLLATERAL_TYPES: Record<CollateralType, string> = {
  receivables: "Receivables",
  inventory: "Inventory",
  other: "Other collateral",
};

export const DEFAULT_BUCKETS = [
  "Current",
  "31–60 days",
  "61–90 days",
  "91–120 days",
  "Over 120 days",
];
// Over 90 days is ineligible, by default.
export const DEFAULT_INELIGIBLE_FROM = 3;

// The totals every borrowing base computes, in waterfall order.
export const TOTALS = [
  {
    code: "BB_COLLATERAL",
    label: "Collateral before ineligibles",
    format: "amount",
    help: "Every collateral line added up, in the line's currency, before ineligibles, advance rates and caps.",
  },
  {
    code: "BB_GROSS",
    label: "Gross borrowing base",
    format: "amount",
    help: "Margined collateral, after caps.",
  },
  {
    code: "BB_PRIOR_CLAIMS",
    label: "Prior claims",
    format: "amount",
    help: "Prior claims added up.",
  },
  {
    code: "BB_RESERVES",
    label: "Reserves",
    format: "amount",
    help: "Reserves added up.",
  },
  {
    code: "BB_TOTAL",
    label: "Borrowing base",
    format: "amount",
    help: "The gross borrowing base less prior claims and reserves, never below zero.",
  },
  {
    code: "BB_LIMIT",
    label: "Authorized limit",
    format: "amount",
    help: "The line's limit that month, from its terms.",
  },
  {
    code: "BB_AVAILABLE",
    label: "Availability",
    format: "amount",
    help: "The lesser of the borrowing base and the limit.",
  },
  {
    code: "BB_OUTSTANDING",
    label: "Line outstanding",
    format: "amount",
    help: "The line's balance at the month's end, entered.",
  },
  {
    code: "BB_USAGE",
    label: "Usage",
    format: "amount",
    help: "The balance outstanding plus the other usage lines, such as letters of credit.",
  },
  {
    code: "BB_SURPLUS",
    label: "Margin surplus (deficit)",
    format: "amount",
    help: "The borrowing base less usage; negative when short.",
  },
  {
    code: "BB_EXCESS",
    label: "Excess availability",
    format: "amount",
    help: "Availability less usage: what can still be drawn.",
  },
  {
    code: "BB_UTILIZATION",
    label: "Utilization",
    format: "percent",
    help: "Usage over the limit.",
  },
  {
    code: "BB_COVERAGE",
    label: "Coverage",
    format: "ratio",
    help: "The borrowing base over usage.",
  },
] as const;

export type TotalCode = (typeof TOTALS)[number]["code"];

// What each collateral line `X` computes.
export const COLLATERAL_CODES = [
  { suffix: "INELIGIBLE", label: "Ineligible", format: "amount" },
  { suffix: "ELIGIBLE", label: "Eligible", format: "amount" },
  { suffix: "RATE", label: "Advance rate", format: "percent" },
  { suffix: "CAP", label: "Cap", format: "amount" },
  { suffix: "MARGINED", label: "Margined", format: "amount" },
] as const;

// A user's code: a letter, then letters, digits and underscores. Dots and
// the BB_ and FX prefixes are the app's.
export const LINE_CODE = /^[A-Z][A-Z0-9_]{0,39}$/;

export const fxCode = (currency: string) => `FX.${currency}`;
