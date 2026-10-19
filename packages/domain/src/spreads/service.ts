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
import { Dec } from "@finance/engine";
import type { Context } from "../context";
import { DomainError, hasErrors, type Issue } from "../errors";
import { termIn } from "../credit-lines/terms";
import { monthIndex } from "../financing/amortization";
import { entryId } from "../financing/common";
import { normalizeDebtSchedule } from "../financing/debt-schedule";
import {
  getLatestPublishedVersion,
  getScoringModel,
  listItems,
} from "../scoring-models/service";
import type { ScoringItem } from "../scoring-models/types";
import {
  checkControls,
  checkPeriod,
  effectiveAmounts,
  isNumeric,
  previousPeriod,
  TOLERANCE,
  type CheckItems,
  type ReconciliationLine,
} from "./checks";
import {
  consolidatedClientsOf,
  consolidatedPeriodsUsing,
  consolidatedSpread,
  syncPeriods,
  type Consolidation,
} from "./consolidation";
import { parseSpreadPaste, type PasteColumn, type PasteRow } from "./paste";
import {
  checkPeriodInput,
  consolidatedFigures,
  findDuplicate,
  findPeriod,
  UUID,
} from "./periods";
import { parseValue } from "./values";

export { STATEMENT_QUALITIES } from "./periods";

// Borrowers and their spreads (§5.5). A borrower follows one of the
// organization's scoring models; each period records the version its figures
// were entered against, and figures are keyed by item code. A consolidated
// client's spread adds up its members' (see consolidation.ts).

const { entities, statementPeriods: periods, statementValues: values } = schema;

export type Entity = typeof entities.$inferSelect;
export type EntityKind = Entity["kind"];
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
  input: EntityInput & { kind?: EntityKind },
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
      kind: input.kind ?? "borrower",
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

