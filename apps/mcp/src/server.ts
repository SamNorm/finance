import type { Db } from "@finance/db";
import type { Context } from "@finance/domain";
import { McpServer } from "@modelcontextprotocol/server";
import { analysisTools } from "./tools/analyses";
import { borrowerTools } from "./tools/borrowers";
import { loanTools } from "./tools/loans";
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
- An analysis runs a published financial model version over a borrower's periods. Its base case is the borrower as is. Its scenarios stress assumptions and can finance a project: sources and uses at closing (new loans, other funds), line of credit increases and subordinations. A project's effect shows in post-project values.
- A project's sources must equal its uses before the analysis can be completed. Projects are built a piece at a time, so tell the user when totals don't match yet.
- Spreads come from the institution's scoring system. To enter one the user pastes, preview it, show the user what was read and get their confirmation, then import it.
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
  analysisTools(server, db, ctx);
  scenarioTools(server, db, ctx);
  projectTools(server, db, ctx);
  loanTools(server, db, ctx);
  return server;
}
