import type { Db } from "@finance/db";
import {
  addConsolidatedPeriod,
  addConsolidationMember,
  addElimination,
  createConsolidatedClient,
  getEntity,
  getSpread,
  removeConsolidationMember,
  removeElimination,
  setConsolidatedStatements,
  updateElimination,
  type Context,
  type Spread,
} from "@finance/domain";
import { Dec } from "@finance/engine";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { amount, borrowerId, date } from "../fields";
import { figure } from "../format";
import { ADD, CHANGE, invalid, READ, respond } from "../respond";

// Consolidated clients: a client whose spread adds up other borrowers' on
// the same scoring model, such as an operating company and the company that
// owns its building, less eliminations of what they owe, sell or pay each
// other. Each period takes one set of statements per member, which may end on
// another date. The spread is computed from the members' as they stand, so
// figures are entered on the members.

const clientId = z
  .string()
  .describe("The consolidated client's id, from list_borrowers.");
const periodId = z
  .string()
  .describe("The consolidated client's period, from get_spread.");
const statements = z
  .array(
    z.object({
      borrowerId: z.string().describe("A member's id."),
      periodId: z
        .string()
        .describe("The member's period to add up, from get_borrower."),
    }),
  )
  .describe(
    "One set of statements per member. They can end on other dates than the period; more than six months away is flagged.",
  );

const ITEM =
  'An input amount of the scoring model, by code, e.g. "DUE_FROM_RELATED_CURRENT" or "REVENUE".';

// A consolidated period as it stands: what it adds up, what it eliminates,
// and its checks.
function describeConsolidatedPeriod(spread: Spread, periodId: string) {
  const period = spread.periods.find((p) => p.id === periodId);
  const detail = spread.consolidation?.periods[periodId];
  if (!period || !detail)
    throw invalid(`${spread.entity.name} has no such period.`);
  const names = new Map(
    spread.consolidation!.members.map((m) => [m.id, m.name]),
  );
  return {
    client: spread.entity.name,
    period: {
      id: period.id,
      end: period.periodEnd,
      months: period.months,
      // The weakest of its statements'.
      quality: period.quality,
    },
    statements: detail.statements.map((s) => ({
      borrower: names.get(s.memberId),
      borrowerId: s.memberId,
      periodId: s.periodId,
      end: s.periodEnd,
      months: s.months,
      quality: s.quality,
      ...(s.consolidated ? { consolidated: true } : {}),
    })),
    eliminations: detail.eliminations.map((e) => ({
      id: e.id,
      name: e.name,
      item: e.item,
      amount: figure(e.amount, "amount"),
    })),
    checks: (spread.checks[periodId] ?? []).map(
      (c) => `${c.severity}: ${c.message}`,
    ),
  };
}

