import { DomainError } from "@finance/domain";
import { getDocumentPdf } from "@finance/documents";
import { getContext, getDb } from "@/lib/server";

// A generated document's PDF, as it was kept: shown in the browser, and
// saved under its title.
export async function GET(
  _request: Request,
  ctx: RouteContext<"/documents/[id]/pdf">,
) {
  const { id } = await ctx.params;
  try {
    const { title, pdf } = await getDocumentPdf(
      getDb(),
      await getContext(),
      id,
    );
    const file = `${title.replace(/[^\p{L}\p{N} ._-]+/gu, " ").trim()}.pdf`;
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof DomainError)
      return new Response(error.message, { status: 404 });
    throw error;
  }
}
