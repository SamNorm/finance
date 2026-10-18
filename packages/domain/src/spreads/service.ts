import {
  and,
  asc,
  eq,
  getTableColumns,
  inArray,
  schema,
  sql,
  type Db,
} from "@finance/db";
import type { Context } from "../context";
import { DomainError, hasErrors, type Issue } from "../errors";
import { normalizeDebtSchedule } from "../financing/debt-schedule";
import {
  getLatestPublishedVersion,
  getScoringModel,
  listItems,
} from "../scoring-models/service";
import type { ScoringItem } from "../scoring-models/types";
import { checkPeriod, effectiveAmounts, isNumeric } from "./checks";
import { parseSpreadPaste, type PasteColumn, type PasteRow } from "./paste";
import { parseValue } from "./values";

// Borrowers and their spreads (§5.5). A borrower follows one of the
// organization's scoring models; each period records the version its figures
// were entered against, and figures are keyed by item code.

const { entities, statementPeriods: periods, statementValues: values } = schema;

export type Entity = typeof entities.$inferSelect;
export type StatementPeriod = typeof periods.$inferSelect;
export type StatementQuality = StatementPeriod["quality"];
export type EntityInput = {
  name: string;
  scoringModelId: string;
  industry?: string | null;
  naicsCode?: string | null;
  riskRating?: string | null;
  notes?: string | null;
};
export type PeriodInput = Pick<
  StatementPeriod,
  "periodEnd" | "months" | "quality"
> &
  Partial<Pick<StatementPeriod, "currency" | "consolidated">>;

export const STATEMENT_QUALITIES: StatementQuality[] = [
  "audited",
  "review",
  "compilation",
  "internal",
  "projected",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EntitySummary extends Entity {
  scoringModelName: string;
  periodCount: number;
  projectedPeriodCount: number;
  latestPeriodEnd: string | null;
}

export async function listEntities(
  db: Db,
  ctx: Context,
): Promise<EntitySummary[]> {
  return db
    .select({
      ...getTableColumns(entities),
      scoringModelName: schema.scoringModels.name,
      periodCount: sql<number>`count(${periods.id})::int`,
      // The client's own projections, spread as periods of quality "projected".
      projectedPeriodCount: sql<number>`(count(${periods.id}) filter (where ${periods.quality} = 'projected'))::int`,
      latestPeriodEnd: sql<string | null>`max(${periods.periodEnd})::text`,
    })
    .from(entities)
    .innerJoin(
      schema.scoringModels,
      eq(schema.scoringModels.id, entities.scoringModelId),
    )
    .leftJoin(periods, eq(periods.entityId, entities.id))
    .where(eq(entities.organizationId, ctx.organizationId))
    .groupBy(entities.id, schema.scoringModels.name)
    .orderBy(asc(entities.name));
}

export async function getEntity(
  db: Db,
  ctx: Context,
  entityId: string,
): Promise<Entity> {
  if (!UUID.test(entityId))
    throw new DomainError("not_found", "No such borrower.");
  const [entity] = await db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.id, entityId),
        eq(entities.organizationId, ctx.organizationId),
      ),
    );
  if (!entity) throw new DomainError("not_found", "No such borrower.");
  return entity;
}

const NAICS = /^\d{2,6}$/;

// Optional text fields: trimmed, blank stored as null, undefined left alone.
const optional = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

function checkNaics(code: string | null | undefined) {
  if (code && !NAICS.test(code)) {
    throw new DomainError(
      "invalid",
      `"${code}" isn't a NAICS code (2 to 6 digits).`,
    );
  }
}

export async function createEntity(
  db: Db,
  ctx: Context,
  input: EntityInput,
): Promise<Entity> {
  const name = input.name.trim();
  if (!name) throw new DomainError("invalid", "Give the borrower a name.");
  const model = await getScoringModel(db, ctx, input.scoringModelId);
  const naicsCode = optional(input.naicsCode);
  checkNaics(naicsCode);
  const [entity] = await db
    .insert(entities)
    .values({
      organizationId: ctx.organizationId,
      name,
      scoringModelId: model.id,
      industry: optional(input.industry) ?? null,
      naicsCode: naicsCode ?? null,
      riskRating: optional(input.riskRating) ?? null,
      notes: optional(input.notes) ?? null,
    })
    .returning();
  return entity!;
}

