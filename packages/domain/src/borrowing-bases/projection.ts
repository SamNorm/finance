import { and, eq, schema, type Db } from "@finance/db";
import { Dec } from "@finance/engine";
import {
  getAnalysis,
  getScenario,
  runAnalysis,
  updateAnalysis,
  updateScenario,
  type Scenario,
} from "../analyses/service";
import type { Context } from "../context";
import {
  mergeLineUsage,
  type LineUsage,
  type ProposedLine,
} from "../credit-lines/credit-lines";
import {
  monthNumber,
  parseMonth,
  termIn,
  type Term,
} from "../credit-lines/terms";
import { DomainError, type Issue } from "../errors";
import { monthIndex, monthOf } from "../financing/amortization";
import { parseValue } from "../spreads/values";
import { getSpread } from "../spreads/service";
import { compileBorrowingBase, type WaterfallRow } from "./compile";
import { seasonalProfile } from "./cycle";
import type { BorrowingBaseDefinition, LineOf } from "./definition";
import { marginedLines, type MarginedLine } from "./lines";
import { parseBorrowingBasePaste, type BorrowingBasePaste } from "./paste";
import {
  runBorrowingBase,
  type BorrowingBaseRun,
  type ProposedTerms,
} from "./run";
import { monthsOf, type BorrowingBaseMonth } from "./service";
import {
  assumptionAt,
  DEFAULT_PROJECTED_MONTHS,
  normalizeProjectedBorrowingBase,
  normalizeScenarioBorrowingBase,
  type ProjectedBorrowingBase,
} from "./settings";

// Borrowing bases projected in analyses (borrowing-base-plan.md §8): each
// margined line's history, then its months ahead, from the client's
// projections entered in the analysis or from the definition's projection
// formulas, in the base case or a scenario. A deal's terms apply from
// closing, or with no project from the first projected month.

const { analysisBorrowingBaseValues: valuesTable } = schema;

// How much the projected balance and the usage the analysis assumes for
// interest can differ before they're flagged.
export const USAGE_GAP = new Dec("0.2");

export interface AnalysisBorrowingBase {
  // The line, as the analysis knows it.
  key: string;
  name: string;
  currency: string;
  member: { id: string; name: string } | null;
  // A line the scenario proposes, with no history.
  proposedNew: boolean;
  settings: ProjectedBorrowingBase;
  definition: BorrowingBaseDefinition;
  rows: WaterfallRow[];
  inputs: WaterfallRow[];
  assumptions: LineOf<"assumption">[];
  // History, then the projection; under a deal, its terms.
  run: BorrowingBaseRun;
  // The first month to show: twelve of history before the projection.
  from: number;
  // The same without the deal's terms, when it changes any.
  asIs: BorrowingBaseRun | null;
  // The deal's terms apply after this month.
  proposedAfter: string | null;
  // Projecting from the client's figures: lines it didn't project, taken
  // from their projection formulas.
  estimated: string[];
  // The client's projected figures, by month then code.
  clientFigures: Record<string, Record<string, string>>;
  // Average over the projected months: the line's balance projected, and
  // the usage the analysis assumes for interest.
  usage: { projected: string | null; assumed: string | null; gap: boolean };
  issues: Issue[];
}

async function clientValues(db: Db, analysisId: string) {
  const rows = await db
    .select()
    .from(valuesTable)
    .where(eq(valuesTable.analysisId, analysisId));
  const result = new Map<string, Record<string, Record<string, string>>>();
  for (const r of rows) {
    const line =
      result.get(r.lineId) ?? result.set(r.lineId, {}).get(r.lineId)!;
    (line[r.month] ??= {})[r.code] = new Dec(r.amount).toFixed();
  }
  return result;
}

const monthsAfter = (month: string, count: number) =>
  Array.from({ length: count }, (_, i) => monthOf(monthNumber(month) + i + 1));

// The deal's changes to a line's terms: its limit, closed at zero, and its
// borrowing base's terms.
function dealTerms(
  proposed: ProposedLine | undefined,
  after: string | null,
  inForce: Term,
): ProposedTerms | null {
  if (!proposed || !after) return null;
  const limit = proposed.closed ? { value: "0" } : proposed.limit;
  const changed =
    proposed.closed ||
    JSON.stringify(limit) !== JSON.stringify(inForce) ||
    Object.keys(proposed.terms ?? {}).length > 0;
  return changed ? { after, limit, terms: proposed.terms } : null;
}

