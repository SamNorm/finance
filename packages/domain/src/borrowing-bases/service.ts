import { and, asc, eq, inArray, isNotNull, schema, type Db } from "@finance/db";
import { Dec } from "@finance/engine";
import type { Context } from "../context";
import { DomainError, type Issue } from "../errors";
import { getCreditLine } from "../credit-lines/service";
import { parseMonth, parseTerm, type Term } from "../credit-lines/terms";
import type { CreditLine } from "../credit-lines/credit-lines";
import { getSpread } from "../spreads/service";
import { parseDate } from "../financing/common";
import { parseValue } from "../spreads/values";
import { BUILT_IN_BORROWING_BASES } from "./builtins";
import { borrowingBaseIssues, type BorrowingBaseIssues } from "./checks";
import {
  checkDefinition,
  compileBorrowingBase,
  type CompiledBorrowingBase,
  type WaterfallRow,
} from "./compile";
import {
  normalizeDefinition,
  type BorrowingBaseDefinition,
  type BorrowingBaseDefinitionInput,
} from "./definition";
import { parseBorrowingBasePaste, type BorrowingBasePaste } from "./paste";
import {
  runBorrowingBase,
  type BorrowingBaseQuality,
  type BorrowingBaseRun,
} from "./run";

// A margined line's borrowing base: its definition, kept on the line, and
// its monthly history from the client's certificates (borrowing-base-plan.md
// §5, §7). What's projected lives in analyses, not here.

const {
  creditLines,
  borrowingBaseMonths: monthsTable,
  borrowingBaseValues: valuesTable,
  entities,
} = schema;

export interface BorrowingBaseMonth {
  id: string;
  month: string;
  quality: BorrowingBaseQuality;
  receivedOn: string | null;
  note: string | null;
  figures: Record<string, string>;
}

export interface BorrowingBaseDetail {
  line: CreditLine;
  entity: { id: string; name: string };
  definition: BorrowingBaseDefinition;
  // The waterfall's rows, and those entered each month.
  rows: WaterfallRow[];
  inputs: WaterfallRow[];
  months: BorrowingBaseMonth[];
}

const QUALITIES: readonly BorrowingBaseQuality[] = ["reported", "verified"];

async function lineAndEntity(db: Db, ctx: Context, lineId: string) {
  const line = await getCreditLine(db, ctx, lineId);
  const [entity] = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(eq(entities.id, line.entityId));
  return { line, entity: entity! };
}

const facility = (line: CreditLine) => ({
  currency: line.currency,
  limit: line.limit,
});

function margined(line: CreditLine): BorrowingBaseDefinition {
  if (!line.borrowingBase)
    throw new DomainError(
      "conflict",
      `${line.name} isn't margined: set up its borrowing base first.`,
    );
  return line.borrowingBase;
}

// Postgres pads numerics to their scale; keep the canonical form.
const canonical = (raw: string) => new Dec(raw).toFixed();