// Replaces the borrower's existing loans, as of a date.
export async function setDebtSchedule(
  db: Db,
  ctx: Context,
  entityId: string,
  input: Parameters<typeof normalizeDebtSchedule>[0],
): Promise<Entity> {
  await getEntity(db, ctx, entityId);
  const [entity] = await db
    .update(entities)
    .set({ debtSchedule: normalizeDebtSchedule(input) })
    .where(eq(entities.id, entityId))
    .returning();
  return entity!;
}

// Replaces one existing loan's schedule adjustments, as typed.
export async function setExistingLoanAdjustments(
  db: Db,
  ctx: Context,
  entityId: string,
  loanId: string,
  adjustments: unknown,
): Promise<Entity> {
  const { debtSchedule } = await getEntity(db, ctx, entityId);
  if (!debtSchedule.loans.some((loan) => loan.id === loanId))
    throw new DomainError("not_found", "No such loan.");
  return setDebtSchedule(db, ctx, entityId, {
    asOf: debtSchedule.asOf,
    loans: debtSchedule.loans.map((loan) =>
      loan.id === loanId ? { ...loan, adjustments } : loan,
    ),
  });
}

export async function updateEntity(
  db: Db,
  ctx: Context,
  entityId: string,
  patch: Partial<EntityInput>,
): Promise<Entity> {
  const current = await getEntity(db, ctx, entityId);
  if (patch.name !== undefined && !patch.name.trim()) {
    throw new DomainError("invalid", "Give the borrower a name.");
  }
  const naicsCode = optional(patch.naicsCode);
  checkNaics(naicsCode);
  // The scoring model lays the spread out, so it only changes before any
  // figures are entered.
  let scoringModelId: string | undefined;
  if (patch.scoringModelId && patch.scoringModelId !== current.scoringModelId) {
    const [period] = await db
      .select({ id: periods.id })
      .from(periods)
      .where(eq(periods.entityId, entityId))
      .limit(1);
    if (period) {
      throw new DomainError(
        "conflict",
        "The borrower has periods on its scoring model. Delete them to switch models.",
      );
    }
    scoringModelId = (await getScoringModel(db, ctx, patch.scoringModelId)).id;
  }
  const [entity] = await db
    .update(entities)
    .set({
      name: patch.name?.trim(),
      scoringModelId,
      industry: optional(patch.industry),
      naicsCode,
      riskRating: optional(patch.riskRating),
      notes: optional(patch.notes),
    })
    .where(eq(entities.id, entityId))
    .returning();
  return entity!;
}

export async function deleteEntity(
  db: Db,
  ctx: Context,
  entityId: string,
): Promise<void> {
  await getEntity(db, ctx, entityId);
  await db.delete(entities).where(eq(entities.id, entityId));
}

function checkPeriodInput(input: Partial<PeriodInput>) {
  if (input.periodEnd !== undefined) {
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(input.periodEnd) &&
      new Date(`${input.periodEnd}T00:00:00Z`)
        .toISOString()
        .startsWith(input.periodEnd);
    if (!valid)
      throw new DomainError(
        "invalid",
        `"${input.periodEnd}" isn't a date (YYYY-MM-DD).`,
      );
  }
  if (
    input.months !== undefined &&
    (!Number.isInteger(input.months) || input.months < 1 || input.months > 24)
  ) {
    throw new DomainError("invalid", "A period covers 1 to 24 months.");
  }
  if (
    input.quality !== undefined &&
    !STATEMENT_QUALITIES.includes(input.quality)
  ) {
    throw new DomainError(
      "invalid",
      `"${input.quality}" isn't a statement quality.`,
    );
  }
}

async function findDuplicate(
  db: Db,
  entityId: string,
  periodEnd: string,
  months: number,
) {
  const [existing] = await db
    .select({ id: periods.id })
    .from(periods)
    .where(
      and(
        eq(periods.entityId, entityId),
        eq(periods.periodEnd, periodEnd),
        eq(periods.months, months),
      ),
    );
  return existing?.id ?? null;
}

// The version new periods are entered against: the latest published version
// of the borrower's scoring model.
async function requireLayoutVersion(db: Db, ctx: Context, entity: Entity) {
  const version = await getLatestPublishedVersion(
    db,
    ctx,
    entity.scoringModelId,
  );
  if (!version) {
    throw new DomainError(
      "conflict",
      "Publish the borrower's scoring model before entering spreads.",
    );
  }
  return version;
}

