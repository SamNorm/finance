// Tables, in build order (brainstorm-recap.md §5, §12). Columns are camelCase
// here and snake_case in Postgres (casing is set on the client and drizzle-kit).
//
// RLS is enabled with no policies on every table: the app connects as the table
// owner and bypasses it, while Supabase's public API roles (anon, authenticated)
// get nothing. Authorization lives in the domain layer, not in policies (§9.3).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// How an organization's documents look: its colour, its logo (a small image
// as a data URL, kept in the row) and the notice printed on every page.
export interface Branding {
  color?: string;
  logo?: string;
  notice?: string;
}

export const organizations = pgTable("organizations", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  branding: jsonb().$type<Branding>().notNull().default({}),
  // Built-in documents it no longer offers to print, by key: it has its own
  // instead.
  hiddenBuiltIns: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  createdAt: createdAt(),
}).enableRLS();

// Raw bytes, such as a generated PDF.
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

// ---------------------------------------------------------------------------
// Scoring models (§5.2): one or more per organization (say, commercial and real
// estate), each borrower using one; versioned, inputs only.
// `mirrored` copies an institution's system; `native` is the shared input sheet
// of an organization that has none (§5.7, option B). Same structure either way.

export const scoringModelSource = pgEnum("scoring_model_source", [
  "mirrored",
  "native",
]);

// Shared by every versioned thing (scoring models now, financial models later).
export const versionStatus = pgEnum("version_status", [
  "draft",
  "published",
  "retired",
]);

export const statementType = pgEnum("statement_type", [
  "balance_sheet",
  "income_statement",
  "cash_flow",
  "other",
]);

// input: entered by the analyst. subtotal: the sum of its children, stored for
// validation. header: a layout row with no value that groups its children.
export const itemKind = pgEnum("item_kind", ["input", "subtotal", "header"]);

export const itemDataType = pgEnum("item_data_type", [
  "amount",
  "percent",
  "ratio",
  "count",
  "date",
  "text",
]);

// How an item rolls into its parent subtotal. Covers both conventions: expenses
// entered positive (subtract) or entered negative (add).
export const itemAggregation = pgEnum("item_aggregation", [
  "add",
  "subtract",
  "ignore",
]);

// The sign an entered value must have, checked when statements are validated.
export const itemSign = pgEnum("item_sign", ["any", "positive", "negative"]);

// Where a project's new loans post on the balance sheet, and where their
// repayments come out of, as item codes of the model.
export interface FinancingItems {
  longTermDebt: string | null;
  currentDebt: string | null;
  cash: string | null;
}

// The items the spread's statement checks read, as item codes of the model:
// net income, compared with the figure printed on the statements, and
// retained earnings, rolled forward from one period to the next; and the
// authorized line of credit, compared with the borrower's lines' limits.
// Absent in models saved before it.
export interface CheckItems {
  netIncome: string | null;
  retainedEarnings: string | null;
  lineAuthorized?: string | null;
}

export const scoringModels = pgTable(
  "scoring_models",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    source: scoringModelSource().notNull(),
    // Free text naming the mirrored system, e.g. "CreditLens" or "In-house".
    sourceSystem: text(),
    description: text(),
    financingItems: jsonb()
      .$type<FinancingItems>()
      .notNull()
      .default({ longTermDebt: null, currentDebt: null, cash: null }),
    checkItems: jsonb()
      .$type<CheckItems>()
      .notNull()
      .default({ netIncome: null, retainedEarnings: null }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("scoring_models_organization").on(t.organizationId)],
).enableRLS();

