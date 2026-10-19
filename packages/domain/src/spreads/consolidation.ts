import { and, asc, eq, inArray, schema, type Db } from "@finance/db";
import { Dec } from "@finance/engine";
import type { Context } from "../context";
import { forgetLines } from "../credit-lines/forget";
import { DomainError, type Issue } from "../errors";
import { monthIndex } from "../financing/amortization";
import { entryId, type Amount, type FinancingPart } from "../financing/common";
import type { DebtSchedule } from "../financing/debt-schedule";
import { balanceSheetSides } from "../financing/financing";
import {
  getLatestPublishedVersion,
  getScoringModel,
  listItems,
} from "../scoring-models/service";
import type { ScoringItem } from "../scoring-models/types";
import {
  addToItems,
  checkControls,
  checkPeriod,
  effectiveAmounts,
  previousPeriod,
  TOLERANCE,
} from "./checks";
import { checkPeriodInput, findDuplicate, findPeriod, UUID } from "./periods";
import {
  addLineLimitChecks,
  createEntity,
  getEntity,
  getSpread,
  type Entity,
  type EntityInput,
  type Spread,
  type StatementPeriod,
  type StatementQuality,
} from "./service";
import { parseValue } from "./values";

// Consolidated clients (§5.5): a client whose spread adds up other
// borrowers' on the same scoring model, such as an operating company and the
// company that owns its building. Each period takes one set of statements per
// member, which may end on another date, and eliminations then take out what
// the members owe, sell or pay each other. Nothing is copied: the spread is
// computed when read, so it follows the members' as they change.

const {
  consolidatedStatements: links,
  consolidationMembers: members,
  entities,
  scoringModelVersions,
  statementPeriods: periods,
} = schema;

export type Elimination = schema.Elimination;

// One member's statements in a consolidated period.
export interface MemberStatement {
  memberId: string;
  periodId: string;
  periodEnd: string;
  months: number;
  quality: StatementQuality;
  currency: string;
  consolidated: boolean;
  // Its figures: entered, or summed from their lines for subtotals.
  figures: Record<string, string>;
}

export interface ConsolidatedPeriod {
  // In the members' order, one per member at most.
  statements: MemberStatement[];
  eliminations: Elimination[];
  // How the members' retained earnings changed other than by net income,
  // which the consolidated period's roll forward with, before its own lines.
  memberReconciliation: { memberId: string; label: string; amount: string }[];
}

export interface Consolidation {
  // In the worksheet's order, with the periods each can contribute and its
  // existing loans as entered.
  members: {
    id: string;
    name: string;
    periods: Pick<
      StatementPeriod,
      "id" | "periodEnd" | "months" | "quality" | "currency" | "consolidated"
    >[];
    debtSchedule: DebtSchedule;
  }[];
  // By the consolidated client's period id.
  periods: Record<string, ConsolidatedPeriod>;
}

const invalid = (message: string) => new DomainError("invalid", message);

// A member's statements more than this many months from the period's end
// are flagged.
export const MAX_GAP_MONTHS = 6;

const RANK: Record<StatementQuality, number> = {
  audited: 0,
  review: 1,
  compilation: 2,
  internal: 3,
  projected: 4,
};

// A consolidated period is only as reliable as its weakest statements.
const weakest = (qualities: readonly StatementQuality[]) =>
  qualities.reduce((worst, q) => (RANK[q] > RANK[worst] ? q : worst));

// Amounts and counts add up; rates, dates and ratios are kept only when the
// members agree, and differing notes are kept with each member's name.
const ADDITIVE = new Set(["amount", "count"]);

const dollars = (value: Amount) =>
  Number(value.toFixed(2)).toLocaleString("en-CA", {
    maximumFractionDigits: 2,
  });

