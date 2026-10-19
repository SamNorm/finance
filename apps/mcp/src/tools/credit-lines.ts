import type { Db } from "@finance/db";
import {
  addCreditLine,
  analysisCurrency,
  getAnalysis,
  getCreditLine,
  getCreditLines,
  getEntity,
  getScenario,
  getSpread,
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
  type BorrowingBaseDefinition,
} from "@finance/domain";
import { Dec } from "@finance/engine";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import {
  amount,
  borrowerId,
  date,
  limit,
  rate,
  scenarioId,
  term,
} from "../fields";
import { amount as showAmount, rate as showRate } from "../format";
import {
  dealTermsAsTyped,
  definitionAsTyped,
  definitionInput,
  describeDealTerms,
  describeDefinition,
  marginedDefinitions,
} from "../borrowing-bases";
import { limitInWords, termAsTyped, typedPercent } from "../terms";
import { ADD, CHANGE, invalid, respond } from "../respond";

// A borrower's lines of credit (borrowing-base-plan.md §4): what's real, kept
// a line at a time as its existing loans are. Analyses count their interest
// on the usage they assume, a share of the limit with any month's amount
// drawn instead; a scenario can override that usage and propose the deal's
// lines, as it proposes covenants.

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

// Margined lines' definitions, by the key analyses know them by.
type Definitions = ReadonlyMap<
  string,
  { name: string; definition: BorrowingBaseDefinition }
>;

const hasDealTerms = (line: ProposedLine) =>
  Object.keys(line.terms ?? {}).length > 0;

function describeProposed(
  lines: readonly ProposedLine[],
  inForce: readonly OwnedLine[],
  definitions: Definitions,
) {
  return lines.map((line) => {
    const was = inForce.find((l) => l.id === line.id);
    const changes = was && !line.closed ? changesFrom(line, was) : {};
    const changed = Object.keys(changes).length > 0 || hasDealTerms(line);
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
      ...(Object.keys(changes).length ? { inForce: changes } : {}),
      // Its borrowing base's terms as the deal changes them.
      ...(hasDealTerms(line)
        ? {
            borrowingBaseTerms: describeDealTerms(
              line.terms,
              definitions.get(line.id)?.definition ?? line.borrowingBase,
            ),
          }
        : {}),
      // A new margined line's borrowing base.
      ...(line.borrowingBase
        ? { borrowingBase: describeDefinition(line.borrowingBase) }
        : {}),
    };
  });
}

// A scenario's lines of credit: the usage it assumes over the analysis's,
// and the lines its deal proposes.
export function describeScenarioLines(
  s: Scenario,
  inForce: readonly OwnedLine[],
  definitions: Definitions = new Map(),
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
    // Over the analysis's, currency by currency.
    exchangeRates: s.exchangeRates,
    // The deal's lines; null keeps the lines in force.
    proposedLinesOfCredit:
      s.lines && describeProposed(s.lines, inForce, definitions),
    ...(s.lines
      ? {
          proposedLinesApply: s.project
            ? "post-project, from the project's closing; the scenario as is keeps the lines in force"
            : "from the first projected month",
        }
      : {}),
  };
}

// A line as a scenario's proposes it, or a line in force it starts from.
type Proposable = LineTerms &
  Partial<Pick<ProposedLine, "terms" | "borrowingBase">>;

