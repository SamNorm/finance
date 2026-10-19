import { randomUUID } from "node:crypto";
import { asc, eq, schema, type Db } from "@finance/db";
import { Dec } from "@finance/engine";
import { getAnalysis } from "../analyses/service";
import type { Context } from "../context";
import { DomainError, type Issue } from "../errors";
import { parseMonth } from "../credit-lines/terms";
import { getEntity } from "../spreads/service";
import { parseValue } from "../spreads/values";
import {
  GROUP_TOTALS,
  OVERRIDE_TOTALS,
  type GroupSummed,
  type GroupTotal,
  type GroupTotals,
} from "./constants";
import type { BorrowingBaseDefinition, CollateralType } from "./definition";
import { marginedLines } from "./lines";
import { runAnalysisBorrowingBases } from "./projection";
import { runBorrowingBase, type BorrowingBaseRun } from "./run";
import { monthsOf } from "./service";

// A consolidated client's borrowing base (borrowing-base-plan.md §7.5): its
// members' margined lines, each computed on its own terms, added up month
// by month as totals (members' lines differ, so their codes don't add up),
// adjusted by named amounts as eliminations adjust a consolidated spread,
// or replaced by the totals of a certificate the client sends for the
// group.

const SUMMED: GroupSummed[] = [
  ...GROUP_TOTALS.map((t) => t.key),
  "total",
  "available",
];

// The figures a month's totals give, as a line's waterfall does.
export interface GroupFigures extends GroupTotals {
  gross: string | null;
  usage: string | null;
  surplus: string | null;
  excess: string | null;
  utilization: string | null;
}

export interface GroupAdjustment {
  id: string;
  name: string;
  total: GroupTotal;
  amount: string;
}

export interface GroupMonth {
  month: string;
  projected: boolean;
  // Each member line's totals, by its key; null without a certificate.
  members: Record<string, GroupTotals | null>;
  sum: GroupFigures;
  adjustments: GroupAdjustment[];
  // The sum with the adjustments.
  adjusted: GroupFigures;
  // A group certificate's totals, when one was entered.
  override: Partial<Record<GroupSummed, string>> | null;
  // The month's figures: the override's totals where given, or else the
  // adjusted sum's.
  consolidated: GroupFigures;
  note: string | null;
  issues: Issue[];
}

const dec = (raw: string | null | undefined) =>
  raw === null || raw === undefined ? null : new Dec(raw);

// A line's totals in each month of its run: margined collateral by type
// (a group's under its own type, after its cap), prior claims, reserves,
// its borrowing base and availability, the limit, the balance and other
// usage. Null in a month without a certificate, unless projected.
export function lineTotals(
  definition: BorrowingBaseDefinition,
  run: BorrowingBaseRun,
): (GroupTotals | null)[] {
  const margined: Record<CollateralType, string[]> = {
    receivables: [],
    inventory: [],
    other: [],
  };
  for (const line of definition.lines) {
    if (line.kind === "group")
      margined[line.collateral].push(`${line.code}.MARGINED`);
    if (line.kind === "collateral" && !line.group)
      margined[line.collateral].push(`${line.code}.MARGINED`);
  }
  return run.months.map((m, p) => {
    if (!m.quality && !m.projected) return null;
    const at = (code: string) => dec(run.cells[code]?.[p]?.value);
    const add = (codes: string[]) =>
      codes
        .reduce((sum, code) => sum.plus(at(code) ?? 0), new Dec(0))
        .toFixed();
    const usage = at("BB_USAGE");
    const outstanding = at("BB_OUTSTANDING");
    return {
      receivables: add(margined.receivables),
      inventory: add(margined.inventory),
      otherCollateral: add(margined.other),
      priorClaims: at("BB_PRIOR_CLAIMS")?.toFixed() ?? null,
      reserves: at("BB_RESERVES")?.toFixed() ?? null,
      total: at("BB_TOTAL")?.toFixed() ?? null,
      available: at("BB_AVAILABLE")?.toFixed() ?? null,
      limit: at("BB_LIMIT")?.toFixed() ?? null,
      outstanding: outstanding?.toFixed() ?? null,
      otherUsage:
        usage && outstanding ? usage.minus(outstanding).toFixed() : null,
    };
  });
}

// The figures totals give: the gross borrowing base for reference; usage,
// the surplus and excess, and utilization from the borrowing base and
// availability summed (or adjusted, or certified).
export function deriveFigures(totals: GroupTotals): GroupFigures {
  const t = (key: GroupSummed) => dec(totals[key]) ?? new Dec(0);
  const gross = t("receivables")
    .plus(t("inventory"))
    .plus(t("otherCollateral"));
  const usage = t("outstanding").plus(t("otherUsage"));
  const limit = t("limit");
  return {
    ...totals,
    gross: gross.toFixed(),
    usage: usage.toFixed(),
    surplus: t("total").minus(usage).toFixed(),
    excess: t("available").minus(usage).toFixed(),
    utilization: limit.isZero() ? null : usage.div(limit).toFixed(),
  };
}