// The figures of one consolidated period: the members' statements added up
// item by item, then the eliminations added to their items. A subtotal any
// member entered as a figure is the sum of each member's, entered or summed,
// so eliminations move it too.
export function consolidateFigures(
  items: readonly ScoringItem[],
  statements: readonly {
    name: string;
    entered: Readonly<Record<string, string>>;
    computed: Readonly<Record<string, string>>;
  }[],
  eliminations: readonly Pick<Elimination, "id" | "name" | "item" | "amount">[],
): Record<string, string> {
  const sum: Record<string, string> = {};
  for (const item of items) {
    if (item.kind === "header") continue;
    const own = statements.flatMap((s) => {
      const value = s.entered[item.code];
      return value === undefined ? [] : [{ name: s.name, value }];
    });
    if (!own.length) continue;
    if (ADDITIVE.has(item.dataType)) {
      const values =
        item.kind === "subtotal"
          ? statements.flatMap(
              (s) => s.entered[item.code] ?? s.computed[item.code] ?? [],
            )
          : own.map((o) => o.value);
      sum[item.code] = values
        .reduce((total, v) => total.plus(v), new Dec(0))
        .toFixed();
      continue;
    }
    const distinct = [...new Set(own.map((o) => o.value))];
    if (distinct.length === 1) sum[item.code] = distinct[0]!;
    else if (item.dataType === "text")
      sum[item.code] = own.map((o) => `${o.name}: ${o.value}`).join("\n");
  }
  const changes = new Map<string, { delta: Amount; parts: FinancingPart[] }>();
  for (const e of eliminations) {
    const change = changes.get(e.item) ?? { delta: new Dec(0), parts: [] };
    change.delta = change.delta.plus(e.amount);
    change.parts.push({ id: e.id, name: e.name, value: e.amount });
    changes.set(e.item, change);
  }
  return addToItems(items, sum, changes).entered;
}

// How eliminations leave the balance sheet out of balance: "Eliminations
// change assets by -400,000 but liabilities and equity by -350,000", or null.
export function eliminationImbalance(
  eliminations: readonly Pick<Elimination, "item" | "amount">[],
  items: readonly ScoringItem[],
): string | null {
  const sides = balanceSheetSides(items);
  const changes = { assets: new Dec(0), claims: new Dec(0) };
  for (const e of eliminations) {
    const side = sides.get(e.item);
    if (side) changes[side] = changes[side].plus(e.amount);
  }
  if (changes.assets.minus(changes.claims).abs().lte(TOLERANCE)) return null;
  return `Eliminations change assets by ${dollars(changes.assets)} but liabilities and equity by ${dollars(changes.claims)}`;
}

interface Chosen {
  member: { id: string; name: string };
  period: StatementPeriod;
  spread: Spread;
}

