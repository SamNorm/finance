import { createHash } from "node:crypto";
import type { Db } from "@finance/db";
import {
  addPeriod,
  createEntity,
  deletePeriod,
  forceRetainedEarnings,
  getSpread,
  listScoringModels,
  pasteSpread,
  previewPaste,
  setPeriodControls,
  setValues,
  STATEMENT_QUALITIES,
  updateEntity,
  updatePeriod,
  type Context,
  type Entity,
  type StatementPeriod,
  type StatementQuality,
} from "@finance/domain";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { borrowerId, date } from "../fields";
import { figure } from "../format";
import { ADD, CHANGE, invalid, READ, respond } from "../respond";

// Borrowers and their spreads. A spread comes from the institution's
// scoring system: pasted whole, previewed and confirmed before it's saved,
// or corrected a few figures at a time. The app doesn't read raw financial
// statements.

const quality = z
  .enum(STATEMENT_QUALITIES as [StatementQuality, ...StatementQuality[]])
  .describe(
    "How reliable the statements are: audited, review, compilation, internal, or projected (the client's own projections).",
  );
const periodId = z
  .string()
  .describe("The period's id, from get_borrower or get_spread.");
const months = z
  .number()
  .int()
  .min(1)
  .max(24)
  .describe(
    "Months the period covers: 12 for a fiscal year, fewer for a year to date.",
  );
const profile = {
  industry: z.string().optional(),
  naicsCode: z.string().optional().describe("2 to 6 digits."),
  riskRating: z
    .string()
    .optional()
    .describe(
      "The rating from the institution's own system, for reference; the app never rates.",
    ),
  notes: z.string().optional(),
};

const describeBorrower = (e: Entity) => ({
  id: e.id,
  name: e.name,
  industry: e.industry,
  naicsCode: e.naicsCode,
  riskRating: e.riskRating,
  notes: e.notes,
});

const describePeriod = (p: StatementPeriod) => ({
  id: p.id,
  end: p.periodEnd,
  months: p.months,
  quality: p.quality,
  currency: p.currency,
  consolidated: p.consolidated,
});

// What a period's statements say beyond its figures.
export const describeControls = (p: StatementPeriod) => ({
  netIncomeAsPrinted: figure(p.reportedNetIncome, "amount"),
  retainedEarningsReconciliation: p.reconciliation.map((l) => ({
    label: l.label,
    amount: figure(l.amount, "amount"),
    ...(l.forced ? { forced: true } : {}),
  })),
});

// The paste a preview read, so an import can be held to it: the text as
// the model sent it, less line endings and trailing spaces, for what it's
// pasted into (a borrower, a line of credit).
export const fingerprint = (id: string, text: string) =>
  createHash("sha256")
    .update(id)
    .update("\n")
    .update(
      text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trim(),
    )
    .digest("hex")
    .slice(0, 12);

// The spread's checks on some of the borrower's periods, after a change.
async function checksOf(
  db: Db,
  ctx: Context,
  borrowerId: string,
  periodIds: string[],
) {
  const spread = await getSpread(db, ctx, borrowerId);
  return spread.periods
    .filter((p) => periodIds.includes(p.id))
    .map((p) => ({
      period: { id: p.id, end: p.periodEnd, months: p.months },
      checks: (spread.checks[p.id] ?? []).map(
        (c) => `${c.severity}: ${c.message}`,
      ),
    }));
}