export async function addPeriod(
  db: Db,
  ctx: Context,
  entityId: string,
  input: PeriodInput,
): Promise<StatementPeriod> {
  const entity = await getEntity(db, ctx, entityId);
  checkPeriodInput(input);
  const version = await requireLayoutVersion(db, ctx, entity);
  if (await findDuplicate(db, entityId, input.periodEnd, input.months)) {
    throw new DomainError(
      "conflict",
      `This borrower already has a ${input.months}-month period ending ${input.periodEnd}.`,
    );
  }
  const [period] = await db
    .insert(periods)
    .values({
      entityId,
      periodEnd: input.periodEnd,
      months: input.months,
      quality: input.quality,
      currency: input.currency?.trim().toUpperCase() || "CAD",
      consolidated: input.consolidated ?? false,
      scoringModelVersionId: version.id,
    })
    .returning();
  return period!;
}

async function findPeriod(db: Db, ctx: Context, periodId: string) {
  if (!UUID.test(periodId))
    throw new DomainError("not_found", "No such period.");
  const [row] = await db
    .select({ period: periods })
    .from(periods)
    .innerJoin(entities, eq(entities.id, periods.entityId))
    .where(
      and(
        eq(periods.id, periodId),
        eq(entities.organizationId, ctx.organizationId),
      ),
    );
  if (!row) throw new DomainError("not_found", "No such period.");
  return row.period;
}

export async function updatePeriod(
  db: Db,
  ctx: Context,
  periodId: string,
  patch: Partial<PeriodInput>,
): Promise<StatementPeriod> {
  const period = await findPeriod(db, ctx, periodId);
  checkPeriodInput(patch);
  const periodEnd = patch.periodEnd ?? period.periodEnd;
  const months = patch.months ?? period.months;
  const duplicate = await findDuplicate(db, period.entityId, periodEnd, months);
  if (duplicate && duplicate !== periodId) {
    throw new DomainError(
      "conflict",
      `There's already a ${months}-month period ending ${periodEnd}.`,
    );
  }
  const [updated] = await db
    .update(periods)
    .set({
      periodEnd: patch.periodEnd,
      months: patch.months,
      quality: patch.quality,
      currency: patch.currency?.trim().toUpperCase(),
      consolidated: patch.consolidated,
    })
    .where(eq(periods.id, periodId))
    .returning();
  return updated!;
}

export async function deletePeriod(
  db: Db,
  ctx: Context,
  periodId: string,
): Promise<void> {
  await findPeriod(db, ctx, periodId);
  await db.delete(periods).where(eq(periods.id, periodId));
}

const figureRow = (periodId: string, item: ScoringItem, value: string) =>
  isNumeric(item)
    ? { periodId, code: item.code, amount: value, text: null }
    : { periodId, code: item.code, amount: null, text: value };

// Writes figures in one statement, replacing those already entered.
async function upsertValues(db: Db, rows: ReturnType<typeof figureRow>[]) {
  if (!rows.length) return;
  await db
    .insert(values)
    .values(rows)
    .onConflictDoUpdate({
      target: [values.periodId, values.code],
      set: { amount: sql`excluded.amount`, text: sql`excluded.text` },
    });
}

// Enters, changes or clears (blank) one figure, read as the item's data type.
export async function setValue(
  db: Db,
  ctx: Context,
  periodId: string,
  code: string,
  raw: string,
): Promise<string | null> {
  return (await setValues(db, ctx, periodId, { [code]: raw }))[code] ?? null;
}