export async function runAnalysisBorrowingBases(
  db: Db,
  ctx: Context,
  analysisId: string,
  scenarioId?: string | null,
): Promise<AnalysisBorrowingBase[]> {
  const detail = await getAnalysis(db, ctx, analysisId);
  const scenario = scenarioId
    ? detail.scenarios.find((s) => s.id === scenarioId)
    : undefined;
  if (scenarioId && !scenario)
    throw new DomainError("not_found", "No such scenario.");
  const [lines, values, spread] = await Promise.all([
    marginedLines(db, ctx, detail.entity.id),
    clientValues(db, analysisId),
    getSpread(db, ctx, detail.entity.id),
  ]);
  const histories = await monthsOf(
    db,
    lines.map((l) => l.line.id),
  );
  const lastActual = spread.periods.findLast((p) => p.quality !== "projected");
  const closing = scenario?.project
    ? monthOf(monthIndex(scenario.project.closing))
    : null;
  const usage = mergeLineUsage(
    detail.analysis.lineUsage,
    scenario?.lineUsage ?? {},
  );
  const project = (
    key: string,
    name: string,
    currency: string,
    member: MarginedLine["member"],
    definition: BorrowingBaseDefinition,
    limit: Term,
    history: BorrowingBaseMonth[],
    proposedNew: boolean,
  ): AnalysisBorrowingBase => {
    const settings: ProjectedBorrowingBase = detail.analysis.borrowingBases[
      key
    ] ?? {
      source: "assumptions",
      months: DEFAULT_PROJECTED_MONTHS,
    };
    const compiled = compileBorrowingBase(definition, { currency, limit });
    const last =
      history.at(-1)?.month ?? lastActual?.periodEnd.slice(0, 7) ?? null;
    const issues: Issue[] = [];
    const client = values.get(key) ?? {};
    const own = scenario?.borrowingBases[key];
    const months = last ? monthsAfter(last, settings.months) : [];
    const projected = months.map((month) => ({
      month,
      figures: {
        ...(settings.source === "client" ? client[month] : {}),
        ...own?.figures?.[month],
      },
    }));
    const estimated =
      settings.source === "client"
        ? compiled.inputs
            .map((r) => r.code)
            .filter((code) =>
              months.some((m) => client[m]?.[code] === undefined),
            )
        : [];
    if (settings.source === "client" && !Object.keys(client).length)
      issues.push({
        severity: "warning",
        code: "client_missing",
        message: `${name}: no projected figures from the client yet, so every line comes from its projection formula.`,
      });
    const proposedLine = scenario?.lines?.find((l) => l.id === key);
    const after = proposedLine
      ? (closing ?? (proposedNew ? null : last))
      : null;
    const deal = dealTerms(proposedLine, after, limit);
    const run = runBorrowingBase({
      definition,
      line: { currency, limit },
      months: history,
      projected,
      assumptionAt: assumptionAt(settings, own),
      proposed: proposedNew ? null : deal,
      compiled,
    });
    const asIs =
      deal && !proposedNew
        ? runBorrowingBase({
            definition,
            line: { currency, limit },
            months: history,
            projected,
            assumptionAt: assumptionAt(settings, own),
            compiled,
          })
        : null;
    const ahead = run.months
      .map((m, p) => ({ m, p }))
      .filter(({ m }) => m.projected);
    const mean = (list: InstanceType<typeof Dec>[]) =>
      list.length
        ? list.reduce((a, b) => a.plus(b), new Dec(0)).div(list.length)
        : null;
    const projectedBalance = mean(
      ahead.flatMap(({ p }) => {
        const v = run.cells.BB_OUTSTANDING?.[p]?.value;
        return v === null || v === undefined ? [] : [new Dec(v)];
      }),
    );
    const lineUsage = usage[key];
    const effectiveLimit = proposedNew ? limit : (deal?.limit ?? limit);
    const assumed =
      lineUsage?.share === undefined && !lineUsage?.months
        ? null
        : mean(
            ahead.map(({ m }) => {
              const amount = lineUsage?.months?.[m.month];
              if (amount !== undefined) return new Dec(amount);
              const term =
                deal && monthNumber(m.month) > monthNumber(deal.after)
                  ? effectiveLimit
                  : limit;
              return new Dec(termIn(term, monthNumber(m.month)).value).times(
                lineUsage?.share ?? 0,
              );
            }),
          );
    const gap =
      projectedBalance !== null &&
      assumed !== null &&
      projectedBalance.gt(0) &&
      assumed
        .minus(projectedBalance)
        .abs()
        .gt(projectedBalance.times(USAGE_GAP));
    if (gap)
      issues.push({
        severity: "warning",
        code: "usage_gap",
        message: `${name}: the usage assumed for interest averages ${assumed!.toFixed(0)} over the projected months, but the balance projected averages ${projectedBalance!.toFixed(0)}.`,
      });
    const first = run.months.findIndex((m) => m.projected);
    return {
      key,
      name,
      currency,
      member,
      proposedNew,
      settings,
      definition,
      rows: compiled.rows,
      inputs: compiled.inputs,
      assumptions: compiled.assumptions,
      run,
      from: Math.max(0, (first === -1 ? run.months.length : first) - 12),
      asIs,
      proposedAfter: deal?.after ?? null,
      estimated,
      clientFigures: client,
      usage: {
        projected: projectedBalance?.toFixed() ?? null,
        assumed: assumed?.toFixed() ?? null,
        gap,
      },
      issues,
    };
  };

  const result = lines.map(({ key, line, member }) =>
    project(
      key,
      member ? `${line.name} (${member.name})` : line.name,
      line.currency,
      member,
      line.borrowingBase!,
      line.limit,
      histories.get(line.id) ?? [],
      false,
    ),
  );
  // New margined lines the scenario proposes, projected alone.
  const known = new Set(lines.map((l) => l.key));
  for (const proposed of scenario?.lines ?? [])
    if (proposed.borrowingBase && !known.has(proposed.id) && !proposed.closed)
      result.push(
        project(
          proposed.id,
          proposed.name,
          proposed.currency,
          null,
          proposed.borrowingBase,
          proposed.limit,
          [],
          true,
        ),
      );
  return result;
}