export const scoringModelVersions = pgTable(
  "scoring_model_versions",
  {
    id: uuid().primaryKey().defaultRandom(),
    scoringModelId: uuid()
      .notNull()
      .references(() => scoringModels.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    status: versionStatus().notNull().default("draft"),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    publishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("scoring_model_versions_number").on(t.scoringModelId, t.number),
    uniqueIndex("scoring_model_versions_one_draft")
      .on(t.scoringModelId)
      .where(sql`${t.status} = 'draft'`),
    check(
      "scoring_model_versions_published_at",
      sql`(${t.status} = 'draft') = (${t.publishedAt} is null)`,
    ),
  ],
).enableRLS();

// Items are identified by their code within a version: the same code the
// source system uses, which statements and formulas reference (§5.3, §5.5).
export const scoringModelItems = pgTable(
  "scoring_model_items",
  {
    versionId: uuid()
      .notNull()
      .references(() => scoringModelVersions.id, { onDelete: "cascade" }),
    code: text().notNull(),
    label: text().notNull(),
    statement: statementType().notNull(),
    parentCode: text(),
    // Layout order across the whole version, as rows appear in the source system.
    position: integer().notNull(),
    kind: itemKind().notNull().default("input"),
    dataType: itemDataType().notNull().default("amount"),
    aggregation: itemAggregation().notNull().default("add"),
    expectedSign: itemSign().notNull().default("any"),
    description: text(),
    // Extra columns from an import, kept verbatim (e.g. a source line number).
    attributes: jsonb().$type<Record<string, string>>().notNull().default({}),
  },
  (t) => [
    primaryKey({ columns: [t.versionId, t.code] }),
    foreignKey({
      name: "scoring_model_items_parent",
      columns: [t.versionId, t.parentCode],
      foreignColumns: [t.versionId, t.code],
    }),
    index("scoring_model_items_position").on(t.versionId, t.position),
    index("scoring_model_items_parent_code").on(t.versionId, t.parentCode),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// Borrowers and spreads (§5.5): figures per entity and period, keyed by input
// item code and stored once, so every financial model reads the same data.

// How often a loan is paid; monthly when absent.
export type PaymentFrequency =
  | "weekly"
  | "biweekly"
  | "semimonthly"
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual";

// Payments suspended at the start of a loan's schedule. "principal": interest
// is still paid. "full": nothing is paid and interest is capitalized.
export interface Moratorium {
  kind: "principal" | "full";
  // How many of the loan's payments it suspends: 10 on a loan paid every two
  // weeks is 20 weeks.
  payments: number;
  // Within the amortization (a 20-year loan with a year's moratorium repays
  // its principal over the 19 that follow) or before it (over 20 more).
  included: boolean;
}

// A change to a loan's schedule, applied on top of its terms to the first
// payment on or after its date. Amounts are canonical decimal strings.
// - "extra": a lump sum of principal. Then the loan keeps its payment and
//   finishes sooner, or keeps its end and lowers the payment.
// - "payment": the regular payment becomes `amount` from the date until
//   `until` (to the end when null): principal and interest on blended loans,
//   principal on the others.
// - "skip": `payments` payments are skipped, on principal or on principal and
//   interest (capitalized). Then the loan keeps its payment and ends later, or
//   keeps its end and raises the payment.
export type ScheduleAdjustment = { id: string; date: string } & (
  | { kind: "extra"; amount: string; keep: "payment" | "end" }
  | { kind: "payment"; amount: string; until: string | null }
  | {
      kind: "skip";
      payments: number;
      suspends: Moratorium["kind"];
      keep: "payment" | "end";
    }
);

// The borrower's existing loans as of a date, so analyses can use their
// actual future debt service. Amounts and rates are canonical decimal strings.
export interface DebtSchedule {
  asOf: string | null;
  loans: {
    id: string;
    name: string;
    balance: string;
    // Annual rate, e.g. "0.065".
    rate: string;
    repayment: "blended" | "equal_principal" | "interest_only";
    // Months of amortization left; 0 for interest-only loans.
    months: number;
    frequency?: PaymentFrequency;
    // What's left of a moratorium at the schedule's date.
    moratorium?: Moratorium;
    // After the schedule's date.
    adjustments?: ScheduleAdjustment[];
  }[];
}

// A covenant of a credit agreement: a financial model line, by its code,
// tested against a threshold that can step by fiscal year. Covenants are
// terms of a deal, not of a model: they're kept on the borrower (in force)
// and on a scenario (proposed for its deal), and tested in any analysis
// whose model has the line. Thresholds are canonical decimals.
export interface Covenant {
  id: string;
  name: string;
  metric: string;
  // At least ("min", e.g. coverage) or at most ("max", e.g. leverage).
  test: "min" | "max";
  // By fiscal year: the first from the start (null), then each from the
  // year it names, in order.
  thresholds: { from: number | null; value: string }[];
  // The agreement's wording, for reference.
  note?: string;
}

// borrower: spread from its own statements. consolidated: a client whose
// spread adds up other borrowers' statements, less eliminations.
export const entityKind = pgEnum("entity_kind", ["borrower", "consolidated"]);

// A borrower or acquisition target, or a consolidated client of several.
export const entities = pgTable(
  "entities",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: entityKind().notNull().default("borrower"),
    name: text().notNull(),
    // The scoring model the borrower's spreads follow.
    scoringModelId: uuid()
      .notNull()
      .references(() => scoringModels.id),
    industry: text(),
    // North American Industry Classification System, 2 to 6 digits.
    naicsCode: text(),
    // The official rating from the institution's system, kept for reference;
    // the app never computes it (§3).
    riskRating: text(),
    notes: text(),
    debtSchedule: jsonb()
      .$type<DebtSchedule>()
      .notNull()
      .default({ asOf: null, loans: [] }),
    // The covenants of its credit agreement in force, which every analysis
    // of it tests.
    covenants: jsonb().$type<Covenant[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("entities_organization").on(t.organizationId),
    index("entities_scoring_model").on(t.scoringModelId),
  ],
).enableRLS();

// A term of a line of credit (borrowing-base-plan.md §5.3): a value that can
// differ in some calendar months every year, for a season, and step from a
// month, for an amendment. A step replaces the value and its seasons from
// its month on. Values are canonical decimal strings; months are "YYYY-MM".
export interface Season {
  // Calendar months, 1 to 12.
  months: number[];
  value: string;
}

export interface Term {
  value: string;
  seasons?: Season[];
  // In order, each from a later month.
  steps?: { from: string; value: string; seasons?: Season[] }[];
}

// A margined line's borrowing base (borrowing-base-plan.md §5): typed lines
// the app compiles into the waterfall, with the client's terms. Amounts are
// in the line's currency unless a line says otherwise; its figures are then
// converted at the month's rate, entered as FX.<currency>. Codes are the
// user's; the app generates the rest (X.MARGINED, BB_TOTAL…).
export type CollateralType = "receivables" | "inventory" | "other";
export type BorrowingBaseFormat =
  "amount" | "percent" | "ratio" | "count" | "flag";

interface BorrowingBaseLineBase {
  code: string;
  label: string;
  description?: string;
}

export type BorrowingBaseLine = BorrowingBaseLineBase &
  (
    | {
        kind: "collateral";
        collateral: CollateralType;
        // The group it's part of, by code.
        group?: string;
        currency?: string;
        // The advance rate, and an optional cap in the facility's currency,
        // applied after conversion.
        rate: Term;
        cap?: Term;
        // Aged: its amount is the buckets added up, and those from
        // `ineligibleFrom` (0-based) on are ineligible.
        aging?: { buckets: string[]; ineligibleFrom: number };
        // The spread item it's part of, e.g. AR_TRADE.
        reconcilesWith?: string;
        // Its amount, instead of entering it.
        formula?: string;
        // How it's projected (§8.4).
        projection?: string;
      }
    | { kind: "group"; collateral: CollateralType; cap?: Term }
    | {
        kind: "ineligible";
        // The collateral line it reduces, by code.
        of: string;
        formula?: string;
        projection?: string;
      }
    | {
        kind: "prior_claim";
        currency?: string;
        formula?: string;
        projection?: string;
      }
    | {
        kind: "reserve";
        // A set amount, as a term; or entered, or a formula.
        amount?: Term;
        formula?: string;
        projection?: string;
      }
    | {
        kind: "usage";
        currency?: string;
        reconcilesWith?: string;
        projection?: string;
      }
    | {
        kind: "driver";
        format: BorrowingBaseFormat;
        projection?: string;
      }
    | {
        kind: "assumption";
        format: BorrowingBaseFormat;
        value: string | null;
        // One per calendar month, January first, for a seasonal profile.
        byMonth?: (string | null)[];
      }
    | {
        kind: "calculation";
        format: BorrowingBaseFormat;
        formula: string;
        projection?: string;
      }
  );

// A test each month: a line at least or at most a threshold, which can step
// and be seasonal as a term (§6.3).
export interface BorrowingBaseTest {
  id: string;
  name: string;
  metric: string;
  test: "min" | "max";
  threshold: Term;
}

export interface BorrowingBaseDefinition {
  // What it was copied from, for reference.
  basedOn?: { kind: "builtin" | "template" | "line"; id: string; name: string };
  lines: BorrowingBaseLine[];
  // The spread item the line's outstanding balance is part of, e.g.
  // BANK_INDEBTEDNESS.
  outstandingReconcilesWith?: string;
  // How the line's balance is projected; by default, the same month a year
  // earlier plus the growth in collateral since, which the line funds.
  outstandingProjection?: string;
  tests?: BorrowingBaseTest[];
  charts?: ChartDefinition[];
}

// A borrower's lines of credit (borrowing-base-plan.md §4): what's real, with
// their terms in force. A consolidated client's are its members'. The balance
// isn't kept: the spread holds it at each period end.
export const creditLines = pgTable(
  "credit_lines",
  {
    id: uuid().primaryKey().defaultRandom(),
    entityId: uuid()
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    name: text().notNull(),
    // ISO 4217, e.g. "CAD".
    currency: text().notNull().default("CAD"),
    // The authorized limit, an amount, which can step and be seasonal.
    limit: jsonb().$type<Term>().notNull(),
    // Annual rate, e.g. "0.072".
    rate: text().notNull(),
    position: integer().notNull().default(0),
    // The day it was closed; analyses no longer count it after.
    closedOn: date({ mode: "string" }),
    // When it's margined, its borrowing base.
    borrowingBase: jsonb().$type<BorrowingBaseDefinition>(),
    // Days after a month end the client's certificate is due.
    certificateDueDays: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("credit_lines_entity").on(t.entityId, t.position)],
).enableRLS();

export const borrowingBaseQuality = pgEnum("borrowing_base_quality", [
  "reported",
  "verified",
]);

// An organization's own borrowing base structures (borrowing-base-plan.md
// §5.1, §5.7), which a line's borrowing base starts from: a draft, and the
// definition published for analysts to copy, as document templates have.
// No version history: each line's copy is its own once made.
export const borrowingBaseTemplates = pgTable(
  "borrowing_base_templates",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    // The built-in's id, or the template's, it was copied from.
    basedOn: text(),
    draft: jsonb().$type<BorrowingBaseDefinition>().notNull(),
    published: jsonb().$type<BorrowingBaseDefinition>(),
    publishedAt: timestamp({ withTimezone: true }),
    // No longer offered to start from; lines copied from it keep theirs.
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("borrowing_base_templates_organization").on(t.organizationId),
    check(
      "borrowing_base_templates_published_at",
      sql`(${t.published} is null) = (${t.publishedAt} is null)`,
    ),
  ],
).enableRLS();

// What a consolidated client's borrowing base adds up each month across its
// members' margined lines (borrowing-base-plan.md §7.5): sums of totals, not
// of line codes, since members' lines differ.
export type GroupTotal =
  | "receivables"
  | "inventory"
  | "otherCollateral"
  | "priorClaims"
  | "reserves"
  | "limit"
  | "outstanding"
  | "otherUsage";

// A consolidated client's month: named adjustments added to its members'
// totals, as eliminations adjust its spread, and, when the client sends a
// certificate for the group, the totals it gives, which replace the sum.
export const groupBorrowingBaseMonths = pgTable(
  "group_borrowing_base_months",
  {
    entityId: uuid()
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    // "YYYY-MM".
    month: text().notNull(),
    adjustments: jsonb()
      .$type<
        { id: string; name: string; total: GroupTotal; amount: string }[]
      >()
      .notNull()
      .default([]),
    override: jsonb().$type<Partial<Record<GroupTotal, string>>>(),
    note: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.month] })],
).enableRLS();