// What to look at in a consolidated period before relying on it: missing or
// broken member statements, statements far from its end or of another
// length, figures that may count twice, and eliminations that don't balance.
function consolidationIssues(
  period: StatementPeriod,
  chosen: readonly Chosen[],
  memberList: readonly { id: string; name: string }[],
  // Every consolidated period of the client, with the member periods it uses.
  usage: readonly { period: StatementPeriod; memberPeriodIds: string[] }[],
  items: readonly ScoringItem[],
): Issue[] {
  const issues: Issue[] = [];
  const flag = (severity: Issue["severity"], code: string, message: string) =>
    issues.push({ severity, code, message });
  if (!chosen.length)
    flag(
      "error",
      "no_statements",
      "Choose the members' statements this period adds up.",
    );
  for (const member of memberList)
    if (!chosen.some((c) => c.member.id === member.id))
      flag(
        "warning",
        "member_missing",
        `No statements from ${member.name} in this period.`,
      );
  for (const { member, period: p, spread } of chosen) {
    const gap = monthIndex(p.periodEnd) - monthIndex(period.periodEnd);
    if (Math.abs(gap) > MAX_GAP_MONTHS)
      flag(
        "warning",
        "statement_gap",
        `${member.name}'s statements end ${p.periodEnd}, ${Math.abs(gap)} months ${gap > 0 ? "after" : "before"} the period's end.`,
      );
    if (p.months !== period.months)
      flag(
        "warning",
        "statement_length",
        `${member.name}'s statements cover ${p.months} months; the period covers ${period.months}.`,
      );
    if (p.consolidated)
      flag(
        "warning",
        "already_consolidated",
        `${member.name}'s statements ending ${p.periodEnd} are already consolidated: if they include another member, its figures count twice.`,
      );
    for (const other of usage)
      if (other.period.id !== period.id && other.memberPeriodIds.includes(p.id))
        flag(
          "warning",
          "statement_reused",
          `${member.name}'s statements ending ${p.periodEnd} are also in the period ending ${other.period.periodEnd}: their figures count in both.`,
        );
    for (const issue of spread.checks[p.id] ?? [])
      if (issue.severity === "error")
        flag(
          "error",
          "member_error",
          `${member.name}, ${p.periodEnd}: ${issue.message}`,
        );
  }
  const projected = chosen.filter((c) => c.period.quality === "projected");
  if (projected.length && projected.length < chosen.length)
    flag(
      "warning",
      "projection_mix",
      "The period adds up the client's projections with actual statements.",
    );
  const currencies = [...new Set(chosen.map((c) => c.period.currency))];
  if (currencies.length > 1)
    flag(
      "warning",
      "currency_mix",
      `The statements are in ${currencies.join(" and ")}; their figures are added as they are.`,
    );
  const off = eliminationImbalance(period.eliminations, items);
  if (off)
    flag(
      "error",
      "eliminations_balance",
      `${off}, so the balance sheet can't balance.`,
    );
  return issues;
}

// The members, in order, of a consolidated client.
export async function memberRows(db: Db, entityId: string) {
  return db
    .select({
      id: entities.id,
      name: entities.name,
      debtSchedule: entities.debtSchedule,
    })
    .from(members)
    .innerJoin(entities, eq(entities.id, members.memberId))
    .where(eq(members.entityId, entityId))
    .orderBy(asc(members.position));
}