async function monthsOf(
  db: Db,
  lineIds: readonly string[],
): Promise<Map<string, BorrowingBaseMonth[]>> {
  const result = new Map<string, BorrowingBaseMonth[]>();
  if (!lineIds.length) return result;
  const rows = await db
    .select()
    .from(monthsTable)
    .where(inArray(monthsTable.lineId, [...lineIds]))
    .orderBy(asc(monthsTable.month));
  const figures = rows.length
    ? await db
        .select()
        .from(valuesTable)
        .where(
          inArray(
            valuesTable.monthId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  const byMonth = new Map<string, Record<string, string>>();
  for (const f of figures)
    (byMonth.get(f.monthId) ?? byMonth.set(f.monthId, {}).get(f.monthId)!)[
      f.code
    ] = canonical(f.amount);
  for (const row of rows)
    result.set(row.lineId, [
      ...(result.get(row.lineId) ?? []),
      {
        id: row.id,
        month: row.month,
        quality: row.quality,
        receivedOn: row.receivedOn,
        note: row.note,
        figures: byMonth.get(row.id) ?? {},
      },
    ]);
  return result;
}

function detailOf(
  line: CreditLine,
  entity: { id: string; name: string },
  months: BorrowingBaseMonth[],
): BorrowingBaseDetail & { compiled: CompiledBorrowingBase } {
  const definition = margined(line);
  const compiled = compileBorrowingBase(definition, facility(line));
  return {
    line,
    entity,
    definition,
    rows: compiled.rows,
    inputs: compiled.inputs,
    months,
    compiled,
  };
}

export async function getBorrowingBase(
  db: Db,
  ctx: Context,
  lineId: string,
): Promise<BorrowingBaseDetail> {
  const { line, entity } = await lineAndEntity(db, ctx, lineId);
  const months = (await monthsOf(db, [line.id])).get(line.id) ?? [];
  const { compiled: _, ...detail } = detailOf(line, entity, months);
  return detail;
}

// The spread's periods a month can be compared with, and its items' labels.
async function spreadFor(db: Db, ctx: Context, entityId: string) {
  const spread = await getSpread(db, ctx, entityId);
  return {
    periods: spread.periods
      .filter((p) => p.quality !== "projected")
      .map((p) => ({
        end: p.periodEnd,
        figure: (code: string) =>
          spread.values[p.id]?.[code] ?? spread.computed[p.id]?.[code],
      })),
    labels: new Map(
      (spread.layout?.items ?? []).map((i) => [i.code, i.label] as const),
    ),
  };
}

export interface BorrowingBaseResults {
  detail: BorrowingBaseDetail;
  run: BorrowingBaseRun;
  issues: BorrowingBaseIssues;
}

// The history run month by month, with its tests and checks.
export async function runBorrowingBaseOf(
  db: Db,
  ctx: Context,
  lineId: string,
): Promise<BorrowingBaseResults> {
  const { line, entity } = await lineAndEntity(db, ctx, lineId);
  const months = (await monthsOf(db, [line.id])).get(line.id) ?? [];
  const { compiled, ...detail } = detailOf(line, entity, months);
  const run = runBorrowingBase({
    definition: detail.definition,
    line: facility(line),
    months,
    compiled,
  });
  const spread = await spreadFor(db, ctx, entity.id);
  return {
    detail,
    run,
    issues: borrowingBaseIssues({
      definition: detail.definition,
      compiled,
      months,
      run,
      spread: spread.periods,
      labels: spread.labels,
    }),
  };
}

// Sets a line's whole definition, as typed, or none: the line is then no
// longer margined, and its months wait in case it is again. Refused with
// errors; warnings come back with it.
export async function setBorrowingBaseDefinition(
  db: Db,
  ctx: Context,
  lineId: string,
  input: BorrowingBaseDefinitionInput | null,
): Promise<{ line: CreditLine; issues: Issue[] }> {
  const { line, entity } = await lineAndEntity(db, ctx, lineId);
  let definition: BorrowingBaseDefinition | null = null;
  const issues: Issue[] = [];
  if (input) {
    const read = normalizeDefinition(input, line.currency);
    definition = read.definition;
    issues.push(...read.issues);
    if (!issues.some((i) => i.severity === "error"))
      issues.push(...checkDefinition(definition, facility(line)));
    const errors = issues.filter((i) => i.severity === "error");
    if (errors.length)
      throw new DomainError("invalid", errors[0]!.message, errors);
    const { labels } = await spreadFor(db, ctx, entity.id);
    const items = [
      ...definition.lines.flatMap((l) =>
        "reconcilesWith" in l && l.reconcilesWith ? [l.reconcilesWith] : [],
      ),
      ...(definition.outstandingReconcilesWith
        ? [definition.outstandingReconcilesWith]
        : []),
    ];
    for (const item of new Set(items))
      if (labels.size && !labels.has(item))
        issues.push({
          severity: "warning",
          code: "reconciles_unknown",
          itemCode: item,
          message: `"${item}" isn't an item of ${entity.name}'s spread, so it can't be compared with it.`,
        });
  }
  const [updated] = await db
    .update(creditLines)
    .set({ borrowingBase: definition })
    .where(eq(creditLines.id, lineId))
    .returning();
  return { line: updated!, issues };
}

// Starts a line's borrowing base from a built-in one or another line's,
// replacing any it has. It's the line's own from then on.
export async function startBorrowingBase(
  db: Db,
  ctx: Context,
  lineId: string,
  from: { builtIn: string } | { lineId: string },
): Promise<{ line: CreditLine; issues: Issue[] }> {
  if ("builtIn" in from) {
    const builtIn = BUILT_IN_BORROWING_BASES.find((b) => b.id === from.builtIn);
    if (!builtIn)
      throw new DomainError(
        "not_found",
        `No built-in borrowing base "${from.builtIn}"; use one of ${BUILT_IN_BORROWING_BASES.map((b) => b.id).join(", ")}.`,
      );
    return setBorrowingBaseDefinition(db, ctx, lineId, {
      ...builtIn.definition,
      basedOn: { kind: "builtin", id: builtIn.id, name: builtIn.name },
    });
  }
  const { line: source, entity } = await lineAndEntity(db, ctx, from.lineId);
  const definition = margined(source);
  return setBorrowingBaseDefinition(db, ctx, lineId, {
    ...definition,
    basedOn: {
      kind: "line",
      id: source.id,
      name: `${source.name} (${entity.name})`,
    },
  });
}

// Changes one term from a month on, as an amendment does ("70% from June
// 2026"), or from the start when no month is given, which corrects it.
// Advance rates and caps are collateral lines'; groups have caps, and
// reserves amounts. A null cap removes it.
export async function setBorrowingBaseTerm(
  db: Db,
  ctx: Context,
  lineId: string,
  input: {
    code: string;
    term: "rate" | "cap" | "amount";
    value: unknown;
    from?: string | null;
  },
): Promise<{ line: CreditLine; issues: Issue[] }> {
  const { line } = await lineAndEntity(db, ctx, lineId);
  const definition = margined(line);
  const code = String(input.code ?? "").toUpperCase();
  const target = definition.lines.find((l) => l.code === code);
  if (!target)
    throw new DomainError(
      "not_found",
      `${line.name}'s borrowing base has no line ${code}.`,
    );
  const allowed =
    target.kind === "collateral"
      ? ["rate", "cap"]
      : target.kind === "group"
        ? ["cap"]
        : target.kind === "reserve"
          ? ["amount"]
          : [];
  if (!allowed.includes(input.term))
    throw new DomainError(
      "invalid",
      allowed.length
        ? `${target.label} has ${allowed.join(" and ")} as terms.`
        : `${target.label} has no terms: its amount is entered or a formula.`,
    );
  const kind = input.term === "rate" ? "rate" : "amount";
  const what = `${target.label}, ${input.term === "rate" ? "advance rate" : input.term}`;
  const current = (target as unknown as Record<string, unknown>)[input.term] as
    Term | undefined;
  let next: Term | undefined;
  if (input.value === null || input.value === "") {
    if (input.term === "rate")
      throw new DomainError("invalid", `${what}: enter it.`);
    if (input.from)
      throw new DomainError(
        "invalid",
        `${what}: a cap is removed for every month; enter an amount from a month instead.`,
      );
    next = undefined;
  } else {
    const value = parseTerm(input.value, what, kind).value;
    if (input.from) {
      const from = parseMonth(input.from, what);
      const base = current ?? { value: kind === "rate" ? "0" : value };
      next = {
        ...base,
        steps: [
          ...(base.steps ?? []).filter((s) => s.from !== from),
          { from, value },
        ].sort((a, b) => a.from.localeCompare(b.from)),
      };
    } else next = { ...(current ?? {}), value };
  }
  const lines = definition.lines.map((l) => {
    if (l.code !== code) return l;
    const { [input.term]: _, ...rest } = l as unknown as Record<
      string,
      unknown
    >;
    return (next
      ? { ...rest, [input.term]: next }
      : rest) as unknown as typeof l;
  });
  return setBorrowingBaseDefinition(db, ctx, lineId, { ...definition, lines });
}

async function ensureMonths(
  db: Db,
  lineId: string,
  list: readonly string[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(list)];
  if (wanted.length)
    await db
      .insert(monthsTable)
      .values(wanted.map((month) => ({ lineId, month })))
      .onConflictDoNothing();
  const rows = wanted.length
    ? await db
        .select({ id: monthsTable.id, month: monthsTable.month })
        .from(monthsTable)
        .where(
          and(
            eq(monthsTable.lineId, lineId),
            inArray(monthsTable.month, wanted),
          ),
        )
    : [];
  return new Map(rows.map((r) => [r.month, r.id]));
}

export interface BorrowingBaseValueInput {
  month: string;
  code: string;
  // Blank or null clears it.
  value: string | null;
}

// Enters, changes or clears figures by month and code, adding months as
// needed (reported, until marked verified). Codes are the lines entered
// each month: collateral or its aging buckets (AR.AGE1), ineligibles, prior
// claims, reserves, usage, drivers, BB_OUTSTANDING and rates (FX.USD).
export async function setBorrowingBaseValues(
  db: Db,
  ctx: Context,
  lineId: string,
  entries: readonly BorrowingBaseValueInput[],
): Promise<BorrowingBaseDetail> {
  const detail = await getBorrowingBase(db, ctx, lineId);
  const inputs = new Map(detail.inputs.map((r) => [r.code, r]));
  const parsed = entries.map((e) => {
    const month = parseMonth(e.month, "Borrowing base");
    const code = String(e.code ?? "").toUpperCase();
    const row = inputs.get(code);
    if (!row)
      throw new DomainError(
        "invalid",
        `"${e.code}" isn't entered in ${detail.line.name}'s borrowing base; its entered lines are ${[...inputs.keys()].join(", ")}.`,
      );
    const raw = e.value === null ? "" : String(e.value);
    const value = parseValue(raw, row.format === "ratio" ? "ratio" : "amount");
    if ("error" in value)
      throw new DomainError(
        "invalid",
        `${row.label}, ${month}: ${value.error}`,
      );
    if (
      code.startsWith("FX.") &&
      value.value !== null &&
      !new Dec(value.value).gt(0)
    )
      throw new DomainError(
        "invalid",
        `${row.label}, ${month}: a rate is positive.`,
      );
    return { month, code, value: value.value };
  });
  await db.transaction(async (tx) => {
    const ids = await ensureMonths(
      tx,
      lineId,
      parsed.filter((p) => p.value !== null).map((p) => p.month),
    );
    for (const { month, code, value } of parsed) {
      if (value === null) {
        const [row] = await tx
          .select({ id: monthsTable.id })
          .from(monthsTable)
          .where(
            and(eq(monthsTable.lineId, lineId), eq(monthsTable.month, month)),
          );
        if (row)
          await tx
            .delete(valuesTable)
            .where(
              and(eq(valuesTable.monthId, row.id), eq(valuesTable.code, code)),
            );
        continue;
      }
      await tx
        .insert(valuesTable)
        .values({ monthId: ids.get(month)!, code, amount: value })
        .onConflictDoUpdate({
          target: [valuesTable.monthId, valuesTable.code],
          set: { amount: value },
        });
    }
  });
  return getBorrowingBase(db, ctx, lineId);
}

// Sets a month's quality, the day its certificate came in, and a note,
// adding the month when it isn't there.
export async function setBorrowingBaseMonth(
  db: Db,
  ctx: Context,
  lineId: string,
  rawMonth: string,
  input: {
    quality?: BorrowingBaseQuality;
    receivedOn?: string | null;
    note?: string | null;
  },
): Promise<BorrowingBaseMonth> {
  const detail = await getBorrowingBase(db, ctx, lineId);
  const month = parseMonth(rawMonth, detail.line.name);
  if (input.quality !== undefined && !QUALITIES.includes(input.quality))
    throw new DomainError("invalid", "A month is reported or verified.");
  const receivedOn =
    input.receivedOn === undefined
      ? undefined
      : input.receivedOn
        ? parseDate(input.receivedOn, month, "date it was received")
        : null;
  const ids = await ensureMonths(db, lineId, [month]);
  await db
    .update(monthsTable)
    .set({
      quality: input.quality,
      receivedOn,
      note: input.note === undefined ? undefined : input.note?.trim() || null,
    })
    .where(eq(monthsTable.id, ids.get(month)!));
  return (await getBorrowingBase(db, ctx, lineId)).months.find(
    (m) => m.month === month,
  )!;
}

// Removes a month and its figures.
export async function removeBorrowingBaseMonth(
  db: Db,
  ctx: Context,
  lineId: string,
  rawMonth: string,
): Promise<void> {
  const { line } = await lineAndEntity(db, ctx, lineId);
  const month = parseMonth(rawMonth, line.name);
  await db
    .delete(monthsTable)
    .where(and(eq(monthsTable.lineId, lineId), eq(monthsTable.month, month)));
}

export async function previewBorrowingBasePaste(
  db: Db,
  ctx: Context,
  lineId: string,
  text: string,
): Promise<BorrowingBasePaste> {
  const detail = await getBorrowingBase(db, ctx, lineId);
  return parseBorrowingBasePaste(text, detail.inputs);
}

// Saves a paste's figures. Columns whose header doesn't read as a month take
// one from `months`, by column index; a paste with errors is refused.
export async function importBorrowingBasePaste(
  db: Db,
  ctx: Context,
  lineId: string,
  text: string,
  months: Record<number, string> = {},
): Promise<{ detail: BorrowingBaseDetail; figures: number; months: string[] }> {
  const detail = await getBorrowingBase(db, ctx, lineId);
  const paste = parseBorrowingBasePaste(text, detail.inputs);
  const errors = paste.issues.filter((i) => i.severity === "error");
  if (errors.length)
    throw new DomainError("invalid", errors[0]!.message, errors);
  const columns = paste.columns.map((c) => ({
    ...c,
    month: months[c.index]
      ? parseMonth(months[c.index], c.header || "Column")
      : c.month,
  }));
  const unread = columns.find((c) => !c.month);
  if (unread)
    throw new DomainError(
      "invalid",
      `Column "${unread.header || unread.index + 1}" isn't a month: say which month it is.`,
    );
  const entries = paste.matched.flatMap((row) =>
    row.cells.flatMap((cell, i) =>
      cell.trim()
        ? [{ month: columns[i]!.month!, code: row.code!, value: cell }]
        : [],
    ),
  );
  return {
    detail: await setBorrowingBaseValues(db, ctx, lineId, entries),
    figures: entries.length,
    months: [...new Set(columns.map((c) => c.month!))].sort(),
  };
}

export interface BorrowingBaseSummary {
  lineId: string;
  lineName: string;
  currency: string;
  entity: { id: string; name: string };
  months: number;
  // The latest month with a certificate.
  latest: {
    month: string;
    quality: BorrowingBaseQuality;
    total: string | null;
    limit: string | null;
    usage: string | null;
    surplus: string | null;
    utilization: string | null;
  } | null;
  // Months in deficit over the last twelve.
  deficitMonths: number;
  errors: number;
}

// Every margined line of the organization, for monitoring, with its latest
// month.
export async function listBorrowingBases(
  db: Db,
  ctx: Context,
): Promise<BorrowingBaseSummary[]> {
  const rows = await db
    .select({
      line: creditLines,
      entity: { id: entities.id, name: entities.name },
    })
    .from(creditLines)
    .innerJoin(entities, eq(entities.id, creditLines.entityId))
    .where(
      and(
        eq(entities.organizationId, ctx.organizationId),
        isNotNull(creditLines.borrowingBase),
      ),
    )
    .orderBy(asc(entities.name), asc(creditLines.position));
  const months = await monthsOf(
    db,
    rows.map((r) => r.line.id),
  );
  return rows.map(({ line, entity }) => {
    const history = months.get(line.id) ?? [];
    const run = runBorrowingBase({
      definition: line.borrowingBase!,
      line: facility(line),
      months: history,
    });
    const last = run.months.findLastIndex((m) => m.quality !== null);
    const value = (code: string, p: number) =>
      run.cells[code]?.[p]?.value ?? null;
    const recent = run.months
      .map((m, p) => ({ m, p }))
      .slice(-12)
      .filter(({ m }) => m.quality);
    const margin = run.tests.find((t) => t.id === "margin")!;
    return {
      lineId: line.id,
      lineName: line.name,
      currency: line.currency,
      entity,
      months: history.length,
      latest:
        last === -1
          ? null
          : {
              month: run.months[last]!.month,
              quality: run.months[last]!.quality!,
              total: value("BB_TOTAL", last),
              limit: value("BB_LIMIT", last),
              usage: value("BB_USAGE", last),
              surplus: value("BB_SURPLUS", last),
              utilization: value("BB_UTILIZATION", last),
            },
      deficitMonths: recent.filter(({ p }) => margin.months[p]?.pass === false)
        .length,
      errors: 0,
    };
  });
}
