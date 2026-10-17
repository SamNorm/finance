// Tables, in build order (brainstorm-recap.md §5, §12). Columns are camelCase
// here and snake_case in Postgres (casing is set on the client and drizzle-kit).
//
// RLS is enabled with no policies on every table: the app connects as the table
// owner and bypasses it, while Supabase's public API roles (anon, authenticated)
// get nothing. Authorization lives in the domain layer, not in policies (§9.3).
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
// Scoring model (§5.2): 0..1 per organization, versioned, inputs only.
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
  (t) => [
    uniqueIndex("scoring_models_one_per_organization").on(t.organizationId),
  ],
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