// Enters, changes or clears (blank) several figures of one period, by item
// code. Every figure is read and checked before any is written, so a batch
// is saved whole or not at all.
export async function setValues(
  db: Db,
  ctx: Context,
  periodId: string,
  figures: Record<string, string>,
): Promise<Record<string, string | null>> {
  const period = await findPeriod(db, ctx, periodId);
  const items = await listItems(db, ctx, period.scoringModelVersionId);
  const entries = Object.entries(figures);
  if (!entries.length)
    throw new DomainError("invalid", "Give at least one figure.");
  const result: Record<string, string | null> = {};
  const rows: ReturnType<typeof figureRow>[] = [];
  const cleared: string[] = [];
  for (const [code, raw] of entries) {
    const item = items.find((i) => i.code === code);
    if (!item)
      throw new DomainError(
        "invalid",
        `"${code}" isn't in this period's scoring model.`,
      );
    if (item.kind === "header")
      throw new DomainError(
        "invalid",
        `${item.label} is a header and holds no figure.`,
      );
    const parsed = parseValue(raw, item.dataType);
    if ("error" in parsed)
      throw new DomainError(
        "invalid",
        entries.length > 1 ? `${item.label}: ${parsed.error}` : parsed.error,
      );
    result[code] = parsed.value;
    if (parsed.value === null) cleared.push(code);
    else rows.push(figureRow(periodId, item, parsed.value));
  }
  await db.transaction(async (tx) => {
    if (cleared.length)
      await tx
        .delete(values)
        .where(
          and(eq(values.periodId, periodId), inArray(values.code, cleared)),
        );
    await upsertValues(tx, rows);
  });
  return result;
}

export interface Spread {
  entity: Entity;
  // Oldest first.
  periods: StatementPeriod[];
  // The latest published scoring model version, which lays the grid out.
  layout: {
    versionId: string;
    versionNumber: number;
    items: ScoringItem[];
  } | null;
  // Entered figures, by period id then code.
  values: Record<string, Record<string, string>>;
  // Subtotals summed from their lines where nothing was entered.
  computed: Record<string, Record<string, string>>;
  checks: Record<string, Issue[]>;
}

export async function getSpread(
  db: Db,
  ctx: Context,
  entityId: string,
): Promise<Spread> {
  const entity = await getEntity(db, ctx, entityId);
  const list = await db
    .select()
    .from(periods)
    .where(eq(periods.entityId, entityId))
    .orderBy(asc(periods.periodEnd), asc(periods.months));
  const rows = list.length
    ? await db
        .select()
        .from(values)
        .where(
          inArray(
            values.periodId,
            list.map((p) => p.id),
          ),
        )
    : [];

  const latest = await getLatestPublishedVersion(
    db,
    ctx,
    entity.scoringModelId,
  );
  const itemsByVersion = new Map<string, ScoringItem[]>();
  for (const versionId of new Set([
    ...list.map((p) => p.scoringModelVersionId),
    ...(latest ? [latest.id] : []),
  ])) {
    itemsByVersion.set(versionId, await listItems(db, ctx, versionId));
  }

  const spread: Spread = {
    entity,
    periods: list,
    layout: latest
      ? {
          versionId: latest.id,
          versionNumber: latest.number,
          items: itemsByVersion.get(latest.id)!,
        }
      : null,
    values: {},
    computed: {},
    checks: {},
  };
  for (const period of list) {
    const entered = new Map(
      rows
        .filter((r) => r.periodId === period.id)
        .map((r) => [r.code, (r.amount ?? r.text)!]),
    );
    const items = itemsByVersion.get(period.scoringModelVersionId)!;
    spread.values[period.id] = Object.fromEntries(entered);
    spread.computed[period.id] = Object.fromEntries(
      [...effectiveAmounts(items, entered).computed].map(([code, value]) => [
        code,
        value.toFixed(),
      ]),
    );
    spread.checks[period.id] = checkPeriod(items, entered);
  }
  return spread;
}

export interface PastePreview {
  columns: (PasteColumn & {
    existingPeriodId: string | null;
    // Each statement's top-level totals in the period once pasted, and the
    // spread's checks on it, such as a balance sheet that doesn't balance.
    totals: { code: string; label: string; value: string | null }[];
    checks: Issue[];
  })[];
  matched: number;
  figures: number;
  unmatched: Pick<PasteRow, "row" | "label">[];
  issues: Issue[];
  canImport: boolean;
}

