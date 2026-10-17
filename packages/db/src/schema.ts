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

export const organizations = pgTable("organizations", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  createdAt: createdAt(),
}).enableRLS();

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

// A borrower or acquisition target.
export const entities = pgTable(
  "entities",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("entities_organization").on(t.organizationId),
    index("entities_scoring_model").on(t.scoringModelId),
  ],
).enableRLS();

export const statementQuality = pgEnum("statement_quality", [
  "audited",
  "review",
  "compilation",
  "internal",
  "projected",
]);

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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("analyses_organization").on(t.organizationId),
    index("analyses_entity").on(t.entityId),
    index("analyses_financial_model_version").on(t.financialModelVersionId),
    check(
      "analyses_projection_years",
      sql`${t.projectionYears} between 0 and 10`,
    ),
  ],
).enableRLS();

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
    createdAt: createdAt(),
  },
  (t) => [index("analysis_scenarios_analysis").on(t.analysisId, t.position)],
).enableRLS();