export function consolidationTools(server: McpServer, db: Db, ctx: Context) {
  const after = async (entityId: string, periodId: string) =>
    describeConsolidatedPeriod(await getSpread(db, ctx, entityId), periodId);
  // The period must be the client's, so a call can't reach another's.
  const ensurePeriod = async (clientId: string, periodId: string) => {
    const spread = await getSpread(db, ctx, clientId);
    if (!spread.consolidation?.periods[periodId])
      throw invalid(`${spread.entity.name} has no such consolidated period.`);
  };

  server.registerTool(
    "create_consolidated_client",
    {
      title: "Create a consolidated client",
      description:
        "Creates a client whose spread adds up other borrowers' statements, such as an operating company and its real estate company, when there are no consolidated statements from the accountant. The members must follow the same scoring model. Then add its periods with add_consolidated_period.",
      inputSchema: z.object({
        name: z.string(),
        memberIds: z
          .array(z.string())
          .min(1)
          .describe("The borrowers it adds up, from list_borrowers."),
        industry: z.string().optional(),
        notes: z.string().optional(),
      }),
      annotations: ADD,
    },
    ({ memberIds, ...input }) =>
      respond(async () => {
        const first = await getEntity(db, ctx, memberIds[0]!);
        const client = await createConsolidatedClient(db, ctx, {
          ...input,
          scoringModelId: first.scoringModelId,
          memberIds,
        });
        const spread = await getSpread(db, ctx, client.id);
        return {
          id: client.id,
          name: client.name,
          members: spread.consolidation!.members.map((m) => ({
            id: m.id,
            name: m.name,
            periods: m.periods.map((p) => ({
              id: p.id,
              end: p.periodEnd,
              months: p.months,
              quality: p.quality,
            })),
          })),
        };
      }),
  );

  server.registerTool(
    "add_consolidation_member",
    {
      title: "Add a member to a consolidated client",
      description:
        "Adds a borrower on the same scoring model to a consolidated client. Its statements then need choosing in each period with set_consolidated_statements.",
      inputSchema: z.object({ consolidatedClientId: clientId, borrowerId }),
      annotations: ADD,
    },
    ({ consolidatedClientId, borrowerId }) =>
      respond(async () => {
        await addConsolidationMember(db, ctx, consolidatedClientId, borrowerId);
        const spread = await getSpread(db, ctx, consolidatedClientId);
        return {
          client: spread.entity.name,
          members: spread.consolidation!.members.map((m) => m.name),
        };
      }),
  );

  server.registerTool(
    "remove_consolidation_member",
    {
      title: "Remove a member from a consolidated client",
      description:
        "Takes a borrower out of a consolidated client, with its statements in every period. The borrower stays. Confirm with the user first.",
      inputSchema: z.object({ consolidatedClientId: clientId, borrowerId }),
      annotations: CHANGE,
    },
    ({ consolidatedClientId, borrowerId }) =>
      respond(async () => {
        await removeConsolidationMember(
          db,
          ctx,
          consolidatedClientId,
          borrowerId,
        );
        const spread = await getSpread(db, ctx, consolidatedClientId);
        return {
          client: spread.entity.name,
          members: spread.consolidation!.members.map((m) => m.name),
        };
      }),
  );

  server.registerTool(
    "add_consolidated_period",
    {
      title: "Add a period to a consolidated client",
      description:
        "Adds a period that adds up the members' statements given, all entered against the same scoring model version. Its quality is the weakest statements'. Returns the period's checks: statements far from its end or of another length, members missing, statements already consolidated or used twice (their figures may count twice).",
      inputSchema: z.object({
        consolidatedClientId: clientId,
        periodEnd: date("The period's last day"),
        months: z
          .number()
          .int()
          .min(1)
          .max(24)
          .optional()
          .describe("12 for a fiscal year, when omitted."),
        statements,
      }),
      annotations: ADD,
    },
    ({ consolidatedClientId, periodEnd, months, statements }) =>
      respond(async () => {
        const period = await addConsolidatedPeriod(
          db,
          ctx,
          consolidatedClientId,
          {
            periodEnd,
            months: months ?? 12,
            statements: statements.map((s) => ({
              memberId: s.borrowerId,
              periodId: s.periodId,
            })),
          },
        );
        return after(consolidatedClientId, period.id);
      }),
  );

  server.registerTool(
    "set_consolidated_statements",
    {
      title: "Choose a consolidated period's statements",
      description:
        "Changes which statements of its members a consolidated period adds up: each member given gets the period given, or none when null; the others keep theirs. Use update_period to change the period's end.",
      inputSchema: z.object({
        consolidatedClientId: clientId,
        periodId,
        statements: z.array(
          z.object({
            borrowerId: z.string().describe("A member's id."),
            periodId: z
              .string()
              .nullable()
              .describe("The member's period, or null for none."),
          }),
        ),
      }),
      annotations: CHANGE,
    },
    ({ consolidatedClientId, periodId, statements }) =>
      respond(async () => {
        await ensurePeriod(consolidatedClientId, periodId);
        await setConsolidatedStatements(
          db,
          ctx,
          periodId,
          statements.map((s) => ({
            memberId: s.borrowerId,
            periodId: s.periodId,
          })),
        );
        return after(consolidatedClientId, periodId);
      }),
  );

  server.registerTool(
    "add_elimination",
    {
      title: "Eliminate an amount between members",
      description: `Adds an amount to an item of a consolidated period, negative to reduce it, to eliminate what the members owe, sell or pay each other: an intercompany advance comes out of both the receivable and the payable, intercompany rent out of both revenue and rent expense. Balance sheet eliminations must balance among themselves; the returned checks say when they don't yet.`,
      inputSchema: z.object({
        consolidatedClientId: clientId,
        periodId,
        name: z.string().describe('e.g. "Intercompany rent".'),
        item: z.string().describe(ITEM),
        amount: amount('Negative to reduce the item, e.g. "-120,000"'),
      }),
      annotations: ADD,
    },
    ({ consolidatedClientId, periodId, ...input }) =>
      respond(async () => {
        await ensurePeriod(consolidatedClientId, periodId);
        const { elimination } = await addElimination(db, ctx, periodId, {
          ...input,
          amount: String(input.amount),
        });
        return {
          elimination: elimination.id,
          ...(await after(consolidatedClientId, periodId)),
        };
      }),
  );

  server.registerTool(
    "update_elimination",
    {
      title: "Change an elimination",
      description:
        "Changes an elimination's name, item or amount; only what's given changes.",
      inputSchema: z.object({
        consolidatedClientId: clientId,
        periodId,
        eliminationId: z.string().describe("From get_spread."),
        name: z.string().optional(),
        item: z.string().optional().describe(ITEM),
        amount: amount("Negative to reduce the item").optional(),
      }),
      annotations: CHANGE,
    },
    ({ consolidatedClientId, periodId, eliminationId, ...patch }) =>
      respond(async () => {
        await ensurePeriod(consolidatedClientId, periodId);
        await updateElimination(db, ctx, periodId, eliminationId, {
          ...patch,
          amount: patch.amount === undefined ? undefined : String(patch.amount),
        });
        return after(consolidatedClientId, periodId);
      }),
  );

  server.registerTool(
    "remove_elimination",
    {
      title: "Remove an elimination",
      description: "Removes one of a consolidated period's eliminations.",
      inputSchema: z.object({
        consolidatedClientId: clientId,
        periodId,
        eliminationId: z.string().describe("From get_spread."),
      }),
      annotations: CHANGE,
    },
    ({ consolidatedClientId, periodId, eliminationId }) =>
      respond(async () => {
        await ensurePeriod(consolidatedClientId, periodId);
        await removeElimination(db, ctx, periodId, eliminationId);
        return after(consolidatedClientId, periodId);
      }),
  );

  server.registerTool(
    "get_consolidation_worksheet",
    {
      title: "Get a consolidation worksheet",
      description:
        "One period of a consolidated client, item by item: each member's figure, the eliminations and the consolidated figure. Items with no figure are left out.",
      inputSchema: z.object({
        consolidatedClientId: clientId,
        periodId,
        codes: z
          .array(z.string())
          .optional()
          .describe("Only these item codes; every item when omitted."),
      }),
      annotations: READ,
    },
    ({ consolidatedClientId, periodId, codes }) =>
      respond(async () => {
        const spread = await getSpread(db, ctx, consolidatedClientId);
        const described = describeConsolidatedPeriod(spread, periodId);
        const detail = spread.consolidation!.periods[periodId]!;
        const items = (spread.layout?.items ?? []).filter(
          (i) => i.kind !== "header" && (!codes || codes.includes(i.code)),
        );
        const consolidated = (code: string) =>
          spread.values[periodId]?.[code] ?? spread.computed[periodId]?.[code];
        return {
          ...described,
          rows: items.flatMap((item) => {
            const members = detail.statements.map(
              (s) => s.figures[item.code] ?? null,
            );
            const total = consolidated(item.code) ?? null;
            if (total === null && members.every((m) => m === null)) return [];
            const additive =
              item.dataType === "amount" || item.dataType === "count";
            const eliminated =
              additive && total !== null
                ? members.reduce(
                    (rest, m) => (m === null ? rest : rest.minus(m)),
                    new Dec(total),
                  )
                : null;
            return [
              {
                code: item.code,
                label: item.label,
                // In the order of the statements above.
                members: members.map((m) => figure(m, item.dataType)),
                eliminations:
                  eliminated && !eliminated.isZero()
                    ? figure(eliminated.toFixed(), item.dataType)
                    : null,
                consolidated: figure(total, item.dataType),
              },
            ];
          }),
        };
      }),
  );
}