// A margined line's monthly history: each month's certificate, reported by
// the client or verified by a field exam or an audit (§7).
export const borrowingBaseMonths = pgTable(
  "borrowing_base_months",
  {
    id: uuid().primaryKey().defaultRandom(),
    lineId: uuid()
      .notNull()
      .references(() => creditLines.id, { onDelete: "cascade" }),
    // "YYYY-MM".
    month: text().notNull(),
    quality: borrowingBaseQuality().notNull().default("reported"),
    receivedOn: date({ mode: "string" }),
    note: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("borrowing_base_months_line_month").on(t.lineId, t.month),
    check(
      "borrowing_base_months_month",
      sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
  ],
).enableRLS();

// A month's figures, by line code.
export const borrowingBaseValues = pgTable(
  "borrowing_base_values",
  {
    monthId: uuid()
      .notNull()
      .references(() => borrowingBaseMonths.id, { onDelete: "cascade" }),
    code: text().notNull(),
    amount: numeric().notNull(),
  },
  (t) => [primaryKey({ columns: [t.monthId, t.code] })],
).enableRLS();

// The usage an analysis or a scenario assumes for each line of credit, by
// line id: its average share of the limit, and any month's amount drawn
// instead, by month ("YYYY-MM"). Interest on lines comes from it.
export type LineUsage = Record<
  string,
  { share?: string; months?: Record<string, string> }
>;

// Rates converting lines of credit in another currency into an analysis's,
// its statements': by currency code, the analysis's units for one of that
// currency, e.g. { USD: "1.37" }.
export type ExchangeRates = Record<string, string>;

// A line of credit as a scenario proposes it for its deal: one of the lines
// in force (by its id), changed or closed, or a new line. Lines in force it
// doesn't list stay as they are.
export interface ProposedLine {
  id: string;
  name: string;
  currency: string;
  limit: Term;
  rate: string;
  // Closed at the deal: from closing, or from the first projected month.
  closed?: boolean;
  // Its borrowing base's terms as the deal changes them, by line code:
  // advance rates and caps of collateral, groups' caps, reserves' amounts.
  terms?: Record<string, { rate?: Term; cap?: Term | null; amount?: Term }>;
  // A new margined line's borrowing base, projected from its definition and
  // assumptions alone.
  borrowingBase?: BorrowingBaseDefinition;
}

// How an analysis projects a margined line's borrowing base (§8): from the
// client's monthly projections, entered in the analysis, or from the
// definition's projection formulas; over how many months; and the base
// case's values for the definition's assumptions: one for every month, or
// one per calendar month.
export interface ProjectedBorrowingBase {
  source: "assumptions" | "client";
  months: number;
  assumptions?: Record<
    string,
    { value?: string | null; byMonth?: (string | null)[] }
  >;
}

// A scenario's changes to a projected borrowing base: assumptions, for
// every month or month by month ("YYYY-MM"), and figures of projected
// months, by month then code, such as an extra ineligible from a month.
export interface ScenarioBorrowingBase {
  assumptions?: Record<
    string,
    { value?: string | null; months?: Record<string, string> }
  >;
  figures?: Record<string, Record<string, string>>;
}

export const statementQuality = pgEnum("statement_quality", [
  "audited",
  "review",
  "compilation",
  "internal",
  "projected",
]);

// A line explaining how retained earnings changed from the period before,
// other than by net income: dividends declared, a prior-period adjustment,
// or the difference forced to make them roll forward. The amount is a
// canonical decimal, negative when it reduces retained earnings.
export interface ReconciliationLine {
  id: string;
  label: string;
  amount: string;
  // Set by forcing retained earnings to roll forward, rather than entered.
  forced?: boolean;
}

export const statementPeriods = pgTable(
  "statement_periods",
  {
    id: uuid().primaryKey().defaultRandom(),
    entityId: uuid()
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    periodEnd: date({ mode: "string" }).notNull(),
    months: integer().notNull().default(12),
    quality: statementQuality().notNull(),
    currency: text().notNull().default("CAD"),
    consolidated: boolean().notNull().default(false),
    // The scoring model version the figures were entered against.
    scoringModelVersionId: uuid()
      .notNull()
      .references(() => scoringModelVersions.id),
    // Net income as printed on the statements, which the spread's must match.
    reportedNetIncome: numeric(),
    reconciliation: jsonb().$type<ReconciliationLine[]>().notNull().default([]),
    // A consolidated client's period: what it eliminates from the sum of its
    // members' statements.
    eliminations: jsonb().$type<Elimination[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("statement_periods_unique").on(
      t.entityId,
      t.periodEnd,
      t.months,
    ),
    index("statement_periods_scoring_model_version").on(
      t.scoringModelVersionId,
    ),
    check("statement_periods_months", sql`${t.months} between 1 and 24`),
  ],
).enableRLS();

// An amount added to an input item of a consolidated client's period,
// negative to reduce it, such as intercompany rent taken out of revenue.
// Those on the balance sheet must balance among themselves. The amount is a
// canonical decimal.
export interface Elimination {
  id: string;
  name: string;
  item: string;
  amount: string;
}

// The borrowers a consolidated client adds up, in the order its worksheet
// shows them. Members follow its scoring model and stay borrowers in their
// own right; one can't be deleted while it's a member.
export const consolidationMembers = pgTable(
  "consolidation_members",
  {
    entityId: uuid()
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    memberId: uuid()
      .notNull()
      .references(() => entities.id),
    position: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.entityId, t.memberId] }),
    index("consolidation_members_member").on(t.memberId),
    check(
      "consolidation_members_not_itself",
      sql`${t.entityId} <> ${t.memberId}`,
    ),
  ],
).enableRLS();