// A consolidated client's spread, laid out as a borrower's: its periods, the
// figures they add up to with eliminations, and their checks, plus what each
// is made of. Its periods' quality and currency are its statements'.
export async function consolidatedSpread(
  db: Db,
  ctx: Context,
  entity: Entity,
): Promise<Spread> {
  const memberList = await memberRows(db, entity.id);
  const memberSpreads = new Map<string, Spread>();
  for (const member of memberList)
    memberSpreads.set(member.id, await getSpread(db, ctx, member.id));
  const list = await db
    .select()
    .from(periods)
    .where(eq(periods.entityId, entity.id))
    .orderBy(asc(periods.periodEnd), asc(periods.months));
  const rows = list.length
    ? await db
        .select()
        .from(links)
        .where(
          inArray(
            links.periodId,
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
  ]))
    itemsByVersion.set(versionId, await listItems(db, ctx, versionId));

  const chosenOf = (period: StatementPeriod): Chosen[] =>
    memberList.flatMap((member) => {
      const link = rows.find(
        (r) => r.periodId === period.id && r.memberId === member.id,
      );
      const spread = memberSpreads.get(member.id)!;
      const p =
        link && spread.periods.find((p) => p.id === link.memberPeriodId);
      return p ? [{ member, period: p, spread }] : [];
    });
  const usage = list.map((period) => ({
    period,
    memberPeriodIds: rows
      .filter((r) => r.periodId === period.id)
      .map((r) => r.memberPeriodId),
  }));

  const derived = list.map((period) => {
    const chosen = chosenOf(period);
    const currencies = [...new Set(chosen.map((c) => c.period.currency))];
    return {
      ...period,
      quality: chosen.length
        ? weakest(chosen.map((c) => c.period.quality))
        : period.quality,
      currency: currencies.length === 1 ? currencies[0]! : period.currency,
    };
  });
  const spread: Spread = {
    entity,
    periods: derived,
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
    consolidation: {
      members: memberList.map((member) => ({
        id: member.id,
        name: member.name,
        periods: memberSpreads
          .get(member.id)!
          .periods.map(
            ({ id, periodEnd, months, quality, currency, consolidated }) => ({
              id,
              periodEnd,
              months,
              quality,
              currency,
              consolidated,
            }),
          ),
        debtSchedule: member.debtSchedule,
      })),
      periods: {},
    },
  };
  const figures = new Map<string, Map<string, string>>();
  for (const period of derived) {
    const items = itemsByVersion.get(period.scoringModelVersionId)!;
    const chosen = chosenOf(period);
    const statements = chosen.map((c) => ({
      name: c.member.name,
      entered: c.spread.values[c.period.id] ?? {},
      computed: c.spread.computed[c.period.id] ?? {},
    }));
    const entered = new Map(
      Object.entries(
        consolidateFigures(items, statements, period.eliminations),
      ),
    );
    figures.set(period.id, entered);
    spread.values[period.id] = Object.fromEntries(entered);
    spread.computed[period.id] = Object.fromEntries(
      [...effectiveAmounts(items, entered).computed].map(([code, value]) => [
        code,
        value.toFixed(),
      ]),
    );
    spread.consolidation!.periods[period.id] = {
      statements: chosen.map(({ member, period: p }, i) => ({
        memberId: member.id,
        periodId: p.id,
        periodEnd: p.periodEnd,
        months: p.months,
        quality: p.quality,
        currency: p.currency,
        consolidated: p.consolidated,
        figures: { ...statements[i]!.computed, ...statements[i]!.entered },
      })),
      eliminations: period.eliminations,
      memberReconciliation: chosen.flatMap(({ member, period: p }) =>
        p.reconciliation.map((line) => ({
          memberId: member.id,
          label: `${member.name}: ${line.label}`,
          amount: line.amount,
        })),
      ),
    };
  }
  // Checked once every period is added up, as retained earnings roll
  // forward from the period before. There's no net income as printed to
  // check: each member's statements are checked against their own.
  for (const period of derived) {
    const items = itemsByVersion.get(period.scoringModelVersionId)!;
    const entered = figures.get(period.id)!;
    const previous = previousPeriod(period, derived);
    spread.checks[period.id] = [
      ...consolidationIssues(
        period,
        chosenOf(period),
        memberList,
        usage,
        items,
      ),
      ...checkPeriod(items, entered),
      ...checkControls(items, entered, {
        items: checkItems,
        reportedNetIncome: null,
        reconciliation: [
          ...spread.consolidation!.periods[period.id]!.memberReconciliation,
          ...period.reconciliation,
        ],
        previous: previous && {
          end: previous.periodEnd,
          items: itemsByVersion.get(previous.scoringModelVersionId)!,
          entered: figures.get(previous.id)!,
        },
      }),
    ];
  }
  await addLineLimitChecks(
    db,
    spread,
    memberList.map((m) => m.id),
  );
  return spread;
}

async function findConsolidated(
  db: Db,
  ctx: Context,
  entityId: string,
): Promise<Entity> {
  const entity = await getEntity(db, ctx, entityId);
  if (entity.kind !== "consolidated")
    throw invalid(`${entity.name} isn't a consolidated client.`);
  return entity;
}

async function findConsolidatedPeriod(db: Db, ctx: Context, periodId: string) {
  const { period, entity } = await findPeriod(db, ctx, periodId);
  if (entity.kind !== "consolidated")
    throw invalid("That period isn't a consolidated client's.");
  return { period, entity: await getEntity(db, ctx, entity.id) };
}

export interface ConsolidatedClientInput extends EntityInput {
  // The borrowers it adds up, in order.
  memberIds?: readonly string[];
}