// The definition of a line the analysis projects: one of its borrower's
// margined lines, or a new margined line one of its scenarios proposes.
async function definitionOf(
  db: Db,
  ctx: Context,
  analysisId: string,
  key: string,
) {
  const detail = await getAnalysis(db, ctx, analysisId);
  const margined = (await marginedLines(db, ctx, detail.entity.id)).find(
    (l) => l.key === key,
  );
  if (margined)
    return {
      detail,
      name: margined.line.name,
      definition: margined.line.borrowingBase!,
      facility: {
        currency: margined.line.currency,
        limit: margined.line.limit,
      },
    };
  for (const s of detail.scenarios) {
    const proposed = s.lines?.find((l) => l.id === key && l.borrowingBase);
    if (proposed)
      return {
        detail,
        name: proposed.name,
        definition: proposed.borrowingBase!,
        facility: { currency: proposed.currency, limit: proposed.limit },
      };
  }
  throw new DomainError(
    "not_found",
    "That isn't a margined line of the analysis's borrower, or one its scenarios propose.",
  );
}

// Sets how the analysis projects a line: from the client's figures or from
// assumptions, over how many months, and the base case's assumption values.
export async function setAnalysisBorrowingBase(
  db: Db,
  ctx: Context,
  analysisId: string,
  key: string,
  input: { source?: unknown; months?: unknown; assumptions?: unknown },
) {
  const { detail, name, definition } = await definitionOf(
    db,
    ctx,
    analysisId,
    key,
  );
  const settings = normalizeProjectedBorrowingBase(
    input,
    definition,
    name,
    detail.analysis.borrowingBases[key],
  );
  await db
    .update(schema.analyses)
    .set({
      borrowingBases: { ...detail.analysis.borrowingBases, [key]: settings },
      updatedAt: new Date(),
    })
    .where(eq(schema.analyses.id, analysisId));
  return settings;
}