// Adjustments carry through: collateral adds to the borrowing base and
// availability, prior claims and reserves take from them; neither goes
// below zero, nor availability above the limit.
function adjust(sum: GroupTotals, adjustments: GroupAdjustment[]) {
  const result = { ...sum };
  const plus = (key: GroupSummed, amount: InstanceType<typeof Dec>) => {
    result[key] = new Dec(result[key] ?? 0).plus(amount).toFixed();
  };
  for (const a of adjustments) {
    const amount = new Dec(a.amount);
    plus(a.total, amount);
    if (["receivables", "inventory", "otherCollateral"].includes(a.total)) {
      plus("total", amount);
      plus("available", amount);
    }
    if (a.total === "priorClaims" || a.total === "reserves") {
      plus("total", amount.neg());
      plus("available", amount.neg());
    }
  }
  return bounded(result);
}

const bounded = (totals: GroupTotals): GroupTotals => {
  const total = Dec.max(0, dec(totals.total) ?? 0);
  const available = Dec.max(
    0,
    Dec.min(dec(totals.available) ?? total, total, dec(totals.limit) ?? total),
  );
  return { ...totals, total: total.toFixed(), available: available.toFixed() };
};

// A group certificate's totals over the adjusted sum. Given components but
// no borrowing base, the borrowing base follows from them.
function certified(
  adjusted: GroupTotals,
  override: Partial<Record<GroupSummed, string>>,
): GroupTotals {
  const merged = { ...adjusted, ...override };
  if (override.total === undefined) {
    const t = (key: GroupSummed) => dec(merged[key]) ?? new Dec(0);
    merged.total = t("receivables")
      .plus(t("inventory"))
      .plus(t("otherCollateral"))
      .minus(t("priorClaims"))
      .minus(t("reserves"))
      .toFixed();
  }
  // Availability follows from the certified borrowing base and limits.
  return bounded({ ...merged, available: null });
}

const empty = (): GroupTotals =>
  Object.fromEntries(SUMMED.map((key) => [key, null])) as GroupTotals;

export function groupWorksheet(
  members: readonly {
    key: string;
    name: string;
    currency: string;
    definition: BorrowingBaseDefinition;
    run: BorrowingBaseRun;
    // The last month it counts, when its line closed.
    until?: string | null;
  }[],
  stored: ReadonlyMap<
    string,
    {
      adjustments: GroupAdjustment[];
      override: Partial<Record<GroupSummed, string>> | null;
      note: string | null;
    }
  >,
): GroupMonth[] {
  const byMember = members.map((m) => {
    const totals = lineTotals(m.definition, m.run);
    return {
      ...m,
      at: new Map(
        m.run.months.map((month, p) => [
          month.month,
          { totals: totals[p] ?? null, projected: month.projected },
        ]),
      ),
    };
  });
  const months = [
    ...new Set([
      ...byMember.flatMap((m) =>
        [...m.at.entries()].filter(([, v]) => v.totals).map(([month]) => month),
      ),
      ...stored.keys(),
    ]),
  ].sort();
  return months.map((month) => {
    const issues: Issue[] = [];
    const sum = empty();
    const memberTotals: GroupMonth["members"] = {};
    let projected = false;
    for (const m of byMember) {
      // A line closed before the month no longer counts.
      if (m.until && month > m.until) continue;
      const own = m.at.get(month);
      memberTotals[m.key] = own?.totals ?? null;
      projected ||= own?.projected ?? false;
      if (!own?.totals) {
        issues.push({
          severity: "warning",
          code: "member_missing",
          message: `No certificate for ${m.name} in ${month}: the group's figures leave it out.`,
        });
        continue;
      }
      for (const key of SUMMED) {
        const value = own.totals[key];
        if (value !== null)
          sum[key] = new Dec(sum[key] ?? 0).plus(value).toFixed();
      }
    }
    const saved = stored.get(month);
    const adjustments = saved?.adjustments ?? [];
    const adjusted = adjust(sum, adjustments);
    const override = saved?.override ?? null;
    const consolidated = override ? certified(adjusted, override) : adjusted;
    if (
      override?.limit !== undefined &&
      sum.limit !== null &&
      !new Dec(override.limit).eq(sum.limit)
    )
      issues.push({
        severity: "warning",
        code: "override_limit",
        message: `The group certificate for ${month} gives limits of ${override.limit}, but the members' lines add up to ${sum.limit}.`,
      });
    return {
      month,
      projected,
      members: memberTotals,
      sum: deriveFigures(sum),
      adjustments,
      adjusted: deriveFigures(adjusted),
      override,
      consolidated: deriveFigures(consolidated),
      note: saved?.note ?? null,
      issues,
    };
  });
}

