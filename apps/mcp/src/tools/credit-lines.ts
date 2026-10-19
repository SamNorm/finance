import type { Db } from "@finance/db";
import {
  addCreditLine,
  getAnalysis,
  getCreditLine,
  getCreditLines,
  getEntity,
  getScenario,
  isPlain,
  mergeLineUsage,
  parseMonth,
  removeCreditLine,
  updateAnalysis,
  updateCreditLine,
  updateScenario,
  type Context,
  type CreditLine,
  type LineTerms,
  type LineUsage,
  type OwnedLine,
  type ProposedLine,
  type Scenario,
  type Term,
} from "@finance/domain";
import { Dec } from "@finance/engine";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { amount, borrowerId, date, limit, rate, scenarioId } from "../fields";
import { amount as showAmount, rate as showRate } from "../format";
import { ADD, CHANGE, invalid, respond } from "../respond";

// A borrower's lines of credit (borrowing-base-plan.md §4): what's real, kept
// a line at a time as its existing loans are. Analyses count their interest
// on the usage they assume, a share of the limit with any month's amount
// drawn instead; a scenario can override that usage and propose the deal's
// lines, as it proposes covenants.

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Calendar months in words: a run, across the new year too, as "October to
// March"; others listed, "January, April and July".
function monthsInWords(months: readonly number[]): string {
  const name = (m: number) => MONTHS[m - 1]!;
  const set = new Set(months);
  if (set.size === 1) return name(months[0]!);
  const next = (m: number) => (m % 12) + 1;
  const start = months.find((m) => !set.has(((m + 10) % 12) + 1));
  if (start !== undefined) {
    let end = start;
    let length = 1;
    while (set.has(next(end)) && length < set.size) {
      end = next(end);
      length++;
    }
    if (length === set.size) return `${name(start)} to ${name(end)}`;
  }
  const sorted = [...set].sort((a, b) => a - b).map(name);
  return `${sorted.slice(0, -1).join(", ")} and ${sorted.at(-1)}`;
}