export async function previewPaste(
  db: Db,
  ctx: Context,
  entityId: string,
  text: string,
): Promise<PastePreview> {
  const entity = await getEntity(db, ctx, entityId);
  const version = await requireLayoutVersion(db, ctx, entity);
  const items = await listItems(db, ctx, version.id);
  const parsed = parseSpreadPaste(text, items);
  const existing = await db
    .select()
    .from(periods)
    .where(eq(periods.entityId, entityId));
  const existingFigures = existing.length
    ? await db
        .select()
        .from(values)
        .where(
          inArray(
            values.periodId,
            existing.map((p) => p.id),
          ),
        )
    : [];
  const byCode = new Map(items.map((item) => [item.code, item]));
  const totals = items.filter(
    (item) => item.parentCode === null && item.kind === "subtotal",
  );
  return {
    // What each column leaves in its period: the figures already there, with
    // those pasted in their place. Checked as the spread is, so a figure
    // mistyped on its way here shows, as totals that don't tie.
    columns: parsed.columns.map((column, position) => {
      const existingPeriodId =
        existing.find(
          (p) =>
            p.periodEnd === column.periodEnd &&
            p.months === (column.months ?? 12),
        )?.id ?? null;
      const entered = new Map(
        existingFigures
          .filter((v) => v.periodId === existingPeriodId)
          .map((v) => [v.code, (v.amount ?? v.text)!]),
      );
      for (const { item, value } of columnFigures(parsed, position, byCode))
        entered.set(item.code, value);
      const { amounts } = effectiveAmounts(items, entered);
      return {
        ...column,
        existingPeriodId,
        totals: totals.map((item) => ({
          code: item.code,
          label: item.label,
          value: amounts.get(item.code)?.toFixed() ?? null,
        })),
        checks: checkPeriod(items, entered),
      };
    }),
    matched: parsed.matched.length,
    figures: parsed.matched.reduce(
      (n, r) => n + r.cells.filter((c) => c.trim()).length,
      0,
    ),
    unmatched: parsed.unmatched.map(({ row, label }) => ({ row, label })),
    issues: parsed.issues,
    canImport: parsed.matched.length > 0 && !hasErrors(parsed.issues),
  };
}

// The figures in one of a paste's columns, by its position among them, read
// as their items' data types. Blank cells and unreadable ones are left out.
function columnFigures(
  parsed: ReturnType<typeof parseSpreadPaste>,
  position: number,
  byCode: ReadonlyMap<string, ScoringItem>,
) {
  return parsed.matched.flatMap((row) => {
    const item = byCode.get(row.code!)!;
    const result = parseValue(row.cells[position] ?? "", item.dataType);
    return "error" in result || result.value === null || item.kind === "header"
      ? []
      : [{ item, value: result.value }];
  });
}

export interface PasteTarget {
  // Column index, as in the preview.
  index: number;
  periodEnd: string;
  months: number;
  quality: StatementQuality;
}

// Writes the pasted figures, creating the periods that don't exist yet. A
// pasted figure replaces the one entered before; blank cells change nothing.
export async function pasteSpread(
  db: Db,
  ctx: Context,
  entityId: string,
  text: string,
  targets: PasteTarget[],
): Promise<{ periods: number; figures: number }> {
  const entity = await getEntity(db, ctx, entityId);
  const version = await requireLayoutVersion(db, ctx, entity);
  const items = await listItems(db, ctx, version.id);
  const parsed = parseSpreadPaste(text, items);
  if (hasErrors(parsed.issues)) {
    throw new DomainError(
      "invalid",
      "The paste has errors to fix first.",
      parsed.issues.filter((i) => i.severity === "error"),
    );
  }
  if (!targets.length)
    throw new DomainError("invalid", "Choose at least one column to import.");
  const keys = targets.map((t) => `${t.periodEnd}/${t.months}`);
  if (new Set(keys).size !== keys.length) {
    throw new DomainError("invalid", "Two columns are set to the same period.");
  }
  const byCode = new Map(items.map((item) => [item.code, item]));

  return db.transaction(async (tx) => {
    let figures = 0;
    for (const target of targets) {
      checkPeriodInput(target);
      const column = parsed.columns.findIndex((c) => c.index === target.index);
      if (column === -1)
        throw new DomainError(
          "invalid",
          `Column ${target.index + 1} has no figures.`,
        );
      const periodId =
        (await findDuplicate(tx, entityId, target.periodEnd, target.months)) ??
        (await addPeriod(tx, ctx, entityId, target)).id;
      const rows = columnFigures(parsed, column, byCode).map(
        ({ item, value }) => figureRow(periodId, item, value),
      );
      await upsertValues(tx, rows);
      figures += rows.length;
    }
    return { periods: targets.length, figures };
  });
}