// Sets a scenario's changes to a line's projection, replacing its own: its
// assumption values, and figures of projected months. Null clears them.
export async function setScenarioBorrowingBase(
  db: Db,
  ctx: Context,
  scenarioId: string,
  key: string,
  input: unknown,
): Promise<Scenario> {
  const scenario = await getScenario(db, ctx, scenarioId);
  const { name, definition, facility } = await definitionOf(
    db,
    ctx,
    scenario.analysisId,
    key,
  );
  const { [key]: _, ...others } = scenario.borrowingBases;
  const own =
    input === null
      ? null
      : normalizeScenarioBorrowingBase(
          input,
          definition,
          compileBorrowingBase(definition, facility),
          name,
        );
  const [updated] = await db
    .update(schema.analysisScenarios)
    .set({
      borrowingBases:
        own && Object.keys(own).length ? { ...others, [key]: own } : others,
    })
    .where(eq(schema.analysisScenarios.id, scenarioId))
    .returning();
  return updated!;
}

export interface ProjectedValueInput {
  month: string;
  code: string;
  // Blank or null clears it.
  value: string | null;
}

// Enters, changes or clears the client's projected figures for a line, by
// month and code.
export async function setProjectedBorrowingBaseValues(
  db: Db,
  ctx: Context,
  analysisId: string,
  key: string,
  entries: readonly ProjectedValueInput[],
): Promise<number> {
  const { name, definition, facility } = await definitionOf(
    db,
    ctx,
    analysisId,
    key,
  );
  const inputs = new Map(
    compileBorrowingBase(definition, facility).inputs.map((r) => [r.code, r]),
  );
  const parsed = entries.map((e) => {
    const month = parseMonth(e.month, name);
    const code = String(e.code ?? "").toUpperCase();
    const row = inputs.get(code);
    if (!row)
      throw new DomainError(
        "invalid",
        `"${e.code}" isn't entered in ${name}'s borrowing base.`,
      );
    const value = parseValue(
      e.value === null ? "" : String(e.value),
      row.format === "ratio" ? "ratio" : "amount",
    );
    if ("error" in value)
      throw new DomainError(
        "invalid",
        `${row.label}, ${month}: ${value.error}`,
      );
    return { month, code, value: value.value };
  });
  await db.transaction(async (tx) => {
    for (const { month, code, value } of parsed) {
      const where = and(
        eq(valuesTable.analysisId, analysisId),
        eq(valuesTable.lineId, key),
        eq(valuesTable.month, month),
        eq(valuesTable.code, code),
      );
      if (value === null) await tx.delete(valuesTable).where(where);
      else
        await tx
          .insert(valuesTable)
          .values({ analysisId, lineId: key, month, code, amount: value })
          .onConflictDoUpdate({
            target: [
              valuesTable.analysisId,
              valuesTable.lineId,
              valuesTable.month,
              valuesTable.code,
            ],
            set: { amount: value },
          });
    }
  });
  await db
    .update(schema.analyses)
    .set({ updatedAt: new Date() })
    .where(eq(schema.analyses.id, analysisId));
  return parsed.length;
}

export async function previewProjectedBorrowingBasePaste(
  db: Db,
  ctx: Context,
  analysisId: string,
  key: string,
  text: string,
): Promise<BorrowingBasePaste> {
  const { definition, facility } = await definitionOf(db, ctx, analysisId, key);
  return parseBorrowingBasePaste(
    text,
    compileBorrowingBase(definition, facility).inputs,
  );
}

// Saves the client's projected figures pasted for a line. Columns whose
// header doesn't read as a month take one from `months`, by column index.
export async function importProjectedBorrowingBasePaste(
  db: Db,
  ctx: Context,
  analysisId: string,
  key: string,
  text: string,
  months: Record<number, string> = {},
): Promise<{ figures: number; months: string[] }> {
  const paste = await previewProjectedBorrowingBasePaste(
    db,
    ctx,
    analysisId,
    key,
    text,
  );
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
    figures: await setProjectedBorrowingBaseValues(
      db,
      ctx,
      analysisId,
      key,
      entries,
    ),
    months: [...new Set(columns.map((c) => c.month!))].sort(),
  };
}

