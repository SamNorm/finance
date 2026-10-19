import type { Db } from "@finance/db";
import {
  BUILT_IN_BORROWING_BASES,
  COLLATERAL_CODES,
  DEFAULT_BUCKETS,
  DEFAULT_INELIGIBLE_FROM,
  LINE_KINDS,
  TOTALS,
  borrowingBaseIssues,
  compileBorrowingBase,
  getBorrowingBase,
  getCreditLine,
  getCreditLines,
  importBorrowingBasePaste,
  listBorrowingBaseTemplates,
  listBorrowingBases,
  parseBorrowingBasePaste,
  parseMonth,
  parseValue,
  removeBorrowingBaseMonth,
  runBorrowingBase,
  runBorrowingBaseOf,
  setBorrowingBaseDefinition,
  setBorrowingBaseMonth,
  setBorrowingBaseTerm,
  setBorrowingBaseValues,
  startBorrowingBase,
  type BorrowingBaseLineKind,
  type BorrowingBaseMonthInput,
  type Context,
  type CycleSummary,
  type Issue,
  type Term,
} from "@finance/domain";
import { FUNCTIONS } from "@finance/engine";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { borrowerId } from "../fields";
import { amount as showAmount, figure, rate as showRate } from "../format";
import { CHANGE, invalid, matches, READ, respond } from "../respond";
import {
  definitionAsTyped,
  definitionInput,
  describeDefinition,
  describeEntered,
  describeLatest,
  describeRun,
  figureIn,
  issueText,
  issuesOf,
  shown,
} from "../borrowing-bases";
import { MONTHS, termInWords } from "../terms";
import { fingerprint } from "./spreads";

// A margined line's borrowing base (borrowing-base-plan.md §5–§7): its
// definition, typed lines the app turns into the waterfall, and its monthly
// history from the client's certificates. The AI transcribes the client's
// figures; the app computes the borrowing base, the surplus and the tests.

const lineId = z
  .string()
  .describe(
    "The line of credit's id, from get_borrower or list_borrowing_bases.",
  );
const month = z.string().describe('The month, as YYYY-MM: "2025-11".');

// A consolidated client reads its members' lines as "member/line"; the
// borrowing base is the member's line's own.
const own = (id: string) => id.slice(id.lastIndexOf("/") + 1);

// What each kind of line takes in a definition, besides kind, code, label
// and description.
const TAKES: Record<BorrowingBaseLineKind, Record<string, string>> = {
  collateral: {
    collateral:
      '"receivables", "inventory" or "other" (the default): what a consolidated client adds it up as.',
    rate: 'The advance rate, a term: "75%".',
    cap: "Optional: the most it lends, a term, in the line of credit's currency; conversion comes before the cap.",
    group: "Optional: the code of the group it adds up in.",
    currency:
      "Optional, when not the line of credit's: \"USD\". Its figures and its ineligibles are entered in it, then converted at the month's rate (FX.USD).",
    aging: `Optional: true for buckets ${DEFAULT_BUCKETS.join(", ")}, ${DEFAULT_BUCKETS[DEFAULT_INELIGIBLE_FROM]} and over ineligible; or {"buckets": [labels], "ineligibleFrom": n}, the first n buckets eligible. Its amount is then its buckets added up, entered as X.AGE1, X.AGE2…`,
    reconcilesWith:
      'Optional: the spread item it\'s part of, e.g. "AR_TRADE" or "INVENTORY", compared with the spread at its period ends.',
    formula: "Optional: its amount as a formula, instead of entered; not aged.",
  },
  group: {
    collateral: '"receivables", "inventory" or "other" (the default).',
    cap: "Optional: the most its lines lend together, a term.",
  },
  ineligible: {
    of: "The collateral line it reduces, by code; in that line's currency.",
    formula: 'Optional, instead of entered: "AR * 5%".',
  },
  prior_claim: {
    currency: "Optional, when not the line of credit's.",
    formula: "Optional, instead of entered.",
  },
  reserve: {
    amount: 'Optional: a set amount, a term, e.g. "100,000".',
    formula:
      "Optional, instead of a set amount. With neither, it's entered each month.",
  },
  usage: {
    currency: "Optional, when not the line of credit's.",
    reconcilesWith: "Optional: the spread item it's part of.",
  },
  driver: {
    format: "amount (the default), percent, ratio, count or flag.",
  },
  assumption: {
    format: "percent (the default), amount, ratio, count or flag.",
    value: 'Its value, e.g. "10%".',
    byMonth:
      "Optional: 12 values, January first, for a seasonal profile; a blank takes value.",
  },
  calculation: {
    format: "amount (the default), percent, ratio, count or flag.",
    formula: 'Required, e.g. "IFERROR(AR / SALES * 30, 0)".',
  },
};