export async function createConsolidatedClient(
  db: Db,
  ctx: Context,
  input: ConsolidatedClientInput,
): Promise<Entity> {
  const { memberIds = [], ...fields } = input;
  return db.transaction(async (tx) => {
    const entity = await createEntity(tx, ctx, {
      ...fields,
      kind: "consolidated",
    });
    for (const memberId of memberIds)
      await addConsolidationMember(tx, ctx, entity.id, memberId);
    return entity;
  });
}

// Adds a borrower on the client's scoring model, last. Its statements then
// need choosing in each period.
export async function addConsolidationMember(
  db: Db,
  ctx: Context,
  entityId: string,
  memberId: string,
): Promise<void> {
  const entity = await findConsolidated(db, ctx, entityId);
  const member = await getEntity(db, ctx, memberId);
  if (member.kind !== "borrower")
    throw invalid(
      `${member.name} is a consolidated client itself: add its members instead.`,
    );
  if (member.scoringModelId !== entity.scoringModelId)
    throw invalid(
      `${member.name} follows another scoring model than ${entity.name}.`,
    );
  const current = await db
    .select()
    .from(members)
    .where(eq(members.entityId, entityId));
  if (current.some((m) => m.memberId === memberId))
    throw new DomainError(
      "conflict",
      `${member.name} is already a member of ${entity.name}.`,
    );
  await db.insert(members).values({
    entityId,
    memberId,
    position: Math.max(-1, ...current.map((m) => m.position)) + 1,
  });
}

// Removes a member and its statements from every period. It stays a
// borrower.
export async function removeConsolidationMember(
  db: Db,
  ctx: Context,
  entityId: string,
  memberId: string,
): Promise<void> {
  await findConsolidated(db, ctx, entityId);
  if (!UUID.test(memberId))
    throw new DomainError("not_found", "No such member.");
  await db.transaction(async (tx) => {
    const own = tx
      .select({ id: periods.id })
      .from(periods)
      .where(eq(periods.entityId, entityId));
    const affected = await tx
      .delete(links)
      .where(and(eq(links.memberId, memberId), inArray(links.periodId, own)))
      .returning({ periodId: links.periodId });
    const removed = await tx
      .delete(members)
      .where(
        and(eq(members.entityId, entityId), eq(members.memberId, memberId)),
      )
      .returning();
    if (!removed.length) throw new DomainError("not_found", "No such member.");
    await syncPeriods(
      tx,
      affected.map((a) => a.periodId),
    );
    // The group's analyses forget the member's lines of credit.
    await forgetLines(tx, entityId, (key) => key.startsWith(`${memberId}/`));
  });
}

// The member periods a consolidated period adds up, checked: each a
// member's own, one per member, and all entered against one version of the
// scoring model, so their figures share item codes.
async function resolveStatements(
  db: Db,
  entity: Entity,
  statements: readonly { memberId: string; periodId: string }[],
) {
  if (!statements.length)
    throw invalid("Choose at least one member's statements.");
  const ids = statements.map((s) => s.memberId);
  if (new Set(ids).size !== ids.length)
    throw invalid("Choose one set of statements per member.");
  const memberList = await memberRows(db, entity.id);
  if (!statements.every((s) => UUID.test(s.periodId)))
    throw invalid("Unknown period.");
  const found = await db
    .select({ period: periods, version: scoringModelVersions.number })
    .from(periods)
    .innerJoin(
      scoringModelVersions,
      eq(scoringModelVersions.id, periods.scoringModelVersionId),
    )
    .where(
      inArray(
        periods.id,
        statements.map((s) => s.periodId),
      ),
    );
  const resolved = statements.map((s) => {
    const member = memberList.find((m) => m.id === s.memberId);
    if (!member)
      throw invalid(`Choose statements of ${entity.name}'s members.`);
    const row = found.find((f) => f.period.id === s.periodId);
    if (!row || row.period.entityId !== member.id)
      throw invalid(`That period isn't one of ${member.name}'s.`);
    return { member, ...row };
  });
  const versions = [...new Set(resolved.map((r) => r.version))];
  if (versions.length > 1)
    throw invalid(
      `The statements are entered against different versions of the scoring model (${resolved.map((r) => `${r.member.name}: v${r.version}`).join(", ")}). Choose statements on the same version.`,
    );
  return resolved;
}