// Fills a line's usage, month by month, once (decision 11): over the months
// the analysis counts interest in, the balance in the certificates the same
// calendar month of the latest year, or the balance projected. The months
// are then the analyst's, as typed ones are; nothing is read again.
export async function fillLineUsage(
  db: Db,
  ctx: Context,
  target: { analysisId: string; scenarioId?: string | null },
  key: string,
  from: "certificates" | "projection",
): Promise<LineUsage> {
  const results = await runAnalysis(
    db,
    ctx,
    target.analysisId,
    target.scenarioId,
  );
  const shown = results.scenario ?? results.base;
  // Months in projected periods, and the twelve after closing.
  const counted = new Set<string>();
  for (const p of shown.periods)
    if (p.projection) {
      const end = monthIndex(p.end);
      for (let m = end - p.months + 1; m <= end; m++) counted.add(monthOf(m));
    }
  const scenario = target.scenarioId
    ? await getScenario(db, ctx, target.scenarioId)
    : null;
  if (scenario?.project) {
    const closing = monthIndex(scenario.project.closing);
    for (let m = closing + 1; m <= closing + 12; m++) counted.add(monthOf(m));
  }
  const lines = await runAnalysisBorrowingBases(
    db,
    ctx,
    target.analysisId,
    target.scenarioId,
  );
  const line = lines.find((l) => l.key === key);
  if (!line)
    throw new DomainError(
      "not_found",
      "That line isn't margined in this analysis.",
    );
  const balance = new Map<string, string>();
  line.run.months.forEach((m, p) => {
    const value = line.run.cells.BB_OUTSTANDING?.[p]?.value;
    if (value === null || value === undefined) return;
    if (from === "projection" ? m.projected : m.quality)
      balance.set(m.month, value);
  });
  const months: Record<string, string> = {};
  for (const month of [...counted].sort()) {
    if (from === "projection") {
      const value = balance.get(month);
      if (value !== undefined) months[month] = value;
      continue;
    }
    // The same calendar month in the latest year with a certificate.
    for (let back = 12; back <= 60; back += 12) {
      const value = balance.get(monthOf(monthNumber(month) - back));
      if (value !== undefined) {
        months[month] = value;
        break;
      }
    }
  }
  if (!Object.keys(months).length)
    throw new DomainError(
      "invalid",
      from === "projection"
        ? `${line.name}'s projection covers none of the months the analysis counts interest in.`
        : `${line.name} has no certificates for the same months of an earlier year.`,
    );
  const own = scenario ? scenario.lineUsage : results.creditLines.usage;
  const next: LineUsage = {
    ...own,
    [key]: { ...own[key], months: { ...own[key]?.months, ...months } },
  };
  if (scenario) await updateScenario(db, ctx, scenario.id, { lineUsage: next });
  else await updateAnalysis(db, ctx, target.analysisId, { lineUsage: next });
  return next;
}

// Fills a seasonal assumption once from the line's certificates: each
// calendar month's share of a typical month of a figure, such as SALES, over
// the last three years. The values are then the analyst's.
export async function fillSeasonalAssumption(
  db: Db,
  ctx: Context,
  analysisId: string,
  key: string,
  assumption: string,
  from: string,
): Promise<ProjectedBorrowingBase> {
  const lines = await runAnalysisBorrowingBases(db, ctx, analysisId);
  const line = lines.find((l) => l.key === key);
  if (!line)
    throw new DomainError(
      "not_found",
      "That line isn't margined in this analysis.",
    );
  const code = from.toUpperCase();
  if (!line.run.cells[code])
    throw new DomainError(
      "invalid",
      `${line.name}'s borrowing base has no figure ${from}.`,
    );
  const byMonth = seasonalProfile(line.run, code);
  if (byMonth.every((v) => v === null))
    throw new DomainError(
      "invalid",
      `${line.name} has no certificates with ${from} to fill from.`,
    );
  return setAnalysisBorrowingBase(db, ctx, analysisId, key, {
    assumptions: {
      ...line.settings.assumptions,
      [assumption.toUpperCase()]: { byMonth },
    },
  });
}
