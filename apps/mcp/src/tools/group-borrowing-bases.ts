import type { Db } from "@finance/db";
import {
  GROUP_TOTALS,
  OVERRIDE_TOTALS,
  getGroupBorrowingBase,
  setGroupBorrowingBaseAdjustments,
  setGroupBorrowingBaseOverride,
  type Context,
  type GroupTotal,
} from "@finance/domain";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import {
  describeGroup,
  describeGroupMonth,
  issueText,
  monthRange,
} from "../borrowing-bases";
import { amount } from "../fields";
import { CHANGE, invalid, READ, respond } from "../respond";

// A consolidated client's borrowing base (borrowing-base-plan.md §7.5): its
// members' margined lines, each computed on its own terms, added up month by
// month as totals; adjusted by named amounts, as eliminations adjust a
// consolidated spread; or replaced by the totals of a certificate the client
// sends for the group. The members' figures are entered on the members.

const consolidatedClientId = z
  .string()
  .describe("The consolidated client's id, from list_borrowers.");
const month = z.string().describe('The month, as YYYY-MM: "2025-11".');

const totals = GROUP_TOTALS.map((t) => `${t.key} (${t.label})`).join(", ");

export function groupBorrowingBaseTools(
  server: McpServer,
  db: Db,
  ctx: Context,
) {
  server.registerTool(
    "get_group_borrowing_base",
    {
      title: "Get a consolidated client's borrowing base",
      description: [
        "A consolidated client's borrowing base month by month: each member's margined line with its totals (margined receivables, inventory and other collateral, prior claims, reserves, its own borrowing base, limit, availability, balance and other usage), then the consolidated figures, the members added up as the app computes them, adjusted and certified.",
        "Months with adjustments (set_group_borrowing_base_adjustments) or a group certificate (set_group_borrowing_base_override) show the sum before them too, so a gap is visible. Issues flag a member without a certificate in a month, members in other currencies, and a certificate whose limits differ from the members'. Values follow the months, rounded as the app shows them; never compute them yourself.",
      ].join(" "),
      inputSchema: z.object({
        consolidatedClientId,
        from: month
          .optional()
          .describe(
            "The first month to show, as YYYY-MM; the last 12 when from and to are omitted.",
          ),
        to: month.optional().describe("The last month to show, as YYYY-MM."),
      }),
      annotations: READ,
    },
    ({ consolidatedClientId, from, to }) =>
      respond(async () => {
        const group = await getGroupBorrowingBase(
          db,
          ctx,
          consolidatedClientId,
        );
        const heading = {
          group: group.entity.name,
          // Each member's margined line, keyed as analyses know it; the
          // borrowing base tools take it too.
          lines: group.members.map((m) => ({
            lineId: m.key,
            line: m.name,
            member: m.member.name,
          })),
        };
        if (!group.members.length)
          return {
            ...heading,
            note: "None of its members has a margined line: margin a member's line with start_borrowing_base.",
          };
        const shown = monthRange(group.months, from, to);
        if (group.months.length && !shown.length)
          throw invalid(
            `${group.entity.name} has months from ${group.months[0]!.month} to ${group.months.at(-1)!.month}.`,
          );
        const described = describeGroup(group.months, shown, group.members);
        return {
          ...heading,
          ...described,
          issues: [...group.issues.map(issueText), ...described.issues],
        };
      }),
  );

  server.registerTool(
    "set_group_borrowing_base_adjustments",
    {
      title: "Adjust a consolidated client's borrowing base",
      description: [
        "Sets a month's adjustments to a consolidated client's borrowing base, replacing the month's list: named amounts, negative to reduce, each added to one of the group's totals, as eliminations adjust a consolidated spread. For example, intercompany receivables out of margined receivables (receivables, negative), or a reserve the lender holds on the group (reserves, positive).",
        "Collateral adjustments carry through to the borrowing base and availability; prior claims and reserves come off them. An empty list removes the month's adjustments. Returns the month: the sum, the adjustments and the consolidated figures.",
      ].join(" "),
      inputSchema: z.object({
        consolidatedClientId,
        month,
        adjustments: z
          .array(
            z.object({
              id: z
                .string()
                .optional()
                .describe(
                  "An adjustment's id, to keep it, from get_group_borrowing_base.",
                ),
              name: z.string().describe('e.g. "Intercompany receivables".'),
              total: z
                .enum(
                  GROUP_TOTALS.map((t) => t.key) as [
                    GroupTotal,
                    ...GroupTotal[],
                  ],
                )
                .describe(`The total it changes: ${totals}.`),
              amount: amount("Negative to reduce"),
            }),
          )
          .describe("The month's whole list; [] removes them."),
      }),
      annotations: CHANGE,
    },
    ({ consolidatedClientId, month, adjustments }) =>
      respond(async () => {
        const saved = await setGroupBorrowingBaseAdjustments(
          db,
          ctx,
          consolidatedClientId,
          month,
          adjustments,
        );
        return describeGroupMonth(saved);
      }),
  );

  server.registerTool(
    "set_group_borrowing_base_override",
    {
      title: "Enter a group's borrowing base certificate",
      description: [
        "Enters the totals of a borrowing base certificate the client sends for the whole group, for one month: they replace the members' sum (after adjustments) in that month, and the sum still shows beside them. Only the totals given replace; the others stay the sum's. Given components but no borrowing base (total), the borrowing base follows from them.",
        `Totals: ${OVERRIDE_TOTALS.map((t) => `${t.key} (${t.label})`).join(", ")}. null removes the month's certificate. Transcribe the certificate's figures; confirm with the user before replacing one.`,
      ].join(" "),
      inputSchema: z.object({
        consolidatedClientId,
        month,
        totals: z
          .record(z.string(), amount("The certificate's figure"))
          .nullable()
          .describe(
            'Total → figure, e.g. {"total": "6,400,000", "limit": "7,000,000", "outstanding": "5,100,000"}; null removes the certificate.',
          ),
        note: z
          .string()
          .nullable()
          .optional()
          .describe("e.g. where the certificate came from; null clears it."),
      }),
      annotations: CHANGE,
    },
    ({ consolidatedClientId, month, totals: given, note }) =>
      respond(async () => {
        const saved = await setGroupBorrowingBaseOverride(
          db,
          ctx,
          consolidatedClientId,
          month,
          given,
          note,
        );
        return describeGroupMonth(saved);
      }),
  );
}
