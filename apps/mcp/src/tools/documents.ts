import type { Db } from "@finance/db";
import {
  getAnalysis,
  getCreditLine,
  getEntity,
  getOrganization,
  type Context,
} from "@finance/domain";
import {
  BUILT_IN_TEMPLATES,
  createTemplate,
  describeSections,
  generateDocument,
  getTemplate,
  listDocuments,
  listPrintableTemplates,
  listTemplates,
  sourceOf,
  templateModel,
  updateTemplate,
  type Block,
  type Definition,
  type TemplateDetail,
} from "@finance/documents";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { analysisId, borrowerId, scenarioId } from "../fields";
import { ADD, CHANGE, invalid, READ, respond } from "../respond";

// Documents for the credit file: PDFs printed from an analysis, or from a
// margined line of credit in a month (its borrowing base certificate, its
// margin history), from the built-in documents or the organization's own,
// and kept as printed. The client's AI asks for them; the app computes and
// prints every figure. It can also write an organization's document as a
// draft, made of the app's sections, for a person to review and publish in
// the app.

const app = () =>
  (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
// Where the app serves a document's PDF, and where a person edits one.
const pdfUrl = (id: string) => `${app()}/documents/${id}/pdf`;
const editorUrl = (id: string) => `${app()}/documents/templates/${id}`;

const templateId = z
  .string()
  .describe("An organization document's id, from list_document_templates.");

// What a section list sums up as: its kinds, and its headings' text.
const outline = (blocks: Block[]) =>
  blocks
    .filter((b) => b.type !== "pageBreak")
    .map((b) => (b.type === "heading" ? `heading: ${b.text}` : b.type));

const definition = (d: Definition) => ({
  // What it prints from: an analysis, or a margined line and a month.
  source: sourceOf(d),
  title: d.title,
  orientation: d.orientation,
  language: d.language ?? "en",
  sections: d.blocks,
});

const source = z
  .enum(["analysis", "line"])
  .optional()
  .describe(
    "What it prints from: analysis, or line, a margined line of credit in a month. Each section says which it fits (describe_document_sections).",
  );

const creditLineId = z
  .string()
  .describe(
    "A margined line of credit's id, from get_borrower or list_borrowing_bases.",
  );

// A consolidated client reads its members' lines as "member/line"; a line's
// documents are the member's line's own.
const ownLine = (id: string) => id.slice(id.lastIndexOf("/") + 1);

// A document of the organization's as the AI edits it: its draft, what's
// published, the draft's issues, and the model's lines and charts it can
// name.
async function detail(db: Db, ctx: Context, template: TemplateDetail) {
  const model = template.financialModel
    ? await templateModel(db, ctx, template.financialModel.id)
    : null;
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    // What its draft prints from: an analysis, or a margined line.
    source: template.source,
    status: template.status,
    unpublishedChanges: template.changed,
    financialModel: model && {
      id: model.id,
      name: model.name,
      publishedVersion: model.version,
    },
    draft: definition(template.draft),
    published: template.published && definition(template.published),
    issues: template.issues.map((i) => `${i.severity}: ${i.message}`),
    lines:
      model?.lines.flatMap((l) =>
        l.kind === "header" ? [] : [{ code: l.code, label: l.label }],
      ) ?? null,
    charts: model?.charts.map(({ id, title }) => ({ id, title })) ?? null,
    editorUrl: editorUrl(template.id),
  };
}

// The workbooks the app builds on request, and what each holds.
const WORKBOOKS = {
  analysis:
    "The analysis: a summary, then the base case and each scenario, its model's lines over its periods with post-project columns, the covenants tested, and its sources and uses.",
  spread:
    "The borrower's spread: a sheet per statement, figures by period, and the checks against the statements.",
  existing_debt:
    "The borrower's existing loans and lines of credit, and each loan's payments until it's repaid.",
  borrowing_base:
    "A margined line's borrowing base month by month, its tests, and its certificates.",
};