// What a consolidated period takes from its statements: the weakest
// quality, their currency when they share one, and their scoring model
// version.
function derivedFields(
  resolved: readonly { period: StatementPeriod }[],
): Pick<StatementPeriod, "quality" | "scoringModelVersionId"> &
  Partial<Pick<StatementPeriod, "currency">> {
  const currencies = [...new Set(resolved.map((r) => r.period.currency))];
  return {
    quality: weakest(resolved.map((r) => r.period.quality)),
    scoringModelVersionId: resolved[0]!.period.scoringModelVersionId,
    ...(currencies.length === 1 ? { currency: currencies[0] } : {}),
  };
}

// Keeps consolidated periods' stored quality and currency with their
// statements', for listings that read them from the table.
export async function syncPeriods(db: Db, periodIds: readonly string[]) {
  for (const periodId of new Set(periodIds)) {
    const used = await db
      .select({ period: periods })
      .from(links)
      .innerJoin(periods, eq(periods.id, links.memberPeriodId))
      .where(eq(links.periodId, periodId));
    if (!used.length) continue;
    await db
      .update(periods)
      .set(derivedFields(used))
      .where(eq(periods.id, periodId));
  }
}

// The consolidated periods using a member's period.
export async function consolidatedPeriodsUsing(db: Db, memberPeriodId: string) {
  return db
    .select({
      periodId: links.periodId,
      periodEnd: periods.periodEnd,
      client: entities.name,
    })
    .from(links)
    .innerJoin(periods, eq(periods.id, links.periodId))
    .innerJoin(entities, eq(entities.id, periods.entityId))
    .where(eq(links.memberPeriodId, memberPeriodId));
}

// The consolidated clients a borrower is a member of, by name.
export async function consolidatedClientsOf(db: Db, memberId: string) {
  const rows = await db
    .select({ name: entities.name })
    .from(members)
    .innerJoin(entities, eq(entities.id, members.entityId))
    .where(eq(members.memberId, memberId));
  return rows.map((r) => r.name);
}

export interface ConsolidatedPeriodInput {
  periodEnd: string;
  months: number;
  // The members' statements it adds up, one period per member.
  statements: readonly { memberId: string; periodId: string }[];
}

export async function addConsolidatedPeriod(
  db: Db,
  ctx: Context,
  entityId: string,
  input: ConsolidatedPeriodInput,
): Promise<StatementPeriod> {
  const entity = await findConsolidated(db, ctx, entityId);
  checkPeriodInput(input);
  return db.transaction(async (tx) => {
    const resolved = await resolveStatements(tx, entity, input.statements);
    if (await findDuplicate(tx, entityId, input.periodEnd, input.months))
      throw new DomainError(
        "conflict",
        `${entity.name} already has a ${input.months}-month period ending ${input.periodEnd}.`,
      );
    const [period] = await tx
      .insert(periods)
      .values({
        entityId,
        periodEnd: input.periodEnd,
        months: input.months,
        consolidated: true,
        currency: "CAD",
        ...derivedFields(resolved),
      })
      .returning();
    await tx.insert(links).values(
      resolved.map((r) => ({
        periodId: period!.id,
        memberId: r.member.id,
        memberPeriodId: r.period.id,
      })),
    );
    return period!;
  });
}