// Replaces the borrower's existing loans, as of a date. A consolidated
// client's are its members'.
export async function setDebtSchedule(
  db: Db,
  ctx: Context,
  entityId: string,
  input: Parameters<typeof normalizeDebtSchedule>[0],
): Promise<Entity> {
  const current = await getEntity(db, ctx, entityId);
  if (current.kind === "consolidated")
    throw new DomainError(
      "invalid",
      `${current.name} is a consolidated client: its existing loans are its members'. Enter them on the members' pages.`,
    );
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
  // figures are entered, and while no consolidated client relies on it.
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
    const clients = await consolidatedClientsOf(db, entityId);
    if (clients.length)
      throw new DomainError(
        "conflict",
        `${current.name} is a member of ${clients.join(", ")}, on the same scoring model. Remove it there to switch models.`,
      );
    const [member] = await db
      .select({ id: schema.consolidationMembers.memberId })
      .from(schema.consolidationMembers)
      .where(eq(schema.consolidationMembers.entityId, entityId))
      .limit(1);
    if (member)
      throw new DomainError(
        "conflict",
        `${current.name}'s members follow its scoring model. Remove them to switch models.`,
      );
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

// A consolidated client's members stay, as borrowers; a member can't go
// while a consolidated client adds it up.
export async function deleteEntity(
  db: Db,
  ctx: Context,
  entityId: string,
): Promise<void> {
  const entity = await getEntity(db, ctx, entityId);
  const clients = await consolidatedClientsOf(db, entityId);
  if (clients.length)
    throw new DomainError(
      "conflict",
      `${entity.name} is a member of ${clients.join(", ")}. Remove it there first.`,
    );
  await db.delete(entities).where(eq(entities.id, entityId));
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
  if (entity.kind === "consolidated")
    throw new DomainError(
      "invalid",
      `${entity.name} is a consolidated client: add its periods with the members' statements they add up.`,
    );
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

// A consolidated period takes its quality and currency from the statements
// it adds up; only its end and length change. A member's period changing
// passes its quality and currency on to the consolidated periods using it.
export async function updatePeriod(
  db: Db,
  ctx: Context,
  periodId: string,
  patch: Partial<PeriodInput>,
): Promise<StatementPeriod> {
  const { period, entity } = await findPeriod(db, ctx, periodId);
  if (
    entity.kind === "consolidated" &&
    ((patch.quality !== undefined && patch.quality !== period.quality) ||
      (patch.currency !== undefined &&
        patch.currency.trim().toUpperCase() !== period.currency) ||
      patch.consolidated === false)
  )
    throw new DomainError(
      "invalid",
      `${entity.name}'s periods take their quality and currency from the members' statements they add up.`,
    );
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
  const consolidated = entity.kind === "consolidated";
  const [updated] = await db
    .update(periods)
    .set({
      periodEnd: patch.periodEnd,
      months: patch.months,
      quality: consolidated ? undefined : patch.quality,
      currency: consolidated ? undefined : patch.currency?.trim().toUpperCase(),
      consolidated: consolidated ? undefined : patch.consolidated,
    })
    .where(eq(periods.id, periodId))
    .returning();
  if (!consolidated)
    await syncPeriods(
      db,
      (await consolidatedPeriodsUsing(db, periodId)).map((u) => u.periodId),
    );
  return updated!;
}

// A member's period can't go while a consolidated period adds it up.
export async function deletePeriod(
  db: Db,
  ctx: Context,
  periodId: string,
): Promise<void> {
  const { period, entity } = await findPeriod(db, ctx, periodId);
  const uses = await consolidatedPeriodsUsing(db, periodId);
  if (uses.length)
    throw new DomainError(
      "conflict",
      `${entity.name}'s statements ending ${period.periodEnd} are in ${uses.map((u) => `${u.client}'s period ending ${u.periodEnd}`).join(", ")}. Choose other statements there first.`,
    );
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
  const { period, entity } = await findPeriod(db, ctx, periodId);
  if (entity.kind === "consolidated") throw consolidatedFigures(entity.name);
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
  // The scoring model's net income and retained earnings, for its checks.
  checkItems: CheckItems;
  // For a consolidated client, what each period adds up; null for a
  // borrower.
  consolidation: Consolidation | null;
}

export async function getSpread(
  db: Db,
  ctx: Context,
  entityId: string,
): Promise<Spread> {
  const entity = await getEntity(db, ctx, entityId);
  if (entity.kind === "consolidated")
    return consolidatedSpread(db, ctx, entity);
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

  const [latest, { checkItems }] = await Promise.all([
    getLatestPublishedVersion(db, ctx, entity.scoringModelId),
    getScoringModel(db, ctx, entity.scoringModelId),
  ]);
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
    checkItems,
    consolidation: null,
  };
  const figures = new Map(
    list.map((period) => [
      period.id,
      new Map(
        rows
          .filter((r) => r.periodId === period.id)
          .map((r) => [r.code, (r.amount ?? r.text)!]),
      ),
    ]),
  );
  const itemsOf = (period: StatementPeriod) =>
    itemsByVersion.get(period.scoringModelVersionId)!;
  for (const period of list) {
    const entered = figures.get(period.id)!;
    const items = itemsOf(period);
    spread.values[period.id] = Object.fromEntries(entered);
    spread.computed[period.id] = Object.fromEntries(
      [...effectiveAmounts(items, entered).computed].map(([code, value]) => [
        code,
        value.toFixed(),
      ]),
    );
    const previous = previousPeriod(period, list);
    spread.checks[period.id] = [
      ...checkPeriod(items, entered),
      ...checkControls(items, entered, {
        items: checkItems,
        reportedNetIncome: period.reportedNetIncome,
        reconciliation: period.reconciliation,
        previous: previous && {
          end: previous.periodEnd,
          items: itemsOf(previous),
          entered: figures.get(previous.id)!,
        },
      }),
    ];
  }
  await addLineLimitChecks(db, spread, [entity.id]);
  return spread;
}

// The borrower's lines of credit (its members', for a consolidated client)
// against the spread's authorized line at the latest fiscal year end: their
// limits then, added up, should match it. A gap is flagged, not blocked.
export async function addLineLimitChecks(
  db: Db,
  spread: Spread,
  entityIds: readonly string[],
) {
  const code = spread.checkItems.lineAuthorized;
  const year = spread.periods.findLast(
    (p) => p.months === 12 && p.quality !== "projected",
  );
  if (!code || !year || !entityIds.length) return;
  const raw =
    spread.values[year.id]?.[code] ?? spread.computed[year.id]?.[code];
  if (raw === undefined) return;
  const lines = await db
    .select()
    .from(schema.creditLines)
    .where(inArray(schema.creditLines.entityId, [...entityIds]));
  const month = monthIndex(year.periodEnd);
  const open = lines.filter(
    (l) => !l.closedOn || monthIndex(l.closedOn) >= month,
  );
  if (!open.length) return;
  const limits = open.reduce(
    (sum, l) => sum.plus(termIn(l.limit, month).value),
    new Dec(0),
  );
  const authorized = new Dec(raw);
  if (limits.minus(authorized).abs().lte(TOLERANCE)) return;
  const show = (value: InstanceType<typeof Dec>) =>
    Number(value.toFixed(2)).toLocaleString("en-CA", {
      maximumFractionDigits: 2,
    });
  (spread.checks[year.id] ??= []).push({
    severity: "warning",
    code: "line_limits",
    itemCode: code,
    message: `The lines of credit's limits add up to ${show(limits)} at ${year.periodEnd}, but the spread's authorized line is ${show(authorized)}.`,
  });
}

// A period's figures from the statements themselves, which its checks
// compare the spread with. Each is optional.
export interface PeriodControlsInput {
  // Net income as printed; blank or null clears it.
  reportedNetIncome?: string | null;
  // Replaces how retained earnings changed other than by net income, each
  // line's amount as typed, negative when it reduces them.
  reconciliation?: readonly {
    id?: unknown;
    label?: unknown;
    amount?: unknown;
    forced?: unknown;
  }[];
}

const MAX_RECONCILIATION = 50;

function normalizeReconciliation(
  lines: PeriodControlsInput["reconciliation"],
): ReconciliationLine[] {
  if (!Array.isArray(lines) || lines.length > MAX_RECONCILIATION)
    throw new DomainError(
      "invalid",
      `The reconciliation is a list of up to ${MAX_RECONCILIATION} lines.`,
    );
  return lines.map((line, i) => {
    const label = String(line?.label ?? "").trim();
    if (!label)
      throw new DomainError(
        "invalid",
        `Reconciliation line ${i + 1}: give it a label.`,
      );
    const parsed = parseValue(String(line.amount ?? ""), "amount");
    if ("error" in parsed)
      throw new DomainError("invalid", `${label}: ${parsed.error}`);
    if (parsed.value === null)
      throw new DomainError("invalid", `${label}: enter the amount.`);
    return {
      id: entryId(line.id),
      label,
      amount: parsed.value,
      ...(line.forced === true ? { forced: true } : {}),
    };
  });
}

export async function setPeriodControls(
  db: Db,
  ctx: Context,
  periodId: string,
  input: PeriodControlsInput,
): Promise<StatementPeriod> {
  const { entity } = await findPeriod(db, ctx, periodId);
  // Members' statements are checked against their own net income.
  if (
    entity.kind === "consolidated" &&
    input.reportedNetIncome !== undefined &&
    input.reportedNetIncome !== null &&
    String(input.reportedNetIncome).trim()
  )
    throw new DomainError(
      "invalid",
      `${entity.name} is a consolidated client: there's no net income as printed to enter. Each member's statements are checked against their own.`,
    );
  let reportedNetIncome: string | null | undefined;
  if (input.reportedNetIncome !== undefined) {
    const parsed = parseValue(String(input.reportedNetIncome ?? ""), "amount");
    if ("error" in parsed)
      throw new DomainError("invalid", `Net income: ${parsed.error}`);
    reportedNetIncome = parsed.value;
  }
  const [updated] = await db
    .update(periods)
    .set({
      reportedNetIncome,
      reconciliation:
        input.reconciliation && normalizeReconciliation(input.reconciliation),
    })
    .where(eq(periods.id, periodId))
    .returning();
  return updated!;
}

// Forces retained earnings to roll forward from the period before: a line
// for what's left once net income and the reconciliation's other lines are
// counted (a consolidated period's members' too), replacing any forced
// before. It stays in the reconciliation, so a reviewer sees what was forced.
export async function forceRetainedEarnings(
  db: Db,
  ctx: Context,
  periodId: string,
): Promise<StatementPeriod> {
  const { period } = await findPeriod(db, ctx, periodId);
  const spread = await getSpread(db, ctx, period.entityId);
  const { netIncome, retainedEarnings } = spread.checkItems;
  if (!netIncome || !retainedEarnings)
    throw new DomainError(
      "conflict",
      "The scoring model doesn't say which items are net income and retained earnings yet.",
    );
  const current = spread.periods.find((p) => p.id === periodId)!;
  const previous = previousPeriod(current, spread.periods);
  if (!previous)
    throw new DomainError(
      "invalid",
      "There's no period before this one for retained earnings to roll forward from.",
    );
  const figure = (id: string, code: string) =>
    spread.values[id]?.[code] ?? spread.computed[id]?.[code];
  const end = figure(periodId, retainedEarnings);
  const start = figure(previous.id, retainedEarnings);
  if (end === undefined || start === undefined)
    throw new DomainError(
      "invalid",
      "Retained earnings need a figure in both periods to roll forward.",
    );
  const kept = current.reconciliation.filter((line) => !line.forced);
  const members =
    spread.consolidation?.periods[periodId]?.memberReconciliation ?? [];
  const difference = [...members, ...kept]
    .reduce(
      (left, line) => left.minus(line.amount),
      new Dec(end).minus(start).minus(figure(periodId, netIncome) ?? 0),
    )
    .toDecimalPlaces(2);
  return setPeriodControls(db, ctx, periodId, {
    reconciliation: difference.abs().gt(TOLERANCE)
      ? [
          ...kept,
          {
            label: "Unreconciled difference",
            amount: difference.toFixed(),
            forced: true,
          },
        ]
      : kept,
  });
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
  if (entity.kind === "consolidated") throw consolidatedFigures(entity.name);
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
  const { checkItems } = await getScoringModel(db, ctx, entity.scoringModelId);
  const byCode = new Map(items.map((item) => [item.code, item]));
  const totals = items.filter(
    (item) => item.parentCode === null && item.kind === "subtotal",
  );
  const figuresOf = (periodId: string | null) =>
    new Map(
      existingFigures
        .filter((v) => v.periodId === periodId)
        .map((v) => [v.code, (v.amount ?? v.text)!]),
    );
  // What each column leaves in its period: the figures already there, with
  // those pasted in their place. Checked as the spread is, so a figure
  // mistyped on its way here shows, as totals that don't tie.
  const pasted = parsed.columns.map((column, position) => {
    const months = column.months ?? 12;
    const period =
      existing.find(
        (p) => p.periodEnd === column.periodEnd && p.months === months,
      ) ?? null;
    const entered = figuresOf(period?.id ?? null);
    for (const { item, value } of columnFigures(parsed, position, byCode))
      entered.set(item.code, value);
    return { column, period, months, entered };
  });
  // The spread as it would stand, for retained earnings to roll forward
  // through: the pasted columns, and the periods they leave alone.
  const after = [
    ...pasted.flatMap(({ column, months, entered }) =>
      column.periodEnd
        ? [{ periodEnd: column.periodEnd, months, entered }]
        : [],
    ),
    ...existing
      .filter((e) => !pasted.some((p) => p.period?.id === e.id))
      .map((e) => ({
        periodEnd: e.periodEnd,
        months: e.months,
        entered: figuresOf(e.id),
      })),
  ];
  return {
    columns: pasted.map(({ column, period, entered }) => {
      const { amounts } = effectiveAmounts(items, entered);
      const self = after.find((a) => a.entered === entered);
      const previous = self && previousPeriod(self, after);
      return {
        ...column,
        existingPeriodId: period?.id ?? null,
        totals: totals.map((item) => ({
          code: item.code,
          label: item.label,
          value: amounts.get(item.code)?.toFixed() ?? null,
        })),
        checks: [
          ...checkPeriod(items, entered),
          ...(self
            ? checkControls(items, entered, {
                items: checkItems,
                reportedNetIncome: period?.reportedNetIncome ?? null,
                reconciliation: period?.reconciliation ?? [],
                previous: previous
                  ? {
                      end: previous.periodEnd,
                      items,
                      entered: previous.entered,
                    }
                  : null,
              })
            : []),
        ],
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
  if (entity.kind === "consolidated") throw consolidatedFigures(entity.name);
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