export function spreadTools(server: McpServer, db: Db, ctx: Context) {
  server.registerTool(
    "list_scoring_models",
    {
      title: "List scoring models",
      description:
        "Lists the organization's scoring models: the layouts borrowers' spreads follow, mirroring the institution's scoring system or its own input sheet. Each borrower follows one.",
      inputSchema: z.object({}),
      annotations: READ,
    },
    () =>
      respond(async () =>
        (await listScoringModels(db, ctx)).map((m) => ({
          id: m.id,
          name: m.name,
          source: m.source,
          sourceSystem: m.sourceSystem,
          description: m.description,
          publishedVersion:
            m.versions.findLast((v) => v.status === "published")?.number ??
            null,
        })),
      ),
  );

  server.registerTool(
    "create_borrower",
    {
      title: "Create a borrower",
      description:
        "Creates a borrower (or acquisition target) on one of the organization's scoring models. Check with list_borrowers that it doesn't exist yet.",
      inputSchema: z.object({
        name: z.string(),
        scoringModelId: z
          .string()
          .optional()
          .describe(
            "From list_scoring_models; may be omitted when the organization has only one.",
          ),
        ...profile,
      }),
      annotations: ADD,
    },
    ({ scoringModelId, ...input }) =>
      respond(async () => {
        let modelId = scoringModelId;
        if (!modelId) {
          const models = await listScoringModels(db, ctx);
          if (models.length !== 1)
            throw invalid(
              `Choose the scoring model: ${models.map((m) => `${m.name} (${m.id})`).join(", ") || "the organization has none yet"}.`,
            );
          modelId = models[0]!.id;
        }
        return describeBorrower(
          await createEntity(db, ctx, { ...input, scoringModelId: modelId }),
        );
      }),
  );

  server.registerTool(
    "update_borrower",
    {
      title: "Change a borrower",
      description:
        "Changes a borrower's name or profile; only what's given changes. Its scoring model can change only before any period is spread.",
      inputSchema: z.object({
        borrowerId,
        name: z.string().optional(),
        scoringModelId: z.string().optional(),
        ...profile,
      }),
      annotations: CHANGE,
    },
    ({ borrowerId, ...patch }) =>
      respond(async () => {
        if (Object.values(patch).every((v) => v === undefined))
          throw invalid("Give at least one field to change.");
        return describeBorrower(await updateEntity(db, ctx, borrowerId, patch));
      }),
  );

  server.registerTool(
    "add_period",
    {
      title: "Add a period to a spread",
      description:
        "Adds an empty statement period to a borrower's spread, to enter figures in with set_spread_values. To spread a paste, use preview_spread_paste instead: importing creates its periods.",
      inputSchema: z.object({
        borrowerId,
        periodEnd: date("The period's last day"),
        months: months.optional(),
        quality,
        currency: z.string().optional().describe("ISO code; CAD when omitted."),
        consolidated: z.boolean().optional(),
      }),
      annotations: ADD,
    },
    ({ borrowerId, months, ...input }) =>
      respond(async () =>
        describePeriod(
          await addPeriod(db, ctx, borrowerId, {
            ...input,
            months: months ?? 12,
          }),
        ),
      ),
  );

  server.registerTool(
    "update_period",
    {
      title: "Change a period",
      description:
        "Changes a period's end, length, quality, currency or whether it's consolidated; its figures stay. Only what's given changes.",
      inputSchema: z.object({
        periodId,
        periodEnd: date("The period's last day").optional(),
        months: months.optional(),
        quality: quality.optional(),
        currency: z.string().optional(),
        consolidated: z.boolean().optional(),
      }),
      annotations: CHANGE,
    },
    ({ periodId, ...patch }) =>
      respond(async () => {
        if (Object.values(patch).every((v) => v === undefined))
          throw invalid("Give at least one field to change.");
        return describePeriod(await updatePeriod(db, ctx, periodId, patch));
      }),
  );

  server.registerTool(
    "remove_period",
    {
      title: "Remove a period",
      description:
        "Deletes a period and every figure in it, e.g. one pasted under the wrong date. Analyses that use it lose it. Confirm with the user first.",
      inputSchema: z.object({ periodId }),
      annotations: CHANGE,
    },
    ({ periodId }) =>
      respond(async () => {
        await deletePeriod(db, ctx, periodId);
        return { removed: periodId };
      }),
  );

  server.registerTool(
    "set_spread_values",
    {
      title: "Enter or correct figures",
      description:
        'Enters, changes or clears (empty value) figures in one period of a borrower\'s spread, by item code (from get_spread). Amounts as written in the statements: "1,250,000", "(15,000)" for negatives; percentages with their percent sign. All are checked before any is saved. Returns the period\'s checks afterwards, such as a balance sheet that doesn\'t balance.',
      inputSchema: z.object({
        borrowerId,
        periodId,
        figures: z
          .record(z.string(), z.string())
          .describe(
            'Item code → figure, e.g. {"REVENUE": "5,500,000", "CASH": ""}.',
          ),
      }),
      annotations: CHANGE,
    },
    ({ borrowerId, periodId, figures }) =>
      respond(async () => {
        const spread = await getSpread(db, ctx, borrowerId);
        if (!spread.periods.some((p) => p.id === periodId))
          throw invalid(`${spread.entity.name} has no such period.`);
        const set = await setValues(db, ctx, periodId, figures);
        const types = new Map(
          (spread.layout?.items ?? []).map((i) => [i.code, i.dataType]),
        );
        const [after] = await checksOf(db, ctx, borrowerId, [periodId]);
        return {
          ...after,
          set: Object.fromEntries(
            Object.entries(set).map(([code, value]) => [
              code,
              figure(value, types.get(code) ?? "text"),
            ]),
          ),
        };
      }),
  );

  server.registerTool(
    "set_period_controls",
    {
      title: "Record what a period's statements say",
      description: [
        "Records, for one period, what its financial statements say beyond the spread's figures. Net income as printed: the spread's must match it, or the period can't be analyzed. The retained earnings reconciliation: how retained earnings changed other than by net income, such as dividends declared or a prior-period adjustment, so they roll forward from the period before.",
        "Only what's given changes; reconciliation lines given replace the period's. Returns the period's checks afterwards.",
      ].join(" "),
      inputSchema: z.object({
        borrowerId,
        periodId,
        netIncomeAsPrinted: z
          .string()
          .nullable()
          .optional()
          .describe(
            'As printed, e.g. "412,345" or "(15,000)"; null clears it.',
          ),
        reconciliation: z
          .array(
            z.object({
              label: z.string().describe('e.g. "Dividends declared".'),
              amount: z
                .string()
                .describe(
                  'Negative when it reduces retained earnings, e.g. "-50,000".',
                ),
            }),
          )
          .optional()
          .describe("Replaces the period's lines; an empty list clears them."),
      }),
      annotations: CHANGE,
    },
    ({ borrowerId, periodId, netIncomeAsPrinted, reconciliation }) =>
      respond(async () => {
        if (netIncomeAsPrinted === undefined && reconciliation === undefined)
          throw invalid("Give net income as printed or reconciliation lines.");
        const spread = await getSpread(db, ctx, borrowerId);
        if (!spread.periods.some((p) => p.id === periodId))
          throw invalid(`${spread.entity.name} has no such period.`);
        const period = await setPeriodControls(db, ctx, periodId, {
          reportedNetIncome: netIncomeAsPrinted,
          reconciliation,
        });
        const [after] = await checksOf(db, ctx, borrowerId, [periodId]);
        return { ...after, ...describeControls(period) };
      }),
  );

  server.registerTool(
    "force_retained_earnings",
    {
      title: "Force retained earnings to roll forward",
      description:
        'Only when the user asks: adds an "Unreconciled difference" line to a period\'s retained earnings reconciliation for whatever is left, so retained earnings roll forward from the period before. It replaces a line forced before and stays visible, so a reviewer sees what was forced.',
      inputSchema: z.object({ borrowerId, periodId }),
      annotations: CHANGE,
    },
    ({ borrowerId, periodId }) =>
      respond(async () => {
        const spread = await getSpread(db, ctx, borrowerId);
        if (!spread.periods.some((p) => p.id === periodId))
          throw invalid(`${spread.entity.name} has no such period.`);
        const period = await forceRetainedEarnings(db, ctx, periodId);
        const [after] = await checksOf(db, ctx, borrowerId, [periodId]);
        return { ...after, ...describeControls(period) };
      }),
  );

  server.registerTool(
    "preview_spread_paste",
    {
      title: "Preview a pasted spread",
      description: [
        "Reads a spread the user pasted from the scoring system, without saving anything. Pass it exactly as pasted: one row per line, the label then a cell per period, separated by tabs (as copied from a spreadsheet) or commas, with the header row of period dates. Don't retype, round or reorder figures.",
        "Then show the user what was read: each column's period (confirm the dates marked guessed), the rows that matched no item, and each column's totals and checks. Totals that don't tie usually mean a figure changed on the way. Ask each column's statement quality, then call import_spread_paste with the same text and the confirmation returned here.",
      ].join(" "),
      inputSchema: z.object({
        borrowerId,
        text: z.string().describe("The spread as pasted."),
      }),
      annotations: READ,
    },
    ({ borrowerId, text }) =>
      respond(async () => {
        const preview = await previewPaste(db, ctx, borrowerId, text);
        return {
          canImport: preview.canImport,
          ...(preview.canImport
            ? { confirmation: fingerprint(borrowerId, text) }
            : {}),
          issues: preview.issues.map((i) => `${i.severity}: ${i.message}`),
          matchedRows: preview.matched,
          figures: preview.figures,
          unmatchedRows: preview.unmatched,
          columns: preview.columns.map((c) => ({
            column: c.index,
            header: c.header,
            periodEnd: c.periodEnd,
            // A header that doesn't say is a fiscal year, as imports assume.
            months: c.months ?? 12,
            guessed: c.guessed,
            // Pasting into a period that exists replaces the figures given.
            existingPeriodId: c.existingPeriodId,
            totals: c.totals
              .filter((t) => t.value !== null)
              .map((t) => ({
                label: t.label,
                value: figure(t.value, "amount"),
              })),
            checks: c.checks.map((i) => `${i.severity}: ${i.message}`),
          })),
        };
      }),
  );

  server.registerTool(
    "import_spread_paste",
    {
      title: "Import a pasted spread",
      description:
        "Saves a spread previewed with preview_spread_paste, once the user has confirmed it: the same text, the confirmation it returned, and each column to import with its period and quality. Creates the periods that don't exist; a pasted figure replaces the one there, and blank cells change nothing.",
      inputSchema: z.object({
        borrowerId,
        text: z.string().describe("The same text as previewed."),
        confirmation: z
          .string()
          .describe("The confirmation preview_spread_paste returned."),
        columns: z
          .array(
            z.object({
              column: z
                .number()
                .int()
                .describe("The column's number, from the preview."),
              periodEnd: date("The period's last day, as the user confirmed"),
              months: months.optional(),
              quality,
            }),
          )
          .min(1),
      }),
      annotations: CHANGE,
    },
    ({ borrowerId, text, confirmation, columns }) =>
      respond(async () => {
        if (confirmation !== fingerprint(borrowerId, text))
          throw invalid(
            "This isn't the text that was previewed. Preview it again, show the user, then import with the new confirmation.",
          );
        const result = await pasteSpread(
          db,
          ctx,
          borrowerId,
          text,
          columns.map((c) => ({
            index: c.column,
            periodEnd: c.periodEnd,
            months: c.months ?? 12,
            quality: c.quality,
          })),
        );
        const spread = await getSpread(db, ctx, borrowerId);
        const imported = spread.periods
          .filter((p) =>
            columns.some(
              (c) =>
                c.periodEnd === p.periodEnd && (c.months ?? 12) === p.months,
            ),
          )
          .map((p) => p.id);
        return {
          figures: result.figures,
          // Each period imported, with the spread's checks on it now.
          periods: await checksOf(db, ctx, borrowerId, imported),
        };
      }),
  );
}
