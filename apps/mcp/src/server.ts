import type { Db } from "@finance/db";
import type { Context } from "@finance/domain";
import { McpServer } from "@modelcontextprotocol/server";
import { analysisTools } from "./tools/analyses";
import { capexTools } from "./tools/capex";
import { borrowerTools } from "./tools/borrowers";
import { borrowingBaseTools } from "./tools/borrowing-bases";
import { consolidationTools } from "./tools/consolidation";
import { covenantTools } from "./tools/covenants";
import { creditLineTools } from "./tools/credit-lines";
import { documentTools } from "./tools/documents";
import { groupBorrowingBaseTools } from "./tools/group-borrowing-bases";
import { loanTools } from "./tools/loans";
import { projectedBorrowingBaseTools } from "./tools/projected-borrowing-bases";
import { projectTools } from "./tools/projects";
import { scenarioTools } from "./tools/scenarios";
import { spreadTools } from "./tools/spreads";

// The app's MCP server, acting for `ctx`. Its tools are business tasks over
// the domain package, as the web app's server actions are: inputs are
// untrusted, every call is scoped to the caller's organization, and the
// domain's checks apply as they do in the app.

// What the client's model reads first, to know what it's working with.
const INSTRUCTIONS = `Credit analysis for commercial lending.
- Borrowers have spreads: financial statements by period, entered against one of the organization's scoring models.
- An analysis runs a published financial model version over a borrower's periods. Its base case is the borrower as is. Its scenarios stress assumptions and can finance a project: sources and uses at closing (new loans, other funds), subordinations and adjustments. A project's effect shows in post-project values. A scenario can also plan capex in projected years, partly financed by loans whose debt service the model reads, and propose its deal's lines of credit.
- A borrower's lines of credit are real, like its existing loans: each has a currency, an annual rate and an authorized limit that can differ by season every year and step from a month. Analyses count their interest on the usage they assume (set_line_usage): a share of the limit, any month overridden with an amount drawn; a scenario can override it. A line with no usage assumed counts no interest, and run_analysis flags it. A scenario proposes its deal's lines (set_proposed_line): a new limit or rate, a new line, a line closed; they apply from closing post-project, or without a project from the first projected month. Change the borrower's lines only for terms in force.
- A line of credit can be margined on a borrowing base: its definition (collateral at advance rates up to caps, less ineligibles, prior claims and reserves) and the client's monthly certificates. You transcribe the client's figures (set_borrowing_base_values, or a paste previewed and confirmed); the app computes the borrowing base, the surplus and the tests (run_borrowing_base). Never compute them yourself. Advance rates, caps and reserves are terms that change from a month (set_borrowing_base_term), so past months keep theirs. Analyses project each margined line's months ahead, from the client's projected figures or from assumptions (run_analysis_borrowing_bases); a scenario adjusts them, and its deal can change a line's limit and borrowing base terms (set_proposed_line).
- Covenants are terms of a credit agreement, not of a model. A borrower's covenants in force are tested by every analysis of it; a scenario can propose its deal's own. Each tests a model line by code, at least or at most a threshold that can step by fiscal year. run_analysis reports each year's figure, threshold, margin and room before a breach.
- A project's sources must equal its uses before the analysis can be completed. Projects are built a piece at a time, so tell the user when totals don't match yet.
- Spreads come from the institution's scoring system. To enter one the user pastes, preview it, show the user what was read and get their confirmation, then import it.
- A consolidated client adds up other borrowers' spreads on the same scoring model, when there are no consolidated statements from the accountant: each period takes one set of statements per member, less eliminations of what they owe, sell or pay each other. Its figures, existing loans and lines of credit are its members': change them on the members. Its borrowing base adds up its members' margined lines month by month (get_group_borrowing_base); its own are only adjustments and the totals of a certificate the client sends for the group. Analyses run on it like on any borrower.
- A spread's critical errors (a balance sheet that doesn't balance, net income that isn't the one printed on the statements) keep its periods out of analyses until fixed. Retained earnings that don't roll forward are a warning; force them only when the user asks.
- Documents for the credit file are printed as PDFs with generate_document and kept as printed; give the user the link it returns. Every figure in them comes from the app. An analysis prints as the built-in documents (an analysis report, a deal summary, a debt summary) and the organization's own; list_document_templates says which.
- The organization's own documents are made of the app's sections (describe_document_sections). You can write one as a draft; a person reviews and publishes it in the app before analysts print it, so give the user its link.
- Find ids with list_borrowers and list_analyses; never guess one.
- Before changing anything, make sure you have what the user meant. Ask for missing figures, dates or which scenario rather than inventing them.
- The app never computes a risk rating, and you shouldn't either.`;

export function createServer(db: Db, ctx: Context): McpServer {
  const server = new McpServer(
    { name: "finance", title: "Credit analysis", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );
  borrowerTools(server, db, ctx);
  spreadTools(server, db, ctx);
  consolidationTools(server, db, ctx);
  analysisTools(server, db, ctx);
  scenarioTools(server, db, ctx);
  covenantTools(server, db, ctx);
  projectTools(server, db, ctx);
  capexTools(server, db, ctx);
  loanTools(server, db, ctx);
  creditLineTools(server, db, ctx);
  borrowingBaseTools(server, db, ctx);
  projectedBorrowingBaseTools(server, db, ctx);
  groupBorrowingBaseTools(server, db, ctx);
  documentTools(server, db, ctx);
  return server;
}
