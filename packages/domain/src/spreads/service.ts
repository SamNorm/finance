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
import {
  getLatestPublishedVersion,
  listItems,
} from "../scoring-models/service";
import type { ScoringItem } from "../scoring-models/types";
import { checkPeriod, effectiveAmounts, isNumeric } from "./checks";
import { parseSpreadPaste, type PasteColumn, type PasteRow } from "./paste";
import { parseValue } from "./values";

// Borrowers and their spreads (§5.5). Each period records the scoring model
// version its figures were entered against; figures are keyed by item code.

const { entities, statementPeriods: periods, statementValues: values } = schema;

export type Entity = typeof entities.$inferSelect;
export type StatementPeriod = typeof periods.$inferSelect;
export type StatementQuality = StatementPeriod["quality"];
export type EntityInput = {
  name: string;
  industry?: string | null;
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
  periodCount: number;
  latestPeriodEnd: string | null;
}

export async function listEntities(
  db: Db,
  ctx: Context,
): Promise<EntitySummary[]> {
  return db
    .select({
      ...getTableColumns(entities),
      periodCount: sql<number>`count(${periods.id})::int`,
      latestPeriodEnd: sql<string | null>`max(${periods.periodEnd})::text`,
    })
    .from(entities)
    .leftJoin(periods, eq(periods.entityId, entities.id))
    .where(eq(entities.organizationId, ctx.organizationId))
    .groupBy(entities.id)
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

export async function createEntity(
  db: Db,
  ctx: Context,
  input: EntityInput,
): Promise<Entity> {
  const name = input.name.trim();
  if (!name) throw new DomainError("invalid", "Give the borrower a name.");
  const [entity] = await db
    .insert(entities)
    .values({
      organizationId: ctx.organizationId,
      name,
      industry: input.industry?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .returning();
  return entity!;
}

export async function updateEntity(
  db: Db,
  ctx: Context,
  entityId: string,
  patch: Partial<EntityInput>,
): Promise<Entity> {
  await getEntity(db, ctx, entityId);
  if (patch.name !== undefined && !patch.name.trim()) {
    throw new DomainError("invalid", "Give the borrower a name.");
  }
  const [entity] = await db
    .update(entities)
    .set({
      name: patch.name?.trim(),
      industry:
        patch.industry === undefined
          ? undefined
          : patch.industry?.trim() || null,
      notes:
        patch.notes === undefined ? undefined : patch.notes?.trim() || null,
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

async function requireLayoutVersion(db: Db, ctx: Context) {
  const version = await getLatestPublishedVersion(db, ctx);
  if (!version) {
    throw new DomainError(
      "conflict",
      "Publish the scoring model before entering spreads.",
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
  await getEntity(db, ctx, entityId);
  checkPeriodInput(input);
  const version = await requireLayoutVersion(db, ctx);
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

async function upsertValue(
  db: Db,
  periodId: string,
  item: ScoringItem,
  value: string,
) {
  const row = isNumeric(item)
    ? { amount: value, text: null }
    : { amount: null, text: value };
  await db
    .insert(values)
    .values({ periodId, code: item.code, ...row })
    .onConflictDoUpdate({ target: [values.periodId, values.code], set: row });
}

// Enters, changes or clears (blank) one figure, read as the item's data type.
export async function setValue(
  db: Db,
  ctx: Context,
  periodId: string,
  code: string,
  raw: string,
): Promise<string | null> {
  const period = await findPeriod(db, ctx, periodId);
  const items = await listItems(db, ctx, period.scoringModelVersionId);
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
  if ("error" in parsed) throw new DomainError("invalid", parsed.error);
  if (parsed.value === null) {
    await db
      .delete(values)
      .where(and(eq(values.periodId, periodId), eq(values.code, item.code)));
  } else {
    await upsertValue(db, periodId, item, parsed.value);
  }
  return parsed.value;
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

  const latest = await getLatestPublishedVersion(db, ctx);
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
  columns: (PasteColumn & { existingPeriodId: string | null })[];
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
  await getEntity(db, ctx, entityId);
  const version = await requireLayoutVersion(db, ctx);
  const items = await listItems(db, ctx, version.id);
  const parsed = parseSpreadPaste(text, items);
  const existing = await db
    .select()
    .from(periods)
    .where(eq(periods.entityId, entityId));
  return {
    columns: parsed.columns.map((column) => ({
      ...column,
      existingPeriodId:
        existing.find(
          (p) =>
            p.periodEnd === column.periodEnd &&
            p.months === (column.months ?? 12),
        )?.id ?? null,
    })),
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
  await getEntity(db, ctx, entityId);
  const version = await requireLayoutVersion(db, ctx);
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
      for (const row of parsed.matched) {
        const item = byCode.get(row.code!)!;
        const result = parseValue(row.cells[column] ?? "", item.dataType);
        if (
          "error" in result ||
          result.value === null ||
          item.kind === "header"
        )
          continue;
        await upsertValue(tx, periodId, item, result.value);
        figures++;
      }
    }
    return { periods: targets.length, figures };
  });
}