// Members' lines in more than one currency are added as they are, which
// the group's figures should say.
export function currencyIssues(
  members: readonly { name: string; currency: string }[],
): Issue[] {
  const currencies = [...new Set(members.map((m) => m.currency))];
  return currencies.length > 1
    ? [
        {
          severity: "warning",
          code: "currency_mix",
          message: `The members' lines are in ${currencies.join(" and ")}; the group adds their figures as they are, unconverted.`,
        },
      ]
    : [];
}

const { groupBorrowingBaseMonths: groupMonths } = schema;

async function consolidated(db: Db, ctx: Context, entityId: string) {
  const entity = await getEntity(db, ctx, entityId);
  if (entity.kind !== "consolidated")
    throw new DomainError(
      "invalid",
      `${entity.name} isn't a consolidated client: its borrowing bases are its own lines'.`,
    );
  return entity;
}

async function storedMonths(db: Db, entityId: string) {
  const rows = await db
    .select()
    .from(groupMonths)
    .where(eq(groupMonths.entityId, entityId))
    .orderBy(asc(groupMonths.month));
  return new Map(
    rows.map((r) => [
      r.month,
      { adjustments: r.adjustments, override: r.override, note: r.note },
    ]),
  );
}

export interface GroupBorrowingBase {
  entity: { id: string; name: string };
  members: {
    key: string;
    name: string;
    member: { id: string; name: string };
    lineId: string;
  }[];
  months: GroupMonth[];
  // About the group as a whole, such as members' lines in other currencies.
  issues: Issue[];
}

// A consolidated client's history: its members' margined lines added up.
export async function getGroupBorrowingBase(
  db: Db,
  ctx: Context,
  entityId: string,
): Promise<GroupBorrowingBase> {
  const entity = await consolidated(db, ctx, entityId);
  const lines = await marginedLines(db, ctx, entityId);
  const histories = await monthsOf(
    db,
    lines.map((l) => l.line.id),
  );
  const members = lines.map(({ key, line, member }) => ({
    key,
    name: `${line.name} (${member!.name})`,
    member: member!,
    lineId: line.id,
    currency: line.currency,
    until: line.closedOn?.slice(0, 7) ?? null,
    definition: line.borrowingBase!,
    run: runBorrowingBase({
      definition: line.borrowingBase!,
      line: { currency: line.currency, limit: line.limit },
      months: histories.get(line.id) ?? [],
    }),
  }));
  return {
    entity: { id: entity.id, name: entity.name },
    members: members.map(({ key, name, member, lineId }) => ({
      key,
      name,
      member,
      lineId,
    })),
    months: groupWorksheet(members, await storedMonths(db, entityId)),
    issues: currencyIssues(members),
  };
}

// The group as an analysis projects it: its members' projected lines added
// up, the month's adjustments and overrides applying to its history.
export async function runAnalysisGroupBorrowingBase(
  db: Db,
  ctx: Context,
  analysisId: string,
  scenarioId?: string | null,
): Promise<{ months: GroupMonth[]; issues: Issue[] } | null> {
  const { entity } = await getAnalysis(db, ctx, analysisId);
  const lines = await runAnalysisBorrowingBases(
    db,
    ctx,
    analysisId,
    scenarioId,
  );
  const members = lines
    .filter((l) => l.member)
    .map((l) => ({
      key: l.key,
      name: l.name,
      currency: l.currency,
      until: l.until,
      definition: l.definition,
      run: l.run,
    }));
  if (!members.length) return null;
  return {
    months: groupWorksheet(members, await storedMonths(db, entity.id)),
    issues: currencyIssues(members),
  };
}

async function saveMonth(
  db: Db,
  entityId: string,
  month: string,
  set: Partial<typeof groupMonths.$inferInsert>,
) {
  await db
    .insert(groupMonths)
    .values({ entityId, month, ...set })
    .onConflictDoUpdate({
      target: [groupMonths.entityId, groupMonths.month],
      set,
    });
}

const TOTAL_KEYS = new Set<string>(GROUP_TOTALS.map((t) => t.key));
const OVERRIDE_KEYS = new Set<string>(OVERRIDE_TOTALS.map((t) => t.key));

function amountOf(raw: unknown, what: string) {
  const parsed = parseValue(String(raw ?? ""), "amount");
  if ("error" in parsed)
    throw new DomainError("invalid", `${what}: ${parsed.error}`);
  return parsed.value;
}

