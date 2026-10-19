import { debtWorkbook } from "@finance/documents";
import { xlsxResponse } from "@/lib/xlsx";

// The borrower's existing debt as a workbook, with each loan's payments.
export async function GET(
  _request: Request,
  ctx: RouteContext<"/borrowers/[id]/debt/xlsx">,
) {
  const { id } = await ctx.params;
  return xlsxResponse((db, context) => debtWorkbook(db, context, id));
}
