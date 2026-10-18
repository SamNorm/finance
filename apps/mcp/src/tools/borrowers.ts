import type { Db } from "@finance/db";
import {
  getEntity,
  getScoringModel,
  getSpread,
  listAnalyses,
  listEntities,
  type Context,
} from "@finance/domain";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { figure } from "../format";
import { describeDebtSchedule } from "../loans";
import { invalid, matches, READ, respond } from "../respond";

const borrowerId = z
  .string()
  .describe("The borrower's id, from list_borrowers.");

export function borrowerTools(server: McpServer, db: Db, ctx: Context) {
  server.registerTool(
    "list_borrowers",
    {
      title: "List borrowers",
      description:
        "Lists the organization's borrowers (and acquisition targets) with their scoring model and how many statement periods are spread. Use it to find a borrower's id by name.",
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe("Part of the name; all borrowers when omitted."),
      }),
      annotations: READ,
    },
    ({ search }) =>
      respond(async () =>
        (await listEntities(db, ctx))
          .filter((e) => matches(e.name, search))
          .map((e) => ({
            id: e.id,
            name: e.name,
            industry: e.industry,
            riskRating: e.riskRating,
            scoringModel: e.scoringModelName,
            periods: e.periodCount,
            projectedPeriods: e.projectedPeriodCount,
            latestPeriodEnd: e.latestPeriodEnd,
          })),
      ),
  );

  server.registerTool(
    "get_borrower",
    {
      title: "Get a borrower",
      description:
        "A borrower's profile, its spread periods, its existing loans (the debt schedule, with each loan's payment and maturity) and its analyses.",
      inputSchema: z.object({ borrowerId }),
      annotations: READ,
    },
    ({ borrowerId }) =>
      respond(async () => {
        const entity = await getEntity(db, ctx, borrowerId);
        const [spread, scoringModel, analyses] = await Promise.all([
          getSpread(db, ctx, entity.id),
          getScoringModel(db, ctx, entity.scoringModelId),
          listAnalyses(db, ctx, { entityId: entity.id }),
        ]);
        return {
          id: entity.id,
          name: entity.name,
          industry: entity.industry,
          naicsCode: entity.naicsCode,
          // As rated in the institution's own system; the app never rates.
          riskRating: entity.riskRating,
          notes: entity.notes,
          scoringModel: scoringModel.name,
          periods: spread.periods.map((p) => ({
            id: p.id,
            end: p.periodEnd,
            months: p.months,
            quality: p.quality,
          })),
          existingLoans: describeDebtSchedule(entity.debtSchedule),
          analyses: analyses.map((a) => ({
            id: a.id,
            name: a.name,
            status: a.status,
            model: `${a.modelName} v${a.versionNumber}`,
            updatedAt: a.updatedAt,
          })),
        };
      }),
  );

  server.registerTool(
    "get_spread",
    {
      title: "Get a borrower's spread",
      description:
        "A borrower's financial statements as spread, by scoring model item and period: figures entered, and subtotals summed from their lines. Items with no figure in any period are left out. Also lists each period's failed checks, such as a balance sheet that doesn't balance.",
      inputSchema: z.object({
        borrowerId,
        codes: z
          .array(z.string())
          .optional()
          .describe(
            'Only these item codes, e.g. ["REVENUE", "TOTAL_ASSETS"]; every item when omitted.',
          ),
      }),
      annotations: READ,
    },
    ({ borrowerId, codes }) =>
      respond(async () => {
        const spread = await getSpread(db, ctx, borrowerId);
        const items = (spread.layout?.items ?? []).filter(
          (i) => i.kind !== "header",
        );
        const unknown = codes?.filter((c) => !items.some((i) => i.code === c));
        if (unknown?.length)
          throw invalid(
            `Not items of ${spread.entity.name}'s scoring model: ${unknown.join(", ")}.`,
          );
        const rows = items
          .filter((i) => !codes || codes.includes(i.code))
          .map((item) => ({
            code: item.code,
            label: item.label,
            statement: item.statement,
            values: spread.periods.map((p) =>
              figure(
                spread.values[p.id]?.[item.code] ??
                  spread.computed[p.id]?.[item.code] ??
                  null,
                item.dataType,
              ),
            ),
          }))
          .filter((row) => codes || row.values.some((v) => v !== null));
        return {
          borrower: spread.entity.name,
          periods: spread.periods.map((p) => ({
            id: p.id,
            end: p.periodEnd,
            months: p.months,
            quality: p.quality,
            checks: (spread.checks[p.id] ?? []).map(
              (c) => `${c.severity}: ${c.message}`,
            ),
          })),
          // Each row's values follow the periods' order.
          items: rows,
        };
      }),
  );
}