const EXAMPLE = {
  lines: [
    {
      kind: "collateral",
      code: "AR",
      label: "Receivables",
      collateral: "receivables",
      aging: true,
      rate: "75%",
      reconcilesWith: "AR_TRADE",
    },
    { kind: "ineligible", code: "AR_CONTRAS", label: "Contras", of: "AR" },
    {
      kind: "collateral",
      code: "AR_USD",
      label: "Receivables, USD",
      collateral: "receivables",
      currency: "USD",
      rate: "75%",
    },
    {
      kind: "collateral",
      code: "INVENTORY",
      label: "Inventory",
      collateral: "inventory",
      rate: { value: "50%", steps: [{ from: "2026-06", value: "45%" }] },
      cap: "1,000,000",
    },
    {
      kind: "prior_claim",
      code: "SOURCE_DEDUCTIONS",
      label: "Source deductions",
    },
    { kind: "usage", code: "LCS", label: "Letters of credit" },
  ],
  outstandingReconcilesWith: "BANK_INDEBTEDNESS",
  tests: [
    {
      name: "Minimum excess availability",
      metric: "BB_EXCESS",
      test: "min",
      threshold: "250,000",
    },
  ],
};

// A term as typed: the same shape as a line of credit's limit.
const TERMS =
  'A term is a value, or {"value", "seasons", "steps"}: seasons [{"months": "10-3" or [10, 11, 12, 1, 2, 3], "value"}] differ in those calendar months every year; steps [{"from": "2026-06", "value", "seasons"}] change it from a month, an amendment, replacing the value and seasons before it. Rates and percentages take their percent sign: "75%".';

// Functions that read annual periods mean nothing month by month.
const ANNUAL_ONLY = new Set(["CAGR", "TTM"]);

// The months of a run to show: from and to, or the last twelve.
function monthRange(
  months: readonly { month: string }[],
  from?: string,
  to?: string,
) {
  const first = from && parseMonth(from, "from");
  const last = to && parseMonth(to, "to");
  const all = months.map((_, p) => p);
  if (!first && !last) return all.slice(-12);
  return all.filter(
    (p) =>
      (!first || months[p]!.month >= first) &&
      (!last || months[p]!.month <= last),
  );
}

