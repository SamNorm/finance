import { analysisWorkbook } from "@finance/documents";
import { xlsxResponse } from "@/lib/xlsx";

// The analysis as a workbook: a sheet per scenario, as its results show.
export async function GET(
  _request: Request,
  ctx: RouteContext<"/analyses/[id]/xlsx">,
) {
  const { id } = await ctx.params;
  return xlsxResponse((db, context) => analysisWorkbook(db, context, id));
}
