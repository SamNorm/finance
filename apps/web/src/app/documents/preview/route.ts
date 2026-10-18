import { DomainError } from "@finance/domain";
import { previewDocument } from "@finance/documents";
import { getContext, getDb } from "@/lib/server";

// A document as HTML, rendered from the analysis as it stands and not kept:
// a quick look before generating the PDF. The browser's print gives the same
// pages. ?analysis=…&template=…, and &scenario=… for a scenario.
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  try {
    const { html } = await previewDocument(getDb(), await getContext(), {
      analysisId: query.get("analysis") ?? "",
      scenarioId: query.get("scenario") || null,
      template: query.get("template") ?? "",
    });
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        // The page is the app's own markup: nothing runs in it.
        "Content-Security-Policy":
          "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      },
    });
  } catch (error) {
    if (error instanceof DomainError)
      return new Response(error.message, {
        status: error.kind === "not_found" ? 404 : 400,
      });
    throw error;
  }
}