export function borrowingBaseTools(server: McpServer, db: Db, ctx: Context) {
  // A line's borrowing base after it's set up: its definition, the codes
  // entered each month, and the warnings it was saved with.
  const setUp = async (
    id: string,
    issues: readonly Issue[],
    extra: Record<string, unknown> = {},
  ) => {
    const detail = await getBorrowingBase(db, ctx, id);
    return {
      line: detail.line.name,
      borrower: detail.entity.name,
      ...extra,
      warnings: issues.map((i) => i.message),
      borrowingBase: describeDefinition(detail.definition),
      entered: describeEntered(detail.inputs),
      months: detail.months.length,
    };
  };

  // Months after their figures change: each one's borrowing base, usage and
  // surplus as the app computes them, and its checks.
  const monthsAfter = async (
    id: string,
    months: readonly string[],
    set?: ReadonlyMap<string, readonly string[]>,
  ) => {
    const { detail, run, issues } = await runBorrowingBaseOf(db, ctx, id);
    const formats = new Map(detail.inputs.map((r) => [r.code, r.format]));
    return {
      line: detail.line.name,
      borrower: detail.entity.name,
      months: [...new Set(months)].sort().map((m) => {
        const p = run.months.findIndex((r) => r.month === m);
        const held = detail.months.find((h) => h.month === m);
        const value = (code: string) =>
          p === -1
            ? null
            : figure(run.cells[code]?.[p]?.value ?? null, "amount");
        return {
          month: m,
          quality: held?.quality ?? null,
          ...(set?.has(m)
            ? {
                // As saved; null where cleared.
                figures: Object.fromEntries(
                  set.get(m)!.map((code) => {
                    const raw = held?.figures[code];
                    return [
                      code,
                      raw === undefined
                        ? null
                        : shown(code, formats.get(code) ?? "amount", raw),
                    ];
                  }),
                ),
              }
            : {}),
          borrowingBase: value("BB_TOTAL"),
          usage: value("BB_USAGE"),
          surplus: value("BB_SURPLUS"),
          issues: (issues.byMonth[m] ?? []).map(issueText),
        };
      }),
      ...(issues.general.length
        ? { issues: issues.general.map(issueText) }
        : {}),
    };
  };

  server.registerTool(
    "list_borrowing_bases",
    {
      title: "List borrowing bases",
      description:
        "Every margined line of credit, for monitoring: its borrower, its latest month's borrowing base, limit, usage, surplus (negative when short) and utilization as the app computes them, the months in deficit over the last 12, and the months whose certificate is overdue.",
      inputSchema: z.object({
        borrowerId: borrowerId
          .optional()
          .describe(
            "Only this borrower's lines; a consolidated client's members'.",
          ),
        search: z
          .string()
          .optional()
          .describe("Part of the borrower's or the line's name."),
      }),
      annotations: READ,
    },
    ({ borrowerId, search }) =>
      respond(async () => {
        const lines = borrowerId
          ? new Set(
              (await getCreditLines(db, ctx, borrowerId)).map((l) => own(l.id)),
            )
          : null;
        return (await listBorrowingBases(db, ctx))
          .filter(
            (s) =>
              (!lines || lines.has(s.lineId)) &&
              (matches(s.lineName, search) || matches(s.entity.name, search)),
          )
          .map((s) => ({
            lineId: s.lineId,
            line: s.lineName,
            borrower: s.entity.name,
            borrowerId: s.entity.id,
            currency: s.currency,
            ...describeLatest(s),
          }));
      }),
  );

  server.registerTool(
    "get_borrowing_base",
    {
      title: "Get a line's borrowing base",
      description:
        "A margined line's borrowing base: its definition, lines by kind with advance rates, caps and reserves as terms in words (each step and season); the codes entered each month (set_borrowing_base_values); the months held, with their quality, the date each certificate was received and a note; and its issues (months missing, overdue certificates, a missing exchange rate, gaps with the spread). asTyped adds the definition as set_borrowing_base_definition takes it, to change and send back whole. run_borrowing_base gives the figures.",
      inputSchema: z.object({
        lineId,
        asTyped: z
          .boolean()
          .optional()
          .describe(
            "true adds the definition as set_borrowing_base_definition takes it.",
          ),
      }),
      annotations: READ,
    },
    ({ lineId, asTyped }) =>
      respond(async () => {
        const { detail, issues, overdue } = await runBorrowingBaseOf(
          db,
          ctx,
          own(lineId),
        );
        const { line } = detail;
        return {
          lineId: line.id,
          line: line.name,
          borrower: detail.entity.name,
          currency: line.currency,
          limit: termInWords(line.limit),
          certificateDueDays: line.certificateDueDays,
          borrowingBase: describeDefinition(detail.definition),
          ...(asTyped
            ? { definition: definitionAsTyped(detail.definition) }
            : {}),
          entered: describeEntered(detail.inputs),
          months: detail.months.map((m) => ({
            month: m.month,
            quality: m.quality,
            receivedOn: m.receivedOn,
            note: m.note,
            figures: Object.keys(m.figures).length,
          })),
          overdue,
          issues: issuesOf(issues),
        };
      }),
  );

  server.registerTool(
    "describe_borrowing_base_lines",
    {
      title: "Describe borrowing base lines",
      description:
        "What a borrowing base definition is made of: the kinds of lines and what each takes, how terms are typed, the codes the app computes from them (X.MARGINED, BB_TOTAL…) and the exchange rates entered (FX.USD), the functions formulas can use, how tests are written, an example, and the definitions a line can start from: the app's built-ins and the organization's published templates. Read it before writing a definition with set_borrowing_base_definition.",
      inputSchema: z.object({}),
      annotations: READ,
    },
    () =>
      respond(async () => {
        const templates = await listBorrowingBaseTemplates(db, ctx);
        return {
          lines:
            "Each line has kind, code (a capital letter, then capital letters, digits or underscores, up to 40, e.g. \"AR_CAD\"; codes starting with BB_, and FX, are the app's), label and optionally description, plus what its kind takes. The waterfall follows the kinds, whatever the order; lines show in the definition's order.",
          kinds: Object.entries(LINE_KINDS).map(([kind, { label, help }]) => ({
            kind,
            label,
            help,
            takes: TAKES[kind as BorrowingBaseLineKind],
          })),
          projections:
            "Collateral, ineligibles, prior claims, reserves, usage, drivers and calculations can take projection: the formula an analysis projects the line's months with when the client gave none. By default a line takes the same month a year earlier; an aging bucket or an ineligible its share of its line a year earlier; an exchange rate the last month's. outstandingProjection, on the definition, projects the line's balance: by default a year earlier plus the growth in collateral since.",
          terms: TERMS,
          generated: {
            eachCollateralLine: [
              ...COLLATERAL_CODES.map((c) => ({
                code: `X.${c.suffix}`,
                label: c.label,
                ...(c.suffix === "CAP" ? { when: "it has a cap" } : {}),
              })),
              {
                code: "X.AGE1, X.AGE2…",
                label: "An aged line's buckets, entered",
              },
              {
                code: "X.AGED_OUT",
                label: "An aged line's ineligible buckets added up",
              },
            ],
            eachGroup: [
              { code: "G.CAP", label: "Cap", when: "it has a cap" },
              {
                code: "G.MARGINED",
                label: "Its lines' margined amounts, up to its cap",
              },
            ],
            totals: TOTALS.map((t) => ({
              code: t.code,
              label: t.label,
              help: t.help,
            })),
            exchangeRates:
              "FX.<currency>, e.g. FX.USD: the month's rate, in the line of credit's currency for one unit (1.37 for USD in CAD), entered each month for every currency the lines use besides the line's own.",
            entered:
              "Each month: collateral not aged and without a formula, aging buckets, ineligibles, prior claims and reserves without a formula or set amount, usage, drivers, BB_OUTSTANDING and the exchange rates. Limits, advance rates and caps are terms, never entered.",
          },
          formulas:
            "Excel-like, over codes: + - * / ^, comparisons, percent literals (5%), TRUE and FALSE; codes with a dot read as they are (AR.MARGINED). Each month reads its own figures; PREV(x, 12) is the same month a year earlier. A formula can't read what it feeds in the same month: a reserve at 10% of BB_TOTAL reads itself.",
          functions: Object.entries(FUNCTIONS)
            .filter(([name]) => !ANNUAL_ONLY.has(name))
            .map(([, f]) => ({ signature: f.signature, help: f.help })),
          tests:
            'tests: [{"name", "metric" (a figure\'s code, e.g. "BB_EXCESS"), "test" ("min": at least; "max": at most), "threshold" (a term: "250,000", "15%", "1.25")}], tested every month with a certificate. The margin test (BB_SURPLUS at least 0) and the overline test (BB_USAGE at most the limit) always run.',
          example: EXAMPLE,
          builtIns: BUILT_IN_BORROWING_BASES.map((b) => ({
            id: b.id,
            name: b.name,
            description: b.description,
          })),
          // Published and not archived: those a line can start from.
          templates: templates
            .filter((t) => t.published && !t.archivedAt)
            .map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
            })),
        };
      }),
  );

  server.registerTool(
    "run_borrowing_base",
    {
      title: "Run a borrowing base",
      description: [
        "Computes a margined line's borrowing base month by month from the client's certificates, as the app shows it: each row's values (the margined collateral, prior claims, reserves, the borrowing base, the limit, usage, the surplus, negative when short, excess availability, utilization and coverage), rounded as the app shows them, in the months' order; a month with quality null has no certificate and no values.",
        "With them, the margin test (usage within the borrowing base) and the overline test (usage within the limit) and the definition's own, month by month: the threshold, the figure, the margin and Pass or Fail; the issues; and the business cycle over the whole history, by fiscal year and over the last 12 months (peak, average and lowest usage, the lowest surplus, months in deficit, the highest utilization) with a seasonal profile.",
        "Report its figures as given: never compute a borrowing base yourself.",
      ].join(" "),
      inputSchema: z.object({
        lineId,
        from: month
          .optional()
          .describe(
            "The first month to show, as YYYY-MM; the last 12 when from and to are omitted.",
          ),
        to: month.optional().describe("The last month to show, as YYYY-MM."),
        details: z
          .boolean()
          .optional()
          .describe(
            "true adds each collateral line's detail: aging buckets, ineligibles, eligible amount, advance rate and cap.",
          ),
        lines: z
          .array(z.string())
          .optional()
          .describe(
            'Only these codes, e.g. ["BB_TOTAL", "AR.MARGINED"]; every row when omitted.',
          ),
      }),
      annotations: READ,
    },
    ({ lineId, from, to, details, lines: codes }) =>
      respond(async () => {
        const results = await runBorrowingBaseOf(db, ctx, own(lineId));
        const { detail, run } = results;
        const heading = {
          line: detail.line.name,
          borrower: detail.entity.name,
          currency: detail.line.currency,
        };
        if (!run.months.length)
          return {
            ...heading,
            months: [],
            note: "No certificates yet: enter figures with set_borrowing_base_values, or paste them.",
          };
        const shownMonths = monthRange(run.months, from, to);
        if (!shownMonths.length)
          throw invalid(
            `${detail.line.name} has months from ${run.months[0]!.month} to ${run.months.at(-1)!.month}.`,
          );
        const inRange = new Set(shownMonths.map((p) => run.months[p]!.month));
        const testNames = new Map(run.tests.map((t) => [t.id, t.name]));
        const summary = (s: CycleSummary) => ({
          period: s.label,
          from: s.from,
          to: s.to,
          months: s.months,
          peakUsage: figureIn(s.peakUsage, "amount"),
          averageUsage: figure(s.averageUsage, "amount"),
          // The part of the line never repaid.
          lowestUsage: figureIn(s.lowestUsage, "amount"),
          lowestSurplus: figureIn(s.lowestSurplus, "amount"),
          deficitMonths: s.deficitMonths,
          highestUtilization: figureIn(s.highestUtilization, "percent"),
          averageBorrowingBase: figure(s.averageBorrowingBase, "amount"),
          lowestBorrowingBase: figureIn(s.lowestBorrowingBase, "amount"),
          monthsFailed: Object.fromEntries(
            Object.entries(s.failed).map(([id, n]) => [
              testNames.get(id) ?? id,
              n,
            ]),
          ),
        });
        return {
          ...heading,
          months: shownMonths.map((p) => ({
            month: run.months[p]!.month,
            quality: run.months[p]!.quality,
          })),
          ...describeRun(run, detail.definition, shownMonths, {
            name: detail.line.name,
            details,
            codes,
          }),
          issues: issuesOf(results.issues, inRange),
          cycle: {
            last12: results.cycle.last12 && summary(results.cycle.last12),
            years: results.cycle.years.map(summary),
            // Each calendar month's average over the years reported.
            seasonal: results.cycle.seasonal
              .filter((m) => m.years)
              .map((m) => ({
                month: MONTHS[m.month - 1],
                years: m.years,
                usage: figure(m.usage, "amount"),
                borrowingBase: figure(m.borrowingBase, "amount"),
                surplus: figure(m.surplus, "amount"),
              })),
          },
        };
      }),
  );

  server.registerTool(
    "start_borrowing_base",
    {
      title: "Start a line's borrowing base",
      description:
        "Margins a line of credit: starts its borrowing base from one of the app's built-ins (builtIn), one of the organization's published templates (templateId) or another line's (fromLineId), as describe_borrowing_base_lines lists them. The copy is the line's own: change its terms to the credit agreement with set_borrowing_base_term or set_borrowing_base_definition. A line that already has a borrowing base has its definition replaced (its months stay): confirm with the user before replacing one. Returns the definition, the codes entered each month and any warnings.",
      inputSchema: z.object({
        lineId,
        builtIn: z
          .enum(
            BUILT_IN_BORROWING_BASES.map((b) => b.id) as [string, ...string[]],
          )
          .optional()
          .describe("A built-in's id."),
        templateId: z
          .string()
          .optional()
          .describe("An organization template's id."),
        fromLineId: z
          .string()
          .optional()
          .describe("Another margined line's id, to copy its definition."),
      }),
      annotations: CHANGE,
    },
    ({ lineId, builtIn, templateId, fromLineId }) =>
      respond(async () => {
        const given = [builtIn, templateId, fromLineId].filter(
          (v) => v !== undefined,
        );
        if (given.length !== 1)
          throw invalid(
            "Pass one of builtIn, templateId or fromLineId: describe_borrowing_base_lines lists the built-ins and templates.",
          );
        const id = own(lineId);
        if (fromLineId !== undefined && own(fromLineId) === id)
          throw invalid("That's the same line: copy another line's.");
        const before = await getCreditLine(db, ctx, id);
        const { issues } = await startBorrowingBase(
          db,
          ctx,
          id,
          builtIn !== undefined
            ? { builtIn }
            : templateId !== undefined
              ? { templateId }
              : { lineId: own(fromLineId!) },
        );
        return setUp(
          id,
          issues,
          before.borrowingBase ? { replaced: true } : {},
        );
      }),
  );

  server.registerTool(
    "set_borrowing_base_definition",
    {
      title: "Write a line's borrowing base",
      description: [
        "Sets a line's whole borrowing base definition, replacing the one it has: its lines, tests and spread items, as describe_borrowing_base_lines describes them. To change one, get it with get_borrowing_base asTyped, change it and send it back whole. A definition with errors isn't saved: the errors come back to fix. Returns it with its warnings.",
        "Months keep their figures; a line removed leaves its figures unread, and a line added shows blank in months without its figure. For one rate, cap or reserve from a month, set_borrowing_base_term is simpler.",
        "null stops margining the line; its months are kept, in case it's margined again. Confirm with the user before replacing a definition or stopping one.",
      ].join(" "),
      inputSchema: z.object({
        lineId,
        definition: definitionInput.nullable(),
      }),
      annotations: CHANGE,
    },
    ({ lineId, definition }) =>
      respond(async () => {
        const id = own(lineId);
        const { line, issues } = await setBorrowingBaseDefinition(
          db,
          ctx,
          id,
          definition,
        );
        if (!definition)
          return {
            line: line.name,
            margined: false,
            note: "Its months are kept, in case it's margined again.",
          };
        return setUp(id, issues);
      }),
  );

  server.registerTool(
    "set_borrowing_base_term",
    {
      title: "Change a borrowing base term",
      description:
        "Changes one term of a line's borrowing base: a collateral line's advance rate or cap, a group's cap, or a reserve's set amount. With from, it applies from that month on, as an amendment does (\"70% from June 2026\"), and earlier months keep the term they had. Without, it corrects the value from the start; later steps still apply. A null cap or reserve amount removes it for every month. The line's limit is the line of credit's: update_line_of_credit. Returns the term in words.",
      inputSchema: z.object({
        lineId,
        code: z
          .string()
          .describe(
            'The borrowing base line, by code, e.g. "AR" (from get_borrowing_base).',
          ),
        term: z
          .enum(["rate", "cap", "amount"])
          .describe(
            "rate: a collateral line's advance rate. cap: a collateral line's or a group's. amount: a reserve's set amount.",
          ),
        value: z
          .union([z.string(), z.number()])
          .nullable()
          .describe(
            'A rate with its percent sign, "70%"; a cap or amount, "1,000,000". null removes a cap or a reserve\'s amount.',
          ),
        from: month
          .optional()
          .describe(
            "The month it applies from, as YYYY-MM, for an amendment; from the start when omitted.",
          ),
      }),
      annotations: CHANGE,
    },
    ({ lineId, code, term, value, from }) =>
      respond(async () => {
        const { line, issues } = await setBorrowingBaseTerm(
          db,
          ctx,
          own(lineId),
          { code, term, value, from },
        );
        const target = line.borrowingBase!.lines.find(
          (l) => l.code === code.trim().toUpperCase(),
        )!;
        const now = (target as unknown as Record<string, Term | undefined>)[
          term
        ];
        return {
          line: line.name,
          code: target.code,
          label: target.label,
          term: term === "rate" ? "advance rate" : term,
          value: now
            ? termInWords(now, term === "rate" ? showRate : showAmount)
            : "none",
          warnings: issues.map((i) => i.message),
        };
      }),
  );

  server.registerTool(
    "set_borrowing_base_values",
    {
      title: "Enter a borrowing base's figures",
      description: [
        "Enters, changes or clears (null) figures of a margined line's monthly history, by month and code, as the client's certificate shows them: the codes get_borrowing_base lists as entered (collateral, aging buckets such as AR.AGE1, ineligibles, prior claims, usage, BB_OUTSTANDING for the line's balance, and FX.USD for each foreign currency's rate). Amounts as written, \"1,250,000\"; foreign-currency lines in their own currency.",
        "Months not held yet are added as reported. Transcribe the figures; never compute the borrowing base. Returns each month's borrowing base, usage and surplus as the app computes them, and its checks, such as a missing exchange rate.",
      ].join(" "),
      inputSchema: z.object({
        lineId,
        months: z
          .record(
            z.string(),
            z.record(z.string(), z.union([z.string(), z.number()]).nullable()),
          )
          .describe(
            'Month "YYYY-MM" → code → figure, e.g. {"2025-11": {"AR": "2,000,000", "AR_USD": "600,000", "FX.USD": "1.37", "BB_OUTSTANDING": "2,500,000", "LCS": null}}.',
          ),
      }),
      annotations: CHANGE,
    },
    ({ lineId, months }) =>
      respond(async () => {
        const entries = Object.entries(months).flatMap(([m, figures]) =>
          Object.entries(figures).map(([code, value]) => ({
            month: m,
            code,
            value: value === null ? null : String(value),
          })),
        );
        if (!entries.length) throw invalid("Give at least one figure.");
        const id = own(lineId);
        await setBorrowingBaseValues(db, ctx, id, entries);
        const set = new Map<string, string[]>();
        for (const e of entries) {
          const m = parseMonth(e.month, "Borrowing base");
          set.set(m, [...(set.get(m) ?? []), e.code.trim().toUpperCase()]);
        }
        return monthsAfter(id, [...set.keys()], set);
      }),
  );

  server.registerTool(
    "set_borrowing_base_month",
    {
      title: "Record a borrowing base month",
      description:
        "Records a month of a margined line's history: its quality (reported: the client's certificate; verified: confirmed by a field exam or an audit), the day its certificate came in, and a note. Only what's given changes; a month not held yet is added, with no figures.",
      inputSchema: z.object({
        lineId,
        month,
        quality: z.enum(["reported", "verified"]).optional(),
        receivedOn: z
          .string()
          .nullable()
          .optional()
          .describe(
            "The day the certificate came in, as YYYY-MM-DD; null clears it.",
          ),
        note: z.string().nullable().optional().describe("null clears it."),
      }),
      annotations: CHANGE,
    },
    ({ lineId, month, ...input }) =>
      respond(async () => {
        if (Object.values(input).every((v) => v === undefined))
          throw invalid("Give a quality, a date received or a note.");
        const saved = await setBorrowingBaseMonth(
          db,
          ctx,
          own(lineId),
          month,
          input,
        );
        return {
          month: saved.month,
          quality: saved.quality,
          receivedOn: saved.receivedOn,
          note: saved.note,
          figures: Object.keys(saved.figures).length,
        };
      }),
  );

  server.registerTool(
    "preview_borrowing_base_paste",
    {
      title: "Preview a pasted borrowing base",
      description: [
        "Reads a borrowing base certificate (one month) or a history of them (a column per month) the user pasted from Excel or a CSV, without saving anything. Pass it exactly as pasted: a header row of month ends, then a row per line, its label or code then a cell per month. Rows match the lines entered each month by code or exact label; a label used twice, such as an aging bucket's, takes the next match in the borrowing base's order. Don't retype, round or reorder figures.",
        "Then show the user what was read: each column's month (confirm those marked guessed, and give a month at import to any that has none), the rows matched and those that weren't, each month's borrowing base, usage and surplus as they'd be computed, and its checks. A column whose month is held already replaces the figures pasted. Once the user confirms, call import_borrowing_base_paste with the same text and the confirmation returned here.",
      ].join(" "),
      inputSchema: z.object({
        lineId,
        text: z.string().describe("The certificate or history as pasted."),
      }),
      annotations: READ,
    },
    ({ lineId, text }) =>
      respond(async () => {
        const id = own(lineId);
        const detail = await getBorrowingBase(db, ctx, id);
        const paste = parseBorrowingBasePaste(text, detail.inputs);
        const canImport = !paste.issues.some((i) => i.severity === "error");
        const formats = new Map(detail.inputs.map((r) => [r.code, r.format]));
        // The history with the paste in it, as the import would leave it.
        const byMonth = new Map<string, BorrowingBaseMonthInput>(
          detail.months.map((m) => [
            m.month,
            { month: m.month, quality: m.quality, figures: { ...m.figures } },
          ]),
        );
        paste.columns.forEach((column, i) => {
          if (!column.month) return;
          const held = byMonth.get(column.month) ?? {
            month: column.month,
            quality: "reported" as const,
            figures: {},
          };
          for (const row of paste.matched) {
            const read = parseValue(
              row.cells[i] ?? "",
              formats.get(row.code!) === "ratio" ? "ratio" : "amount",
            );
            if ("value" in read && read.value !== null)
              held.figures[row.code!] = read.value;
          }
          byMonth.set(column.month, held);
        });
        const months = [...byMonth.values()];
        const line = {
          currency: detail.line.currency,
          limit: detail.line.limit,
        };
        const compiled = compileBorrowingBase(detail.definition, line);
        const run = runBorrowingBase({
          definition: detail.definition,
          line,
          months,
          compiled,
        });
        const checks = borrowingBaseIssues({
          definition: detail.definition,
          compiled,
          months,
          run,
        });
        const value = (code: string, m: string) => {
          const p = run.months.findIndex((r) => r.month === m);
          return figure(run.cells[code]?.[p]?.value ?? null, "amount");
        };
        return {
          canImport,
          ...(canImport ? { confirmation: fingerprint(id, text) } : {}),
          issues: paste.issues.map(issueText),
          matchedRows: paste.matched.map((r) => ({
            row: r.row,
            label: r.label,
            code: r.code,
          })),
          figures: paste.matched.reduce(
            (n, r) => n + r.cells.filter((c) => c.trim()).length,
            0,
          ),
          unmatchedRows: paste.unmatched.map((r) => ({
            row: r.row,
            label: r.label,
          })),
          columns: paste.columns.map((c) => ({
            column: c.index,
            header: c.header,
            month: c.month,
            guessed: c.guessed,
            ...(c.month
              ? {
                  alreadyHeld: detail.months.some((m) => m.month === c.month),
                  borrowingBase: value("BB_TOTAL", c.month),
                  usage: value("BB_USAGE", c.month),
                  surplus: value("BB_SURPLUS", c.month),
                  checks: (checks.byMonth[c.month] ?? []).map(issueText),
                }
              : {}),
          })),
        };
      }),
  );

  server.registerTool(
    "import_borrowing_base_paste",
    {
      title: "Import a pasted borrowing base",
      description:
        "Saves a certificate or history previewed with preview_borrowing_base_paste, once the user has confirmed it: the same text and the confirmation it returned, with the month of any column whose header didn't read as one, or was misread. A pasted figure replaces the one held; blank cells change nothing. Months it adds are reported; set_borrowing_base_month marks one verified. Returns each month's borrowing base, usage and surplus, and its checks.",
      inputSchema: z.object({
        lineId,
        text: z.string().describe("The same text as previewed."),
        confirmation: z
          .string()
          .describe("The confirmation preview_borrowing_base_paste returned."),
        months: z
          .array(
            z.object({
              column: z
                .number()
                .int()
                .describe("The column's number, from the preview."),
              month: month.describe(
                "Its month as the user confirmed it, as YYYY-MM.",
              ),
            }),
          )
          .optional()
          .describe(
            "Months for columns the preview couldn't date, or misread.",
          ),
      }),
      annotations: CHANGE,
    },
    ({ lineId, text, confirmation, months }) =>
      respond(async () => {
        const id = own(lineId);
        if (confirmation !== fingerprint(id, text))
          throw invalid(
            "This isn't the text that was previewed. Preview it again, show the user, then import with the new confirmation.",
          );
        const imported = await importBorrowingBasePaste(
          db,
          ctx,
          id,
          text,
          Object.fromEntries((months ?? []).map((m) => [m.column, m.month])),
        );
        return {
          figures: imported.figures,
          ...(await monthsAfter(id, imported.months)),
        };
      }),
  );

  server.registerTool(
    "remove_borrowing_base_month",
    {
      title: "Remove a borrowing base month",
      description:
        "Deletes a month of a margined line's history and every figure in it, e.g. one entered under the wrong month. Confirm with the user first.",
      inputSchema: z.object({ lineId, month }),
      annotations: CHANGE,
    },
    ({ lineId, month: raw }) =>
      respond(async () => {
        const id = own(lineId);
        const detail = await getBorrowingBase(db, ctx, id);
        const m = parseMonth(raw, detail.line.name);
        if (!detail.months.some((h) => h.month === m))
          throw invalid(
            `${detail.line.name} has no month ${m}${detail.months.length ? `; it has ${detail.months.map((h) => h.month).join(", ")}` : ""}.`,
          );
        await removeBorrowingBaseMonth(db, ctx, id, m);
        return {
          removed: m,
          line: detail.line.name,
          months: detail.months
            .filter((h) => h.month !== m)
            .map((h) => h.month),
        };
      }),
  );
}