// The statements a consolidated client's period adds up: at most one period
// per member, which may end on another date. A member's period can't be
// deleted while a consolidated period uses it.
export const consolidatedStatements = pgTable(
  "consolidated_statements",
  {
    periodId: uuid()
      .notNull()
      .references(() => statementPeriods.id, { onDelete: "cascade" }),
    memberId: uuid()
      .notNull()
      .references(() => entities.id),
    memberPeriodId: uuid()
      .notNull()
      .references(() => statementPeriods.id),
  },
  (t) => [
    primaryKey({ columns: [t.periodId, t.memberId] }),
    index("consolidated_statements_member").on(t.memberId),
    index("consolidated_statements_member_period").on(t.memberPeriodId),
  ],
).enableRLS();

// One figure: a number for numeric items, text for text and date items.
export const statementValues = pgTable(
  "statement_values",
  {
    periodId: uuid()
      .notNull()
      .references(() => statementPeriods.id, { onDelete: "cascade" }),
    code: text().notNull(),
    amount: numeric(),
    text: text(),
  },
  (t) => [
    primaryKey({ columns: [t.periodId, t.code] }),
    check(
      "statement_values_one_kind",
      sql`(${t.amount} is null) <> (${t.text} is null)`,
    ),
  ],
).enableRLS();