// Replaces a month's adjustments: named amounts, negative to reduce, each
// added to one of the group's totals, such as intercompany receivables out
// of margined receivables.
export async function setGroupBorrowingBaseAdjustments(
  db: Db,
  ctx: Context,
  entityId: string,
  rawMonth: string,
  adjustments: readonly {
    id?: unknown;
    name?: unknown;
    total?: unknown;
    amount?: unknown;
  }[],
): Promise<GroupMonth> {
  const entity = await consolidated(db, ctx, entityId);
  const month = parseMonth(rawMonth, entity.name);
  if (!Array.isArray(adjustments) || adjustments.length > 30)
    throw new DomainError(
      "invalid",
      "A month's adjustments are a list of up to 30.",
    );
  const list = adjustments.map((a, i): GroupAdjustment => {
    const name = String(a?.name ?? "").trim();
    if (!name)
      throw new DomainError("invalid", `Adjustment ${i + 1}: give it a name.`);
    if (!TOTAL_KEYS.has(String(a.total)))
      throw new DomainError(
        "invalid",
        `${name}: choose the total it changes: ${GROUP_TOTALS.map((t) => t.key).join(", ")}.`,
      );
    const amount = amountOf(a.amount, name);
    if (amount === null || new Dec(amount).isZero())
      throw new DomainError(
        "invalid",
        `${name}: enter the amount, negative to reduce.`,
      );
    return {
      id:
        typeof a.id === "string" && /^[\w-]{1,64}$/.test(a.id)
          ? a.id
          : randomUUID(),
      name,
      total: a.total as GroupTotal,
      amount,
    };
  });
  await saveMonth(db, entityId, month, { adjustments: list });
  return (await getGroupBorrowingBase(db, ctx, entityId)).months.find(
    (m) => m.month === month,
  )!;
}

// Sets the totals of a certificate the client sends for the group, which
// replace the sum in that month; null removes it. Only the totals given
// replace; the others stay the sum's.
export async function setGroupBorrowingBaseOverride(
  db: Db,
  ctx: Context,
  entityId: string,
  rawMonth: string,
  override: Record<string, unknown> | null,
  note?: string | null,
): Promise<GroupMonth> {
  const entity = await consolidated(db, ctx, entityId);
  const month = parseMonth(rawMonth, entity.name);
  let totals: Partial<Record<GroupSummed, string>> | null = null;
  if (override) {
    totals = {};
    for (const [key, raw] of Object.entries(override)) {
      if (!OVERRIDE_KEYS.has(key))
        throw new DomainError(
          "invalid",
          `"${key}" isn't one of the group's totals: ${OVERRIDE_TOTALS.map((t) => t.key).join(", ")}.`,
        );
      const amount = amountOf(
        raw,
        OVERRIDE_TOTALS.find((t) => t.key === key)!.label,
      );
      if (amount !== null) totals[key as GroupSummed] = amount;
    }
    if (!Object.keys(totals).length) totals = null;
  }
  await saveMonth(db, entityId, month, {
    override: totals,
    ...(note !== undefined ? { note: note?.trim() || null } : {}),
  });
  return (await getGroupBorrowingBase(db, ctx, entityId)).months.find(
    (m) => m.month === month,
  )!;
}

export interface GroupSummary {
  entity: { id: string; name: string };
  lines: number;
  latest: { month: string; figures: GroupFigures; overridden: boolean } | null;
  deficitMonths: number;
}

// Every consolidated client with margined members, for monitoring, with
// its latest month.
export async function listGroupBorrowingBases(
  db: Db,
  ctx: Context,
): Promise<GroupSummary[]> {
  const groups = await db
    .selectDistinct({ id: schema.entities.id, name: schema.entities.name })
    .from(schema.entities)
    .innerJoin(
      schema.consolidationMembers,
      eq(schema.consolidationMembers.entityId, schema.entities.id),
    )
    .innerJoin(
      schema.creditLines,
      eq(schema.creditLines.entityId, schema.consolidationMembers.memberId),
    )
    .where(eq(schema.entities.organizationId, ctx.organizationId));
  const result: GroupSummary[] = [];
  for (const group of groups) {
    const worksheet = await getGroupBorrowingBase(db, ctx, group.id);
    if (!worksheet.members.length) continue;
    const latest = worksheet.months.at(-1);
    result.push({
      entity: group,
      lines: worksheet.members.length,
      latest: latest
        ? {
            month: latest.month,
            figures: latest.consolidated,
            overridden: latest.override !== null,
          }
        : null,
      deficitMonths: worksheet.months
        .slice(-12)
        .filter((m) => new Dec(m.consolidated.surplus ?? 0).isNegative())
        .length,
    });
  }
  return result.sort((a, b) => a.entity.name.localeCompare(b.entity.name));
}
