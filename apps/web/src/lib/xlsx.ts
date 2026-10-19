import "server-only";
import type { Db } from "@finance/db";
import { DomainError, type Context } from "@finance/domain";
import type { WorkbookFile } from "@finance/documents";
import { getContext, getDb } from "./server";

// A workbook built on request, downloaded under its name. Nothing is kept:
// it reads the figures as they stand.
export async function xlsxResponse(
  build: (db: Db, ctx: Context) => Promise<WorkbookFile>,
) {
  try {
    const { filename, data } = await build(getDb(), await getContext());
    return new Response(Buffer.from(data), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof DomainError)
      return new Response(error.message, { status: 404 });
    throw error;
  }
}