// "2026-06" → "June 2026".
const monthInWords = (month: string) =>
  `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

// A term in words, each value shown by `show`: a limit reads "2,000,000
// (2,500,000 October to March); from June 2026, 3,000,000", an advance rate
// "75%; from June 2026, 70%".
export function termInWords(
  term: Term,
  show: (value: string) => string = showAmount,
): string {
  const seasons = (list: Term["seasons"]) =>
    list?.length
      ? ` (${list.map((s) => `${show(s.value)} ${monthsInWords(s.months)}`).join(", ")})`
      : "";
  return [
    `${show(term.value)}${seasons(term.seasons)}`,
    ...(term.steps ?? []).map(
      (s) =>
        `from ${monthInWords(s.from)}, ${show(s.value)}${seasons(s.seasons)}`,
    ),
  ].join("; ");
}

export const limitInWords = (term: Term) => termInWords(term);

// A term as the tools take it, so it can be sent back with a step or a
// season changed; each value typed by `show`.
export function termAsTyped(
  term: Term,
  show: (value: string) => string = showAmount,
) {
  const seasons = (list: Term["seasons"]) =>
    list?.length
      ? {
          seasons: list.map((s) => ({
            months: s.months,
            value: show(s.value),
          })),
        }
      : {};
  return {
    value: show(term.value),
    ...seasons(term.seasons),
    ...(term.steps?.length
      ? {
          steps: term.steps.map((s) => ({
            from: s.from,
            value: show(s.value),
            ...seasons(s.seasons),
          })),
        }
      : {}),
  };
}

// A fraction kept by the app, typed back exactly with its percent sign: a
// share of 100% kept as "1" would otherwise read as 1%.
export const typedPercent = (fraction: string) =>
  `${new Dec(fraction).times(100).toFixed()}%`;

// A line's terms: its limit in words, and as the tools take it when it
// changes by season or step.
function describeTerms(line: LineTerms) {
  return {
    name: line.name,
    currency: line.currency,
    limit: limitInWords(line.limit),
    ...(isPlain(line.limit) ? {} : { limitTerm: termAsTyped(line.limit) }),
    rate: showRate(line.rate),
  };
}

// The borrower's lines of credit, or a consolidated client's members'.
export const describeCreditLines = (lines: readonly OwnedLine[]) =>
  lines.map((line) => ({
    id: line.id,
    ...(line.member ? { member: line.member.name } : {}),
    ...describeTerms(line),
    ...(line.closedOn ? { closedOn: line.closedOn } : {}),
  }));

// The usage assumed for a line: its average share of the limit, and amounts
// drawn by month; null when none is.
export function describeUsage(usage: LineUsage[string] | undefined) {
  if (!usage) return null;
  return {
    ...(usage.share !== undefined
      ? { averageUsage: showRate(usage.share) }
      : {}),
    ...(usage.months
      ? {
          months: Object.fromEntries(
            Object.entries(usage.months)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([month, value]) => [month, showAmount(value)]),
          ),
        }
      : {}),
  };
}

// The lines in force as an analysis reads them, with the usage it assumes
// for each in its base case and every scenario.
export const describeLinesInAnalysis = (
  inForce: readonly OwnedLine[],
  usage: LineUsage,
) =>
  describeCreditLines(inForce).map((line) => ({
    ...line,
    usage: describeUsage(usage[line.id]),
  }));

// What a proposed line changes of the line in force: the fields that
// differ, as they are in force.
function changesFrom(line: LineTerms, was: LineTerms) {
  return {
    ...(line.name !== was.name ? { name: was.name } : {}),
    ...(line.currency !== was.currency ? { currency: was.currency } : {}),
    ...(JSON.stringify(line.limit) !== JSON.stringify(was.limit)
      ? { limit: limitInWords(was.limit) }
      : {}),
    ...(!new Dec(line.rate).eq(was.rate) ? { rate: showRate(was.rate) } : {}),
  };
}

function describeProposed(
  lines: readonly ProposedLine[],
  inForce: readonly OwnedLine[],
) {
  return lines.map((line) => {
    const was = inForce.find((l) => l.id === line.id);
    const changes = was && !line.closed ? changesFrom(line, was) : {};
    const changed = Object.keys(changes).length > 0;
    return {
      id: line.id,
      ...describeTerms(line),
      change: !was
        ? "new line"
        : line.closed
          ? "closed at the deal"
          : changed
            ? "changed"
            : "as in force",
      // What it changes, as the line is in force.
      ...(changed ? { inForce: changes } : {}),
    };
  });
}

// A scenario's lines of credit: the usage it assumes over the analysis's,
// and the lines its deal proposes.
export function describeScenarioLines(
  s: Scenario,
  inForce: readonly OwnedLine[],
) {
  const names = new Map(
    [...inForce, ...(s.lines ?? [])].map((l) => [l.id, l.name]),
  );
  return {
    // Over the analysis's: a share replaces its share, months replace its
    // months one by one.
    lineOfCreditUsage: Object.entries(s.lineUsage).map(([id, usage]) => ({
      lineId: id,
      line: names.get(id) ?? id,
      ...describeUsage(usage),
    })),
    // The deal's lines; null keeps the lines in force.
    proposedLinesOfCredit: s.lines && describeProposed(s.lines, inForce),
    ...(s.lines
      ? {
          proposedLinesApply: s.project
            ? "post-project, from the project's closing; the scenario as is keeps the lines in force"
            : "from the first projected month",
        }
      : {}),
  };
}

// A line as a scenario's proposal sends it back: its terms as kept, rates
// typed exactly.
const asTyped = (line: LineTerms) => ({
  id: line.id,
  name: line.name,
  currency: line.currency,
  limit: line.limit,
  rate: typedPercent(line.rate),
  ...(line.closed ? { closed: true } : {}),
});

// A usage as kept, typed back exactly.
interface TypedUsage {
  share?: string;
  months?: Record<string, string>;
}
const usageAsTyped = (usage: LineUsage[string]): TypedUsage => ({
  ...(usage.share !== undefined ? { share: typedPercent(usage.share) } : {}),
  ...(usage.months ? { months: { ...usage.months } } : {}),
});

const lineId = z.string().describe("The line's id, from get_borrower.");

const fields = {
  name: z.string().describe('e.g. "Operating line" or "USD line".'),
  currency: z
    .string()
    .describe('Its currency code, e.g. "USD"; "CAD" when omitted.'),
  rate: rate("Its annual rate"),
  closedOn: date(
    "The day it was closed: analyses count it up to that month, and no longer after",
  ),
  certificateDueDays: z
    .number()
    .int()
    .min(0)
    .max(120)
    .describe(
      "For a margined line: days after each month's end the client's borrowing base certificate is due, e.g. 20. A month past due with no figures is flagged as overdue.",
    ),
};

// A consolidated client's lines are its members', keyed "member/line".
function ownLine(id: string) {
  if (id.includes("/"))
    throw invalid(
      "That's a member's line as its consolidated client reads it. Change it on the member: get_borrower on the member gives the line's own id.",
    );
  return id;
}

export function creditLineTools(server: McpServer, db: Db, ctx: Context) {
  // The borrower's lines after an edit, and the line it was about, with
  // when its certificates are due.
  const after = async (entityId: string, edited?: CreditLine) => {
    const [entity, lines] = await Promise.all([
      getEntity(db, ctx, entityId),
      getCreditLines(db, ctx, entityId),
    ]);
    const described = describeCreditLines(lines);
    const line = edited && described.find((l) => l.id === edited.id);
    return {
      borrower: entity.name,
      ...(line
        ? {
            line: {
              ...line,
              ...(edited.certificateDueDays !== null
                ? { certificateDueDays: edited.certificateDueDays }
                : {}),
            },
          }
        : {}),
      linesOfCredit: described,
    };
  };

  // The lines in force where a scenario's analysis is: the borrower's, or a
  // consolidated client's members'.
  const inForceFor = async (scenario: Scenario) => {
    const { entity } = await getAnalysis(db, ctx, scenario.analysisId);
    return getCreditLines(db, ctx, entity.id);
  };

  // A scenario's lines after an edit, and the line it was about.
  const proposalAfter = (
    scenario: Scenario,
    inForce: readonly OwnedLine[],
    id?: string,
  ) => {
    const described = describeScenarioLines(scenario, inForce);
    const line =
      id && described.proposedLinesOfCredit?.find((l) => l.id === id);
    return { scenario: scenario.name, ...(line ? { line } : {}), ...described };
  };

  server.registerTool(
    "add_line_of_credit",
    {
      title: "Add a line of credit",
      description:
        "Adds a line of credit the borrower has, with its terms in force: its authorized limit, which can differ by season every year and step from a month, and its annual rate. A deal's new or changed line belongs to its scenario instead (set_proposed_line). Analyses count its interest on the usage they assume (set_line_usage). A consolidated client's lines are its members': add it to the member that borrows it. Don't invent terms the user hasn't given.",
      inputSchema: z.object({
        borrowerId,
        name: fields.name,
        currency: fields.currency.optional(),
        limit,
        rate: fields.rate,
        closedOn: fields.closedOn.optional(),
        certificateDueDays: fields.certificateDueDays.optional(),
      }),
      annotations: ADD,
    },
    ({ borrowerId, ...input }) =>
      respond(async () => {
        const line = await addCreditLine(db, ctx, borrowerId, input);
        return after(line.entityId, line);
      }),
  );

  server.registerTool(
    "update_line_of_credit",
    {
      title: "Change a line of credit",
      description:
        "Changes some of the terms in force of one of the borrower's lines of credit; the others stay. A limit given replaces the whole limit, its seasons and steps with it: for an amendment from a month, send the limit as it is (limitTerm from get_borrower, or its amount) with a step added. closedOn closes the line on that day, and analyses no longer count it after that month; null reopens it. certificateDueDays says when a margined line's certificates are due; null for no due date. What a deal would change goes in its scenario instead (set_proposed_line); a borrowing base's own terms change with set_borrowing_base_term.",
      inputSchema: z.object({
        lineId,
        name: fields.name.optional(),
        currency: fields.currency.optional(),
        limit: limit.optional(),
        rate: fields.rate.optional(),
        closedOn: fields.closedOn.nullable().optional(),
        certificateDueDays: fields.certificateDueDays.nullable().optional(),
      }),
      annotations: CHANGE,
    },
    ({ lineId, ...patch }) =>
      respond(async () => {
        if (Object.values(patch).every((v) => v === undefined))
          throw invalid("Give at least one field to change.");
        const line = await updateCreditLine(db, ctx, ownLine(lineId), patch);
        return after(line.entityId, line);
      }),
  );

  server.registerTool(
    "remove_line_of_credit",
    {
      title: "Remove a line of credit",
      description:
        "Deletes one of the borrower's lines of credit. A line repaid and cancelled is usually better closed (update_line_of_credit with closedOn), so analyses of the years it was open still count its interest; delete only a line entered by mistake. Confirm with the user first.",
      inputSchema: z.object({ lineId }),
      annotations: CHANGE,
    },
    ({ lineId }) =>
      respond(async () => {
        const line = await getCreditLine(db, ctx, ownLine(lineId));
        await removeCreditLine(db, ctx, line.id);
        return { removed: line.name, ...(await after(line.entityId)) };
      }),
  );

  server.registerTool(
    "set_line_usage",
    {
      title: "Set a line of credit's usage",
      description: [
        "Sets the usage assumed for one line of credit, which its interest comes from: an analysis's (analysisId), which its base case and every scenario assume, or one scenario's (scenarioId), over the analysis's.",
        'A share of the limit ("60%") applies every month and follows a seasonal or stepped limit; any month can instead be an amount drawn ({"2025-11": "3,400,000"}). Each month\'s interest is its usage at the line\'s rate, over 12. It counts in projected years and, post-project, in the twelve months after closing; actual years keep the statements\' interest.',
        "Months given are set and the others stay; a null month removes it, and a null share removes the share. In a scenario, its share replaces the analysis's and its months replace the analysis's month by month; removing them falls back on the analysis's.",
        "A line with no usage counts no interest, and run_analysis flags it. Ask the user for the usage rather than inventing it; the spread's bank indebtedness against the limit at year end is a starting point to suggest.",
      ].join(" "),
      inputSchema: z.object({
        analysisId: z
          .string()
          .optional()
          .describe(
            "For the analysis's usage, from list_analyses or get_borrower.",
          ),
        scenarioId: scenarioId
          .optional()
          .describe(
            "For a scenario's usage, over the analysis's; the only place a new line the scenario proposes takes its usage.",
          ),
        lineId: z
          .string()
          .describe(
            "A line of credit, from get_analysis: one in force, or one the scenario proposes.",
          ),
        share: z
          .string()
          .nullable()
          .optional()
          .describe(
            'The average drawn, as a share of the limit with its percent sign: "60%". null removes it.',
          ),
        months: z
          .record(z.string(), amount("The amount drawn that month").nullable())
          .optional()
          .describe(
            'Month "YYYY-MM" → the amount drawn that month instead of the share, e.g. {"2025-11": "3,400,000", "2025-12": null}; null removes a month.',
          ),
      }),
      annotations: CHANGE,
    },
    ({ analysisId, scenarioId, lineId, share, months }) =>
      respond(async () => {
        if (!analysisId === !scenarioId)
          throw invalid(
            "Pass analysisId for the analysis's usage, which its base case and scenarios assume, or scenarioId for one scenario's.",
          );
        if (share === undefined && months === undefined)
          throw invalid("Give a share, months, or both.");
        const scenario = scenarioId
          ? await getScenario(db, ctx, scenarioId)
          : null;
        const detail = await getAnalysis(
          db,
          ctx,
          scenario?.analysisId ?? analysisId!,
        );
        const inForce = await getCreditLines(db, ctx, detail.entity.id);
        const lines: LineTerms[] = [
          ...inForce,
          ...(scenario?.lines ?? []).filter(
            (l) => !inForce.some((f) => f.id === l.id),
          ),
        ];
        const line = lines.find((l) => l.id === lineId);
        if (!line)
          throw invalid(
            scenario
              ? "That isn't one of the borrower's lines of credit or a new line the scenario proposes."
              : "That isn't one of the borrower's lines of credit. A new line a scenario proposes takes its usage in that scenario.",
          );
        // Usage kept for lines no longer there is dropped.
        const typed: Record<string, TypedUsage> = {};
        for (const [id, usage] of Object.entries(
          scenario?.lineUsage ?? detail.analysis.lineUsage,
        ))
          if (lines.some((l) => l.id === id)) typed[id] = usageAsTyped(usage);
        const own = typed[lineId] ?? {};
        const byMonth: Record<string, string> = { ...own.months };
        for (const [raw, value] of Object.entries(months ?? {})) {
          const month = parseMonth(raw, line.name);
          if (value === null || !String(value).trim()) delete byMonth[month];
          else byMonth[month] = String(value);
        }
        const kept = share === undefined ? own.share : share;
        typed[lineId] = {
          ...(kept !== undefined && kept !== null ? { share: kept } : {}),
          months: byMonth,
        };
        if (scenario) {
          const updated = await updateScenario(db, ctx, scenario.id, {
            lineUsage: typed,
          });
          const usage = mergeLineUsage(
            detail.analysis.lineUsage,
            updated.lineUsage,
          );
          return {
            scenario: updated.name,
            line: line.name,
            // The scenario's own, over the analysis's.
            override: describeUsage(updated.lineUsage[lineId]),
            // What the scenario assumes; null counts no interest.
            usage: describeUsage(usage[lineId]),
          };
        }
        const updated = await updateAnalysis(db, ctx, detail.analysis.id, {
          lineUsage: typed,
        });
        return {
          analysis: updated.name,
          line: line.name,
          // null counts no interest.
          usage: describeUsage(updated.lineUsage[lineId]),
        };
      }),
  );

  server.registerTool(
    "set_proposed_line",
    {
      title: "Propose a line of credit for a deal",
      description: [
        "Proposes a line of credit for a scenario's deal: a line in force (its lineId) with a new limit, rate, name or currency, or closed at the deal (closed: true); or, without lineId, a new line, which needs its name, limit and rate. Fields not given keep the line's terms.",
        "With a project, proposed lines apply post-project from closing (PROFORMA_LINE_INTEREST is the interest they add); without one, as in a stress, from the first projected month.",
        "A scenario with no proposal starts from a copy of the lines in force; lines in force it doesn't change stay as they are. A new line counts no interest until set_line_usage gives it a usage in the scenario. Returns the line with its id.",
      ].join(" "),
      inputSchema: z.object({
        scenarioId,
        lineId: z
          .string()
          .optional()
          .describe(
            "A line in force (from get_borrower or get_analysis), or one the scenario already proposes (from get_analysis); omitted for a new line.",
          ),
        name: fields.name.optional(),
        currency: fields.currency.optional(),
        limit: limit.optional(),
        rate: fields.rate.optional(),
        closed: z
          .boolean()
          .optional()
          .describe(
            "true closes a line in force at the deal, e.g. one the deal refinances; false keeps it open.",
          ),
      }),
      annotations: CHANGE,
    },
    ({ scenarioId, lineId, ...given }) =>
      respond(async () => {
        const scenario = await getScenario(db, ctx, scenarioId);
        const inForce = await inForceFor(scenario);
        const proposal: LineTerms[] =
          scenario.lines ?? inForce.filter((l) => !l.closedOn);
        const was = inForce.find((l) => l.id === lineId);
        const current =
          lineId === undefined
            ? undefined
            : (proposal.find((l) => l.id === lineId) ?? was);
        if (lineId !== undefined && !current)
          throw invalid(
            "That isn't one of the borrower's lines of credit or the scenario's proposed lines. Leave lineId out for a new line.",
          );
        if (was?.closedOn)
          throw invalid(
            `${was.name} was closed on ${was.closedOn}: propose a new line instead.`,
          );
        if (!was && given.closed)
          throw invalid(
            "Only a line in force can be closed at the deal; remove_proposed_line drops a new one.",
          );
        if (current && Object.values(given).every((v) => v === undefined))
          throw invalid("Give at least one field to change.");
        const line = {
          id: lineId,
          name: given.name ?? current?.name,
          currency: given.currency ?? current?.currency,
          limit: given.limit ?? current?.limit,
          rate: given.rate ?? (current && typedPercent(current.rate)),
          closed: given.closed ?? current?.closed,
        };
        const listed = proposal.some((l) => l.id === lineId);
        const updated = await updateScenario(db, ctx, scenarioId, {
          lines: listed
            ? proposal.map((l) => (l.id === lineId ? line : asTyped(l)))
            : [...proposal.map(asTyped), line],
        });
        const id =
          lineId ??
          updated.lines!.find((l) => !proposal.some((p) => p.id === l.id))!.id;
        return proposalAfter(updated, inForce, id);
      }),
  );

  server.registerTool(
    "remove_proposed_line",
    {
      title: "Drop a line from a deal's proposal",
      description:
        "Drops a line of credit from a scenario's proposal: a line in force goes back to its terms in force, and a new line goes away with the usage assumed for it. When what's left changes nothing, the scenario uses the lines in force again. Confirm with the user first.",
      inputSchema: z.object({
        scenarioId,
        lineId: z
          .string()
          .describe("A line the scenario proposes, from get_analysis."),
      }),
      annotations: CHANGE,
    },
    ({ scenarioId, lineId }) =>
      respond(async () => {
        const scenario = await getScenario(db, ctx, scenarioId);
        if (!scenario.lines?.some((l) => l.id === lineId))
          throw invalid(
            scenario.lines
              ? "The scenario doesn't propose that line."
              : "The scenario proposes no lines of credit: it uses the lines in force.",
          );
        const inForce = await inForceFor(scenario);
        const rest = scenario.lines.filter((l) => l.id !== lineId);
        // Copies of the lines in force change nothing, so they go too.
        const changesNothing = rest.every((l) => {
          const was = inForce.find((f) => f.id === l.id);
          return (
            was &&
            !was.closedOn &&
            !l.closed &&
            !Object.keys(changesFrom(l, was)).length
          );
        });
        const updated = await updateScenario(db, ctx, scenarioId, {
          lines: changesNothing ? null : rest.map(asTyped),
        });
        return proposalAfter(updated, inForce);
      }),
  );

  server.registerTool(
    "use_lines_in_force",
    {
      title: "Use the lines of credit in force in a scenario",
      description:
        "Drops a scenario's proposed lines of credit, so it uses the lines in force again. Usage assumed for its new lines goes with them; its usage of the lines in force stays.",
      inputSchema: z.object({ scenarioId }),
      annotations: CHANGE,
    },
    ({ scenarioId }) =>
      respond(async () => {
        const scenario = await getScenario(db, ctx, scenarioId);
        const updated = await updateScenario(db, ctx, scenarioId, {
          lines: null,
        });
        return proposalAfter(updated, await inForceFor(scenario));
      }),
  );
}