// A line as a scenario's proposal sends it back: its terms as kept, its
// borrowing base's too, rates typed exactly.
const asTyped = (line: Proposable) => ({
  id: line.id,
  name: line.name,
  currency: line.currency,
  limit: line.limit,
  rate: typedPercent(line.rate),
  ...(line.closed ? { closed: true } : {}),
  ...(line.terms && Object.keys(line.terms).length
    ? { terms: dealTermsAsTyped(line.terms) }
    : {}),
  ...(line.borrowingBase
    ? { borrowingBase: definitionAsTyped(line.borrowingBase) }
    : {}),
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
  // consolidated client's members'; and the margined ones' definitions.
  const inForceFor = async (scenario: Scenario) => {
    const { entity } = await getAnalysis(db, ctx, scenario.analysisId);
    const [lines, definitions] = await Promise.all([
      getCreditLines(db, ctx, entity.id),
      marginedDefinitions(db, ctx, entity.id),
    ]);
    return { lines, definitions };
  };

  // A scenario's lines after an edit, and the line it was about.
  const proposalAfter = (
    scenario: Scenario,
    { lines: inForce, definitions }: Awaited<ReturnType<typeof inForceFor>>,
    id?: string,
  ) => {
    const described = describeScenarioLines(scenario, inForce, definitions);
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
    "set_exchange_rates",
    {
      title: "Set exchange rates for lines of credit",
      description: [
        "Sets the rates converting lines of credit in another currency into the analysis's, its statements' currency (get_analysis gives it): an analysis's (analysisId), which its base case and every scenario use, or one scenario's (scenarioId), over the analysis's, such as to stress a weaker Canadian dollar.",
        'A rate is the analysis\'s currency for one unit of the line\'s: {"USD": "1.37"} in a CAD analysis. The line\'s interest, limit and average usage convert at it; its usage, entered with set_line_usage, and its borrowing base stay in its own currency.',
        "Currencies given are set and the others stay; null removes one. A line in another currency with no rate counts nothing, and run_analysis flags it. Ask the user for the rate rather than inventing it.",
      ].join(" "),
      inputSchema: z.object({
        analysisId: z
          .string()
          .optional()
          .describe(
            "For the analysis's rates, from list_analyses or get_borrower.",
          ),
        scenarioId: scenarioId
          .optional()
          .describe("For a scenario's rates, over the analysis's."),
        rates: z
          .record(z.string(), z.string().nullable())
          .describe(
            'Currency code → the analysis\'s currency for one unit of it, e.g. {"USD": "1.37"}; null removes it.',
          ),
      }),
      annotations: CHANGE,
    },
    ({ analysisId, scenarioId, rates }) =>
      respond(async () => {
        if (!analysisId === !scenarioId)
          throw invalid(
            "Pass analysisId for the analysis's rates, which its base case and scenarios use, or scenarioId for one scenario's.",
          );
        const scenario = scenarioId
          ? await getScenario(db, ctx, scenarioId)
          : null;
        const detail = await getAnalysis(
          db,
          ctx,
          scenario?.analysisId ?? analysisId!,
        );
        const currency = analysisCurrency(
          await getSpread(db, ctx, detail.entity.id),
          detail.analysis,
        );
        const own: Record<string, string> = {
          ...(scenario?.exchangeRates ?? detail.analysis.exchangeRates),
        };
        for (const [raw, rate] of Object.entries(rates)) {
          const code = raw.trim().toUpperCase();
          if (code === currency)
            throw invalid(
              `${currency} is the analysis's currency: lines in it need no rate.`,
            );
          if (rate === null || !rate.trim()) delete own[code];
          else own[code] = rate;
        }
        if (scenario) {
          const updated = await updateScenario(db, ctx, scenario.id, {
            exchangeRates: own,
          });
          return {
            scenario: updated.name,
            currency,
            // The scenario's own, and what it uses with the analysis's.
            rates: updated.exchangeRates,
            applied: {
              ...detail.analysis.exchangeRates,
              ...updated.exchangeRates,
            },
          };
        }
        const updated = await updateAnalysis(db, ctx, detail.analysis.id, {
          exchangeRates: own,
        });
        return {
          analysis: updated.name,
          currency,
          rates: updated.exchangeRates,
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
        "For a margined line, terms changes its borrowing base's advance rates, caps and reserves in the deal, by the borrowing base's line codes; they apply when the proposed lines do, and run_analysis_borrowing_bases shows the line with them and as is. A new line can be margined with borrowingBase, a whole definition; a line in force keeps its own.",
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
        terms: z
          .record(
            z.string(),
            z
              .object({
                rate: term.optional().describe('An advance rate, "80%".'),
                cap: term
                  .nullable()
                  .optional()
                  .describe("A cap; null removes the cap in the deal."),
                amount: term.optional().describe("A reserve's set amount."),
              })
              .nullable(),
          )
          .optional()
          .describe(
            'The deal\'s borrowing base terms, by the borrowing base\'s line code (from get_borrowing_base): {"AR": {"rate": "80%"}, "INVENTORY": {"cap": "1,500,000"}}. A code given replaces that code\'s terms in the proposal, others stay; null drops a code\'s changes. Collateral takes rate and cap, a group cap, a reserve with a set amount its amount.',
          ),
        borrowingBase: definitionInput
          .nullable()
          .optional()
          .describe(
            "A new line's borrowing base, a whole definition as set_borrowing_base_definition takes it; null leaves the new line unmargined.",
          ),
      }),
      annotations: CHANGE,
    },
    ({ scenarioId, lineId, terms, borrowingBase, ...given }) =>
      respond(async () => {
        const scenario = await getScenario(db, ctx, scenarioId);
        const inForceNow = await inForceFor(scenario);
        const inForce = inForceNow.lines;
        const proposal: Proposable[] =
          scenario.lines ?? inForce.filter((l) => !l.closedOn);
        const was = inForce.find((l) => l.id === lineId);
        const current: Proposable | undefined =
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
        if (
          current &&
          terms === undefined &&
          borrowingBase === undefined &&
          Object.values(given).every((v) => v === undefined)
        )
          throw invalid("Give at least one field to change.");
        if (was && borrowingBase !== undefined)
          throw invalid(
            `${was.name} is in force: it keeps its own borrowing base. Change its terms in the deal with terms, or its definition with set_borrowing_base_definition.`,
          );
        // Codes given replace theirs; null drops a code's changes.
        const dealTerms: Record<string, unknown> = dealTermsAsTyped(
          current?.terms ?? {},
        );
        for (const [code, t] of Object.entries(terms ?? {})) {
          const key = code.trim().toUpperCase();
          if (t === null) delete dealTerms[key];
          else dealTerms[key] = t;
        }
        const definition =
          borrowingBase === undefined
            ? current?.borrowingBase && definitionAsTyped(current.borrowingBase)
            : borrowingBase;
        const line = {
          id: lineId,
          name: given.name ?? current?.name,
          currency: given.currency ?? current?.currency,
          limit: given.limit ?? current?.limit,
          rate: given.rate ?? (current && typedPercent(current.rate)),
          closed: given.closed ?? current?.closed,
          ...(Object.keys(dealTerms).length ? { terms: dealTerms } : {}),
          ...(definition ? { borrowingBase: definition } : {}),
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
        return proposalAfter(updated, inForceNow, id);
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
        const inForceNow = await inForceFor(scenario);
        const inForce = inForceNow.lines;
        const rest = scenario.lines.filter((l) => l.id !== lineId);
        // Copies of the lines in force change nothing, so they go too.
        const changesNothing = rest.every((l) => {
          const was = inForce.find((f) => f.id === l.id);
          return (
            was &&
            !was.closedOn &&
            !l.closed &&
            !hasDealTerms(l) &&
            !Object.keys(changesFrom(l, was)).length
          );
        });
        const updated = await updateScenario(db, ctx, scenarioId, {
          lines: changesNothing ? null : rest.map(asTyped),
        });
        return proposalAfter(updated, inForceNow);
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