export function documentTools(server: McpServer, db: Db, ctx: Context) {
  server.registerTool(
    "get_excel_link",
    {
      title: "Get an Excel workbook's link",
      description:
        "A link to download an Excel workbook the app builds from the figures as they stand when it's opened; nothing is kept. analysis (analysisId): every scenario's results, covenants and sources and uses. spread (borrowerId): the statements by period. existing_debt (borrowerId): loans, lines of credit and each loan's payments. borrowing_base (creditLineId): a margined line month by month. Give the user the link; the workbook holds values, while the app keeps each figure's lineage.",
      inputSchema: z.object({
        workbook: z.enum([
          "analysis",
          "spread",
          "existing_debt",
          "borrowing_base",
        ]),
        analysisId: analysisId.optional(),
        borrowerId: borrowerId.optional(),
        creditLineId: creditLineId.optional(),
      }),
      annotations: READ,
    },
    ({ workbook, analysisId, borrowerId, creditLineId }) =>
      respond(async () => {
        const needs = {
          analysis: "analysisId",
          spread: "borrowerId",
          existing_debt: "borrowerId",
          borrowing_base: "creditLineId",
        }[workbook];
        const given = { analysisId, borrowerId, creditLineId };
        if (
          !given[needs as keyof typeof given] ||
          Object.values(given).filter(Boolean).length > 1
        )
          throw invalid(`The ${workbook} workbook takes ${needs} alone.`);
        let path: string;
        if (workbook === "analysis") {
          const { analysis } = await getAnalysis(db, ctx, analysisId!);
          path = `/analyses/${analysis.id}/xlsx`;
        } else if (workbook === "borrowing_base") {
          const line = await getCreditLine(db, ctx, ownLine(creditLineId!));
          if (!line.borrowingBase)
            throw invalid(`${line.name} isn't margined.`);
          path = `/borrowing-bases/${line.id}/xlsx`;
        } else {
          const entity = await getEntity(db, ctx, borrowerId!);
          path = `/borrowers/${entity.id}/${workbook === "spread" ? "spread" : "debt"}/xlsx`;
        }
        return { url: `${app()}${path}`, holds: WORKBOOKS[workbook] };
      }),
  );

  server.registerTool(
    "list_document_templates",
    {
      title: "List documents to print",
      description:
        "With an analysisId, the documents that analysis can be printed as: the organization's own published ones that fit its financial model, then the built-ins it offers. With a creditLineId, those a margined line prints as in a month, such as its borrowing base certificate and margin history. Without either, every document, each with what it prints from (analysis or line): the organization's, with their status, and the built-ins, with whether they're hidden.",
      inputSchema: z.object({
        analysisId: analysisId.optional(),
        creditLineId: creditLineId.optional(),
      }),
      annotations: READ,
    },
    ({ analysisId, creditLineId }) =>
      respond(async () => {
        if (analysisId && creditLineId)
          throw invalid("Pass an analysisId or a creditLineId, not both.");
        if (creditLineId) {
          const line = await getCreditLine(db, ctx, ownLine(creditLineId));
          if (!line.borrowingBase)
            throw invalid(
              `${line.name} isn't margined: only a margined line prints borrowing base documents.`,
            );
          return (await listPrintableTemplates(db, ctx, null, "line")).map(
            (t) => ({
              template: t.key,
              name: t.name,
              description: t.description,
              builtIn: t.builtIn,
            }),
          );
        }
        if (analysisId) {
          const { model } = await getAnalysis(db, ctx, analysisId);
          return (await listPrintableTemplates(db, ctx, model.id)).map((t) => ({
            template: t.key,
            name: t.name,
            description: t.description,
            builtIn: t.builtIn,
          }));
        }
        const [own, organization] = await Promise.all([
          listTemplates(db, ctx),
          getOrganization(db, ctx),
        ]);
        return [
          ...own.map((t) => ({
            template: t.id,
            name: t.name,
            description: t.description,
            builtIn: false,
            source: t.source,
            status: t.status,
            unpublishedChanges: t.changed,
            financialModel: t.financialModel?.name ?? null,
          })),
          ...BUILT_IN_TEMPLATES.map((t) => ({
            template: t.key,
            name: t.name,
            description: t.description,
            builtIn: true,
            source: sourceOf(t),
            hidden: organization.hiddenBuiltIns.includes(t.key),
            sections: outline(t.blocks),
          })),
        ];
      }),
  );

  server.registerTool(
    "generate_document",
    {
      title: "Print a document",
      description:
        "Prints a PDF and keeps it as printed for the credit file, as one of the documents list_document_templates gives: from an analysis (analysisId), for the base case or a scenario; or from a margined line of credit (creditLineId) in a month, such as its borrowing base certificate for the client to sign, or its margin history to that month. Returns a link to it for the user. A deal summary needs a scenario with a project. Each month's certificate is kept as printed; printing again makes a new one.",
      inputSchema: z.object({
        analysisId: analysisId
          .optional()
          .describe("For a document printed from an analysis."),
        scenarioId: scenarioId
          .optional()
          .describe(
            "The scenario an analysis's document shows; the base case when omitted.",
          ),
        creditLineId: creditLineId
          .optional()
          .describe("For a document printed from a margined line of credit."),
        month: z
          .string()
          .optional()
          .describe(
            'A line\'s month with a certificate, as YYYY-MM: "2025-11"; the latest when omitted.',
          ),
        template: z
          .string()
          .describe(
            'A built-in\'s key, e.g. "deal-summary" or "borrowing-base-certificate", or an organization document\'s id, from list_document_templates.',
          ),
      }),
      annotations: ADD,
    },
    ({ analysisId, scenarioId, creditLineId, month, template }) =>
      respond(async () => {
        if (!analysisId === !creditLineId)
          throw invalid(
            "Pass an analysisId to print from an analysis, or a creditLineId (and a month) to print a margined line's documents.",
          );
        if (creditLineId && scenarioId)
          throw invalid("A line's documents have no scenario.");
        if (analysisId && month)
          throw invalid(
            "A month is for a line's documents; an analysis prints its periods.",
          );
        const document = await generateDocument(db, ctx, {
          analysisId: analysisId ?? null,
          scenarioId: scenarioId ?? null,
          creditLineId: creditLineId ? ownLine(creditLineId) : null,
          month: month ?? null,
          template,
        });
        return {
          id: document.id,
          title: document.title,
          ...(document.month ? { month: document.month } : {}),
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
        "The documents printed for an analysis, a line of credit or a borrower, newest first, each with a link to its PDF as printed: an analysis's with its scenario, a line's with its month.",
      inputSchema: z.object({
        analysisId: analysisId.optional(),
        creditLineId: creditLineId.optional(),
        borrowerId: borrowerId.optional(),
      }),
      annotations: READ,
    },
    ({ analysisId, creditLineId, borrowerId }) =>
      respond(async () => {
        if ([analysisId, creditLineId, borrowerId].filter(Boolean).length !== 1)
          throw invalid("Pass an analysisId, a creditLineId or a borrowerId.");
        return (
          await listDocuments(db, ctx, {
            analysisId,
            creditLineId: creditLineId && ownLine(creditLineId),
            entityId: borrowerId,
          })
        ).map((d) => ({
          id: d.id,
          title: d.title,
          document: d.templateName,
          ...(d.creditLineId
            ? { creditLineId: d.creditLineId, line: d.lineName, month: d.month }
            : {
                analysisId: d.analysisId,
                analysis: d.analysisName,
                scenario: d.scenarioName ?? "Base case",
              }),
          pages: d.pages,
          printedAt: d.createdAt,
          url: pdfUrl(d.id),
        }));
      }),
  );

  server.registerTool(
    "describe_document_sections",
    {
      title: "Describe document sections",
      description:
        "The sections an organization's document is made of, each with its settings and the sources it prints from (an analysis, or a margined line in a month); the conditions a section can show on (`when`, an analysis's only); and the merge fields its title, headings and text take: mergeFields for a document from an analysis, lineMergeFields for one from a line ({{bb.month}}, {{bb.BB_SURPLUS}}…). Read it before writing a document's sections with set_document_template.",
      inputSchema: z.object({}),
      annotations: READ,
    },
    () => respond(async () => describeSections()),
  );

  server.registerTool(
    "get_document_template",
    {
      title: "Get an organization's document",
      description:
        "One of the organization's documents: its draft (title, orientation, sections), what's published, the draft's issues, and the lines and charts of the financial model it reads, which its sections can name. Includes a link for the user to open it in the app.",
      inputSchema: z.object({ templateId }),
      annotations: READ,
    },
    ({ templateId }) =>
      respond(async () =>
        detail(db, ctx, await getTemplate(db, ctx, templateId)),
      ),
  );

  server.registerTool(
    "create_document_template",
    {
      title: "Create a document",
      description:
        "Starts one of the organization's documents as a draft: blank, or a copy of a built-in or of one of its own, which prints from what its original does. A document prints from an analysis (the default) or from a margined line of credit in a month (source line), such as a certificate in the organization's own layout. Give one from an analysis a financial model to name that model's lines and charts; it then prints for analyses on that model. Analysts print it only once a person publishes it in the app: give the user the link to review it.",
      inputSchema: z.object({
        name: z.string().describe('e.g. "Credit memo".'),
        description: z
          .string()
          .optional()
          .describe("What it's for, as analysts see it when they print."),
        financialModelId: z
          .string()
          .optional()
          .describe(
            "The model whose lines and charts it names, from list_financial_models. A copy of one of the organization's documents reads its model when omitted.",
          ),
        from: z
          .string()
          .optional()
          .describe(
            "A built-in's key or a document's id to copy, from list_document_templates; blank when omitted.",
          ),
        source,
      }),
      annotations: ADD,
    },
    (input) =>
      respond(async () =>
        detail(
          db,
          ctx,
          await createTemplate(db, ctx, {
            name: input.name,
            description: input.description,
            financialModelId: input.financialModelId,
            from: input.from,
            source: input.source,
          }),
        ),
      ),
  );

  server.registerTool(
    "set_document_template",
    {
      title: "Write a document's draft",
      description:
        "Changes one of the organization's documents: its name, description or model, and its draft's source (what it prints from), title, orientation, language or sections. Sections replace the whole list, in order; each is an object with a `type` and that section's settings from describe_document_sections, and optionally `when`. Returns the draft with its issues, which a person must clear before publishing it in the app. Figures belong in merge fields, never typed.",
      inputSchema: z.object({
        templateId,
        name: z.string().optional(),
        description: z.string().optional(),
        financialModelId: z
          .string()
          .nullable()
          .optional()
          .describe(
            "The model it reads, or null for none. A published document stays on its model.",
          ),
        source,
        title: z
          .string()
          .optional()
          .describe(
            'With merge fields, e.g. "{{borrower.name}}: credit memo".',
          ),
        orientation: z
          .enum(["portrait", "landscape"])
          .optional()
          .describe("Landscape fits every period of an analysis."),
        language: z
          .enum(["en", "fr"])
          .optional()
          .describe(
            "The language of the document's own wording (its tables' headings, notes, page numbers) and of its figures and dates. Line labels print as the model has them; write headings and text in the same language.",
          ),
        sections: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe(
            'The whole list, e.g. [{"type":"facts"},{"type":"lines","lines":["DSCR"],"periods":"recent"},{"type":"text","text":"...","when":"project"}].',
          ),
      }),
      annotations: CHANGE,
    },
    ({ templateId, sections, ...change }) =>
      respond(async () =>
        detail(
          db,
          ctx,
          await updateTemplate(db, ctx, templateId, {
            ...change,
            blocks: sections,
          }),
        ),
      ),
  );
}
