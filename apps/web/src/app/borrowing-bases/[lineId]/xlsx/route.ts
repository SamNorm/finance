import { borrowingBaseWorkbook } from "@finance/documents";
import { xlsxResponse } from "@/lib/xlsx";

// A margined line's borrowing base as a workbook, month by month.
export async function GET(
  _request: Request,
  ctx: RouteContext<"/borrowing-bases/[lineId]/xlsx">,
) {
  const { lineId } = await ctx.params;
  return xlsxResponse((db, context) =>
    borrowingBaseWorkbook(db, context, lineId),
  );
}