// Figures for financial model input lines, per period and keyed by the line's
// code. Like statement values, they belong to the borrower, so every model
// with an input of that code reads the same figure.
export const modelInputValues = pgTable(
  "model_input_values",
  {
    periodId: uuid()
      .notNull()
      .references(() => statementPeriods.id, { onDelete: "cascade" }),
    code: text().notNull(),
    amount: numeric(),
    text: text(),
  },
  (t) => [
    primaryKey({ columns: [t.periodId, t.code] }),
    check(
      "model_input_values_one_kind",
      sql`(${t.amount} is null) <> (${t.text} is null)`,
    ),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// Financial models (§5.3–5.4): many per organization, versioned. A version
// binds to a scoring model version and holds lines: assumptions, calculations
// written as formulas over item and line codes, and headers for layout.

export const financialModels = pgTable(
  "financial_models",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    // Set when the model was duplicated from another as a variant.
    variantOfId: uuid().references((): AnyPgColumn => financialModels.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("financial_models_organization").on(t.organizationId),
    index("financial_models_variant_of").on(t.variantOfId),
  ],
).enableRLS();

// A chart over a model's lines: one or more series sharing one format, so they
// share one axis, and optionally an assumption drawn as a threshold.
export interface ChartDefinition {
  id: string;
  title: string;
  series: { code: string; mark: "bar" | "line" }[];
  threshold: string | null;
}

export const financialModelVersions = pgTable(
  "financial_model_versions",
  {
    id: uuid().primaryKey().defaultRandom(),
    financialModelId: uuid()
      .notNull()
      .references(() => financialModels.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    status: versionStatus().notNull().default("draft"),
    // The scoring model version whose item codes the formulas use.
    scoringModelVersionId: uuid()
      .notNull()
      .references(() => scoringModelVersions.id),
    // Charts every analysis on this version shows.
    charts: jsonb().$type<ChartDefinition[]>().notNull().default([]),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    publishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("financial_model_versions_number").on(
      t.financialModelId,
      t.number,
    ),
    uniqueIndex("financial_model_versions_one_draft")
      .on(t.financialModelId)
      .where(sql`${t.status} = 'draft'`),
    index("financial_model_versions_scoring_model_version").on(
      t.scoringModelVersionId,
    ),
    check(
      "financial_model_versions_published_at",
      sql`(${t.status} = 'draft') = (${t.publishedAt} is null)`,
    ),
  ],
).enableRLS();

// input: a figure the scoring model doesn't capture, entered per borrower
// period for models that need it, such as inventory by type.
export const lineKind = pgEnum("financial_model_line_kind", [
  "assumption",
  "calculation",
  "header",
  "input",
]);

// How a line's values display; "flag" is a TRUE/FALSE test such as a covenant.
export const lineFormat = pgEnum("financial_model_line_format", [
  "amount",
  "percent",
  "ratio",
  "count",
  "flag",
  "text",
]);

export const financialModelLines = pgTable(
  "financial_model_lines",
  {
    versionId: uuid()
      .notNull()
      .references(() => financialModelVersions.id, { onDelete: "cascade" }),
    code: text().notNull(),
    label: text().notNull(),
    kind: lineKind().notNull(),
    position: integer().notNull(),
    format: lineFormat().notNull().default("amount"),
    // Calculations: the formula, and optionally another for projected periods.
    // Inputs: only the projection formula, for periods computed from
    // assumptions, where nothing is entered.
    formula: text(),
    projectionFormula: text(),
    // Assumptions: the base-case value, which scenarios override.
    defaultValue: text(),
    // Inputs: the scoring model item this input is part of, such as raw
    // materials of INVENTORY, so the parts can be reconciled with it.
    breaksDown: text(),
    description: text(),
  },
  (t) => [
    primaryKey({ columns: [t.versionId, t.code] }),
    index("financial_model_lines_position").on(t.versionId, t.position),
  ],
).enableRLS();

// ---------------------------------------------------------------------------
// Analyses (§5.5): a borrower run through a pinned financial model version,
// over chosen periods plus projected years, with scenarios that override
// assumptions. Pinning keeps a credit file reproducible after later versions.

// Where projected years come from. assumptions: computed by the model's
// projection formulas for a number of years after the last actual period.
// client: the borrower's own projections, spread as periods of quality
// "projected" and read like any other period.
export const projectionMode = pgEnum("projection_mode", [
  "assumptions",
  "client",
]);

// Where the analyst is with it: still working, or done, e.g. once it's in the
// credit file. Completed analyses can be reopened; nothing is locked.
export const analysisStatus = pgEnum("analysis_status", [
  "in_progress",
  "completed",
]);

export const analyses = pgTable(
  "analyses",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entityId: uuid()
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    // Always a published version, so it never changes under the analysis.
    financialModelVersionId: uuid()
      .notNull()
      .references(() => financialModelVersions.id),
    name: text().notNull(),
    // Statement periods included; empty means all of the borrower's periods.
    periodIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    projectionMode: projectionMode().notNull().default("assumptions"),
    // Years computed from assumptions; unused with the client's projections.
    projectionYears: integer().notNull().default(0),
    // Charts added in the analysis, on top of the model's.
    charts: jsonb().$type<ChartDefinition[]>().notNull().default([]),
    // Periods shown with a post-project column next to them, by run period
    // key; null means the default, the last fiscal year.
    postProjectKeys: text().array(),
    // The usage the base case assumes for each line of credit.
    lineUsage: jsonb().$type<LineUsage>().notNull().default({}),
    // What converts lines in other currencies, in the base case.
    exchangeRates: jsonb().$type<ExchangeRates>().notNull().default({}),
    // How it projects each margined line's borrowing base, by line id.
    borrowingBases: jsonb()
      .$type<Record<string, ProjectedBorrowingBase>>()
      .notNull()
      .default({}),
    status: analysisStatus().notNull().default("in_progress"),
    completedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("analyses_organization").on(t.organizationId),
    index("analyses_entity").on(t.entityId),
    check(
      "analyses_completed_at",
      sql`(${t.status} = 'completed') = (${t.completedAt} is not null)`,
    ),
    index("analyses_financial_model_version").on(t.financialModelVersionId),
    check(
      "analyses_projection_years",
      sql`${t.projectionYears} between 0 and 10`,
    ),
  ],
).enableRLS();

// The project a scenario finances, as a sources and uses table at closing:
// sources (new loans, equity, cash on hand) equal uses (assets bought, debt
// refinanced, costs). Each posts to a balance sheet item, so the post-project
// balance sheet balances. Subordinations sit outside the table: they move no
// funds at closing. A deal's lines of credit are the scenario's (`lines`).
// Amounts and rates are canonical decimal strings.
export interface Project {
  closing: string;
  sources: (
    | {
        kind: "loan";
        id: string;
        name: string;
        amount: string;
        // Annual rate, e.g. "0.065".
        rate: string;
        repayment: "blended" | "equal_principal" | "interest_only";
        // Months of amortization; 0 for interest only.
        months: number;
        frequency?: PaymentFrequency;
        // Starting at closing.
        moratorium?: Moratorium;
        // After closing.
        adjustments?: ScheduleAdjustment[];
      }
    | { kind: "funds"; id: string; name: string; amount: string; item: string }
  )[];
  uses: { id: string; name: string; amount: string; item: string }[];
  // Debt postponed in favour of the lender and treated as equity, with the
  // annual interest and principal it no longer costs.
  subordinations: {
    id: string;
    name: string;
    amount: string;
    interestSaved: string;
    principalSaved: string;
  }[];
  // Changes to items that move no funds at closing, such as a replaced
  // asset written off against retained earnings: each adds its amount,
  // negative to reduce, to an input item in post-project columns. Those on
  // the balance sheet (with a side) must balance among themselves; those on
  // other statements are yearly amounts. Absent in projects saved before.
  adjustments?: {
    id: string;
    name: string;
    item: string;
    amount: string;
    side: "assets" | "claims" | null;
  }[];
  // The borrower's existing loans the deal repays or refinances at closing,
  // by id: post-project, their debt service stops then. The borrower's debt
  // schedule keeps them, for its other analyses and scenarios.
  consolidatedLoans?: string[];
}

// A purchase of fixed assets a scenario plans in projected years, partly
// financed by a loan drawn when it's bought; the rest comes from cash.
// Amounts and rates are canonical decimal strings.
export interface CapexItem {
  id: string;
  name: string;
  // When it's bought and the loan is drawn.
  date: string;
  amount: string;
  // The share financed, e.g. "0.8".
  financed: string;
  // The loan, when a share is financed.
  loan?: {
    // Annual rate, e.g. "0.065".
    rate: string;
    repayment: "blended" | "equal_principal" | "interest_only";
    // Months of amortization; 0 for interest only.
    months: number;
    frequency?: PaymentFrequency;
    // Starting when it's drawn.
    moratorium?: Moratorium;
  };
}

export const analysisScenarios = pgTable(
  "analysis_scenarios",
  {
    id: uuid().primaryKey().defaultRandom(),
    analysisId: uuid()
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    name: text().notNull(),
    position: integer().notNull().default(0),
    // Assumption code → value, canonical as in financial model lines.
    overrides: jsonb().$type<Record<string, string>>().notNull().default({}),
    // Assumption code → period end → value, entered year by year: they apply
    // in projected periods and, post-project, from the last fiscal year on.
    periodOverrides: jsonb()
      .$type<Record<string, Record<string, string>>>()
      .notNull()
      .default({}),
    // The project the scenario finances; none for a stress alone.
    project: jsonb().$type<Project>(),
    // Purchases planned in projected years, and their financing.
    capex: jsonb().$type<CapexItem[]>().notNull().default([]),
    // The covenants proposed for its deal, tested instead of the borrower's
    // in force; null tests the borrower's.
    covenants: jsonb().$type<Covenant[]>(),
    // The lines of credit proposed for its deal; null keeps those in force.
    // With a project they apply from closing; without, from the first
    // projected month.
    lines: jsonb().$type<ProposedLine[]>(),
    // Usage assumed for lines of credit, over the analysis's: a share or
    // months given here replace its own.
    lineUsage: jsonb().$type<LineUsage>().notNull().default({}),
    // Exchange rates over the analysis's, by currency.
    exchangeRates: jsonb().$type<ExchangeRates>().notNull().default({}),
    // Changes to projected borrowing bases, by line id.
    borrowingBases: jsonb()
      .$type<Record<string, ScenarioBorrowingBase>>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
  },
  (t) => [index("analysis_scenarios_analysis").on(t.analysisId, t.position)],
).enableRLS();

// The client's monthly projections of a margined line's borrowing base,
// entered in the analysis that uses them (§8.2): a forecast belongs to a
// credit request. Lines are keyed as the analysis knows them, "member/line"
// for a consolidated client's.
export const analysisBorrowingBaseValues = pgTable(
  "analysis_borrowing_base_values",
  {
    analysisId: uuid()
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    lineId: text().notNull(),
    // "YYYY-MM".
    month: text().notNull(),
    code: text().notNull(),
    amount: numeric().notNull(),
  },
  (t) => [primaryKey({ columns: [t.analysisId, t.lineId, t.month, t.code] })],
).enableRLS();

// ---------------------------------------------------------------------------
// Documents (documents-plan.md): PDFs generated from an analysis, kept as
// snapshots for the credit file. Each records what it was built from: the
// template's blocks, the data they read (without lineage) and its hash, and
// the model version, so it reads the same however the analysis changes.

// An organization's own document (documents-plan.md §6): a title with merge
// fields, an orientation and blocks, kept as a draft and as published.
// Analysts print the published definition, so edits reach them only when
// published; each printed document keeps its own copy.
export const documentTemplates = pgTable(
  "document_templates",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    // The model whose lines and charts it names; null when it names none, so
    // any analysis prints it. It stays put once published.
    financialModelId: uuid().references(() => financialModels.id),
    // The built-in's key, or the template's id, it was copied from.
    basedOn: text(),
    // { title, orientation, blocks }
    draft: jsonb().notNull(),
    published: jsonb(),
    publishedAt: timestamp({ withTimezone: true }),
    // No longer offered to print; what was printed from it stays.
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("document_templates_organization").on(t.organizationId),
    index("document_templates_financial_model").on(t.financialModelId),
    check(
      "document_templates_published_at",
      sql`(${t.published} is null) = (${t.publishedAt} is null)`,
    ),
  ],
).enableRLS();

export const documents = pgTable(
  "documents",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entityId: uuid()
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    analysisId: uuid().references(() => analyses.id, { onDelete: "cascade" }),
    // The scenario it shows, when one; kept when the scenario is deleted.
    scenarioId: uuid(),
    // Or the margined line of credit it prints, such as a borrowing base
    // certificate (borrowing-base-plan.md §12); deleted with it.
    creditLineId: uuid().references(() => creditLines.id, {
      onDelete: "cascade",
    }),
    title: text().notNull(),
    // The template's key (a built-in's, or an organization template's id)
    // and the definition it had when generated.
    template: text().notNull(),
    templateId: uuid().references(() => documentTemplates.id, {
      onDelete: "set null",
    }),
    definition: jsonb().notNull(),
    data: jsonb().notNull(),
    dataHash: text().notNull(),
    financialModelVersionId: uuid().references(() => financialModelVersions.id),
    pdf: bytea().notNull(),
    pages: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("documents_organization").on(t.organizationId),
    index("documents_entity").on(t.entityId),
    index("documents_analysis").on(t.analysisId),
    index("documents_credit_line").on(t.creditLineId),
    index("documents_financial_model_version").on(t.financialModelVersionId),
    index("documents_template").on(t.templateId),
  ],
).enableRLS();

// Analysts' comments: on a borrower, kept for good and shown on its page;
// or on one of its analyses, with that analysis. They can be edited and
// deleted, and go with what they're on.
export const comments = pgTable(
  "comments",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entityId: uuid()
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    // The analysis it's on; null for the borrower's own.
    analysisId: uuid().references(() => analyses.id, { onDelete: "cascade" }),
    body: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("comments_organization").on(t.organizationId),
    index("comments_entity").on(t.entityId),
    index("comments_analysis").on(t.analysisId),
  ],
).enableRLS();
