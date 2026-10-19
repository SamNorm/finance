import type { Db } from "@finance/db";
import {
  getCreditLines,
  getDebtSchedules,
  getEntity,
  getScoringModel,
  getSpread,
  listAnalyses,
  listBorrowingBases,
  listEntities,
  type Context,
} from "@finance/domain";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { borrowerId } from "../fields";
import { figure } from "../format";
import { describeDebtSchedule } from "../loans";
import { describeLatest } from "../borrowing-bases";
import { describeCovenants } from "./covenants";
import { describeCreditLines } from "./credit-lines";
import { describeControls } from "./spreads";
import { invalid, matches, READ, respond } from "../respond";

export function borrowerTools(server: McpServer, db: Db, ctx: Context) {
  server.registerTool(
    "list_borrowers",
    {
      title: "List borrowers",
      description:
        "Lists the organization's borrowers (and acquisition targets) with their scoring model and how many statement periods are spread. Use it to find a borrower's id by name. Kind \"consolidated\" is a consolidated client, whose spread adds up other borrowers'.",
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
            kind: e.kind,
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
        "A borrower's profile, its spread periods, its existing loans (the debt schedule, with each loan's payment and maturity), its lines of credit (each limit in words, and as a term when it changes by season or step, the rate, and whether it's margined, with its borrowing base's latest month when it is), its covenants in force and its analyses. For a consolidated client, its members and their loans, each member's debt schedule as of its own date, and their lines of credit, keyed \"member/line\" as its analyses read them: change those on the members.",
      inputSchema: z.object({ borrowerId }),
      annotations: READ,
    },
    ({ borrowerId }) =>
      respond(async () => {
        const entity = await getEntity(db, ctx, borrowerId);
        const [spread, scoringModel, analyses, debt, lines, margined] =
          await Promise.all([
            getSpread(db, ctx, entity.id),
            getScoringModel(db, ctx, entity.scoringModelId),
            listAnalyses(db, ctx, { entityId: entity.id }),
            getDebtSchedules(db, ctx, entity.id),
            getCreditLines(db, ctx, entity.id),
            listBorrowingBases(db, ctx),
          ]);
        // A consolidated client's lines are keyed "member/line".
        const bases = new Map(margined.map((b) => [b.lineId, b]));
        const baseOf = (id: string) =>
          bases.get(id.slice(id.lastIndexOf("/") + 1));
        const { consolidation } = spread;
        return {
          id: entity.id,
          name: entity.name,
          kind: entity.kind,
          ...(consolidation
            ? {
                members: consolidation.members.map((m) => ({
                  id: m.id,
                  name: m.name,
                })),
              }
            : {}),
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
          existingLoans: consolidation
            ? debt.map(({ member, schedule }) => ({
                member: member!.name,
                ...describeDebtSchedule(schedule),
              }))
            : describeDebtSchedule(entity.debtSchedule),
          // Their terms in force; analyses assume their usage. A margined
          // line's latest month, as list_borrowing_bases has it.
          linesOfCredit: describeCreditLines(lines).map((line) => {
            const base = baseOf(line.id);
            return {
              ...line,
              margined: Boolean(base),
              ...(base ? { borrowingBase: describeLatest(base) } : {}),
            };
          }),
          // The credit agreement's covenants in force, which every analysis
          // tests.
          covenants: describeCovenants(entity.covenants),
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
        "A borrower's financial statements as spread, by scoring model item and period: figures entered, and subtotals summed from their lines. Items with no figure in any period are left out. Each period also has its net income as printed on the statements, its retained earnings reconciliation, and its failed checks. Errors (a balance sheet that doesn't balance, net income that isn't the statements') keep the period out of analyses until fixed; warnings (retained earnings that don't roll forward) only flag. A consolidated client's periods add up its members' statements, listed with each period, less its eliminations.",
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
        const consolidated = spread.consolidation?.periods;
        const member = new Map(
          spread.consolidation?.members.map((m) => [m.id, m.name]),
        );
        return {
          borrower: spread.entity.name,
          periods: spread.periods.map((p) => ({
            id: p.id,
            end: p.periodEnd,
            months: p.months,
            quality: p.quality,
            // What the statements say beyond the figures, for the checks.
            ...describeControls(p),
            ...(consolidated?.[p.id]
              ? {
                  statements: consolidated[p.id]!.statements.map((s) => ({
                    borrower: member.get(s.memberId),
                    periodId: s.periodId,
                    end: s.periodEnd,
                    months: s.months,
                  })),
                  eliminations: consolidated[p.id]!.eliminations.map((e) => ({
                    id: e.id,
                    name: e.name,
                    item: e.item,
                    amount: figure(e.amount, "amount"),
                  })),
                }
              : {}),
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
