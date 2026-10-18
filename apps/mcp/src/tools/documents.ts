import type { Db } from "@finance/db";
import type { Context } from "@finance/domain";
import {
  BUILT_IN_TEMPLATES,
  generateDocument,
  listDocuments,
} from "@finance/documents";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { analysisId, borrowerId, scenarioId } from "../fields";
import { ADD, invalid, READ, respond } from "../respond";

// Documents for the credit file: PDFs printed from an analysis, from the
// organization's templates, and kept as printed. The client's AI asks for
// them; the app computes and prints every figure.

// Where the app serves a document's PDF.
const pdfUrl = (id: string) =>
  `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/documents/${id}/pdf`;

export function documentTools(server: McpServer, db: Db, ctx: Context) {
  server.registerTool(
    "list_document_templates",
    {
      title: "List documents to print",
      description:
        "The documents an analysis can be printed as, such as an analysis report or a deal summary, and the blocks each is made of.",
      inputSchema: z.object({}),
      annotations: READ,
    },
    () =>
      respond(async () =>
        BUILT_IN_TEMPLATES.map((t) => ({
          template: t.key,
          name: t.name,
          description: t.description,
          blocks: t.blocks
            .filter((b) => b.type !== "pageBreak")
            .map((b) => (b.type === "heading" ? `heading: ${b.text}` : b.type)),
        })),
      ),
  );

  server.registerTool(
    "generate_document",
    {
      title: "Print a document",
      description:
        "Prints a PDF of an analysis, for the base case or a scenario, from a template of list_document_templates, and keeps it as printed for the credit file. Returns a link to it for the user. A deal summary needs a scenario with a project.",
      inputSchema: z.object({
        analysisId,
        scenarioId: scenarioId
          .optional()
          .describe("The scenario it shows; the base case when omitted."),
        template: z
          .string()
          .describe('From list_document_templates, e.g. "deal-summary".'),
      }),
      annotations: ADD,
    },
    ({ analysisId, scenarioId, template }) =>
      respond(async () => {
        const document = await generateDocument(db, ctx, {
          analysisId,
          scenarioId: scenarioId ?? null,
          template,
        });
        return {
          id: document.id,
          title: document.title,
          pages: document.pages,
          url: pdfUrl(document.id),
        };
      }),
  );

  server.registerTool(
    "list_documents",
    {
      title: "List printed documents",
      description:
        "The documents printed for an analysis or a borrower, newest first, each with a link to its PDF as printed.",
      inputSchema: z.object({
        analysisId: analysisId.optional(),
        borrowerId: borrowerId.optional(),
      }),
      annotations: READ,
    },
    ({ analysisId, borrowerId }) =>
      respond(async () => {
        if (!analysisId === !borrowerId)
          throw invalid("Pass an analysisId or a borrowerId.");
        return (
          await listDocuments(db, ctx, { analysisId, entityId: borrowerId })
        ).map((d) => ({
          id: d.id,
          title: d.title,
          document: d.templateName,
          analysisId: d.analysisId,
          analysis: d.analysisName,
          scenario: d.scenarioName ?? "Base case",
          pages: d.pages,
          printedAt: d.createdAt,
          url: pdfUrl(d.id),
        }));
      }),
  );
}
