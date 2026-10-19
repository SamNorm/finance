import { spreadWorkbook } from "@finance/documents";
import { xlsxResponse } from "@/lib/xlsx";

// The borrower's spread as a workbook, a sheet per statement.
export async function GET(
  _request: Request,
  ctx: RouteContext<"/borrowers/[id]/spread/xlsx">,
) {
  const { id } = await ctx.params;
  return xlsxResponse((db, context) => spreadWorkbook(db, context, id));
}