// Changes which statements a consolidated period adds up: each member given
// gets the period given, or none when null; the others keep theirs.
export async function setConsolidatedStatements(
  db: Db,
  ctx: Context,
  periodId: string,
  changes: readonly { memberId: string; periodId: string | null }[],
): Promise<StatementPeriod> {
  const { period, entity } = await findConsolidatedPeriod(db, ctx, periodId);
  const current = await db
    .select()
    .from(links)
    .where(eq(links.periodId, periodId));
  const next = new Map(current.map((l) => [l.memberId, l.memberPeriodId]));
  for (const change of changes) {
    if (change.periodId) next.set(change.memberId, change.periodId);
    else next.delete(change.memberId);
  }
  return db.transaction(async (tx) => {
    const resolved = await resolveStatements(
      tx,
      entity,
      [...next].map(([memberId, periodId]) => ({ memberId, periodId })),
    );
    if (
      period.eliminations.length &&
      resolved[0]!.period.scoringModelVersionId !== period.scoringModelVersionId
    ) {
      const items = await listItems(
        tx,
        ctx,
        resolved[0]!.period.scoringModelVersionId,
      );
      normalizeEliminations(period.eliminations, items);
    }
    await tx.delete(links).where(eq(links.periodId, periodId));
    await tx.insert(links).values(
      resolved.map((r) => ({
        periodId,
        memberId: r.member.id,
        memberPeriodId: r.period.id,
      })),
    );
    const [updated] = await tx
      .update(periods)
      .set(derivedFields(resolved))
      .where(eq(periods.id, periodId))
      .returning();
    return updated!;
  });
}

// An elimination as typed: its amount as text, negative to reduce the item.
export interface EliminationInput {
  id?: unknown;
  name?: unknown;
  item?: unknown;
  amount?: unknown;
}

const MAX_ELIMINATIONS = 100;

// Eliminations change input amounts of any statement.
export const eliminable = (items: readonly ScoringItem[]) =>
  items.filter((i) => i.kind === "input" && i.dataType === "amount");

function normalizeEliminations(
  input: readonly EliminationInput[],
  items: readonly ScoringItem[],
): Elimination[] {
  if (!Array.isArray(input) || input.length > MAX_ELIMINATIONS)
    throw invalid(
      `Eliminations are a list of up to ${MAX_ELIMINATIONS} entries.`,
    );
  const allowed = new Set(eliminable(items).map((i) => i.code));
  return input.map((e, i) => {
    const name = String(e?.name ?? "").trim();
    if (!name) throw invalid(`Elimination ${i + 1}: give it a name.`);
    const item = String(e.item ?? "");
    if (!allowed.has(item))
      throw invalid(
        `${name}: choose the item it changes, an input amount of the scoring model.`,
      );
    const parsed = parseValue(String(e.amount ?? ""), "amount");
    if ("error" in parsed) throw invalid(`${name}: ${parsed.error}`);
    if (parsed.value === null || new Dec(parsed.value).isZero())
      throw invalid(`${name}: enter the amount, negative to reduce.`);
    return { id: entryId(e.id), name, item, amount: parsed.value };
  });
}

// Replaces a consolidated period's eliminations. Those on the balance sheet
// may be out of balance in between; the period's checks say so.
export async function setEliminations(
  db: Db,
  ctx: Context,
  periodId: string,
  input: readonly EliminationInput[],
): Promise<StatementPeriod> {
  const { period } = await findConsolidatedPeriod(db, ctx, periodId);
  const items = await listItems(db, ctx, period.scoringModelVersionId);
  const [updated] = await db
    .update(periods)
    .set({ eliminations: normalizeEliminations(input, items) })
    .where(eq(periods.id, periodId))
    .returning();
  return updated!;
}

// Replaces the eliminations on one item, keeping the period's others, as the
// worksheet edits them a cell at a time. An entry with no amount, or zero,
// is dropped; one with no name is named after its item.
export async function setItemEliminations(
  db: Db,
  ctx: Context,
  periodId: string,
  item: string,
  entries: readonly Omit<EliminationInput, "item">[],
): Promise<StatementPeriod> {
  const { period } = await findConsolidatedPeriod(db, ctx, periodId);
  const items = await listItems(db, ctx, period.scoringModelVersionId);
  const target = eliminable(items).find((i) => i.code === item);
  if (!target)
    throw invalid(
      "Eliminations change an input amount of the scoring model, not a total.",
    );
  const given = entries
    .filter((e) => {
      const parsed = parseValue(String(e.amount ?? ""), "amount");
      return (
        "error" in parsed ||
        (parsed.value !== null && !new Dec(parsed.value).isZero())
      );
    })
    .map((e) => ({
      ...e,
      item,
      name:
        String(e.name ?? "").trim() ||
        `Intercompany ${target.label.toLowerCase()}`,
    }));
  // In place of the item's first, so the list keeps its order.
  const first = period.eliminations.findIndex((e) => e.item === item);
  const others = period.eliminations.filter((e) => e.item !== item);
  const at = first === -1 ? others.length : first;
  return setEliminations(db, ctx, periodId, [
    ...others.slice(0, at),
    ...given,
    ...others.slice(at),
  ]);
}

const noElimination = () =>
  new DomainError("not_found", "The period has no such elimination.");

// Eliminations an entry at a time, as an AI client asks for them.
export async function addElimination(
  db: Db,
  ctx: Context,
  periodId: string,
  input: EliminationInput,
): Promise<{ period: StatementPeriod; elimination: Elimination }> {
  const { period } = await findConsolidatedPeriod(db, ctx, periodId);
  const id = entryId(undefined);
  const updated = await setEliminations(db, ctx, periodId, [
    ...period.eliminations,
    { ...input, id },
  ]);
  return {
    period: updated,
    elimination: updated.eliminations.find((e) => e.id === id)!,
  };
}

// Changes some of an elimination's fields; the others stay.
export async function updateElimination(
  db: Db,
  ctx: Context,
  periodId: string,
  eliminationId: string,
  patch: EliminationInput,
): Promise<{ period: StatementPeriod; elimination: Elimination }> {
  const { period } = await findConsolidatedPeriod(db, ctx, periodId);
  if (!period.eliminations.some((e) => e.id === eliminationId))
    throw noElimination();
  const { id: _, ...fields } = patch;
  const defined = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  );
  const updated = await setEliminations(
    db,
    ctx,
    periodId,
    period.eliminations.map((e) =>
      e.id === eliminationId ? { ...e, ...defined } : e,
    ),
  );
  return {
    period: updated,
    elimination: updated.eliminations.find((e) => e.id === eliminationId)!,
  };
}

export async function removeElimination(
  db: Db,
  ctx: Context,
  periodId: string,
  eliminationId: string,
): Promise<StatementPeriod> {
  const { period } = await findConsolidatedPeriod(db, ctx, periodId);
  if (!period.eliminations.some((e) => e.id === eliminationId))
    throw noElimination();
  return setEliminations(
    db,
    ctx,
    periodId,
    period.eliminations.filter((e) => e.id !== eliminationId),
  );
}

// Existing loans as an entity's analyses read them.
export interface OwnedDebtSchedule {
  // For a consolidated client, the member whose loans these are; null for a
  // borrower's own.
  member: { id: string; name: string } | null;
  schedule: DebtSchedule;
}

// A borrower's debt schedule, or each member's for a consolidated client,
// each as of its own date. Members' loans are named and keyed with the
// member, so loans of the same name stay apart.
export async function getDebtSchedules(
  db: Db,
  ctx: Context,
  entityId: string,
): Promise<OwnedDebtSchedule[]> {
  const entity = await getEntity(db, ctx, entityId);
  if (entity.kind !== "consolidated")
    return [{ member: null, schedule: entity.debtSchedule }];
  return (await memberRows(db, entity.id)).map((member) => ({
    member: { id: member.id, name: member.name },
    schedule: {
      asOf: member.debtSchedule.asOf,
      loans: member.debtSchedule.loans.map((loan) => ({
        ...loan,
        id: `${member.id}/${loan.id}`,
        name: `${loan.name} (${member.name})`,
      })),
    },
  }));
}
