import type { Db } from "@finance/db";
import type { Context } from "@finance/domain";
import type { McpServer } from "@modelcontextprotocol/server";
import { analysisTools } from "./analyses";
import { capexTools } from "./capex";
import { commentTools } from "./comments";
import { borrowerTools } from "./borrowers";
import { borrowingBaseTemplateTools } from "./borrowing-base-templates";
import { borrowingBaseTools } from "./borrowing-bases";
import { consolidationTools } from "./consolidation";
import { covenantTools } from "./covenants";
import { creditLineTools } from "./credit-lines";
import { documentTools } from "./documents";
import { groupBorrowingBaseTools } from "./group-borrowing-bases";
import { loanTools } from "./loans";
import { projectedBorrowingBaseTools } from "./projected-borrowing-bases";
import { projectTools } from "./projects";
import { scenarioTools } from "./scenarios";
import { spreadTools } from "./spreads";

// Every tool, registered on `server` for `ctx`. Registering reads neither:
// they're used when a tool is called.
export function registerTools(server: McpServer, db: Db, ctx: Context) {
  borrowerTools(server, db, ctx);
  spreadTools(server, db, ctx);
  consolidationTools(server, db, ctx);
  analysisTools(server, db, ctx);
  scenarioTools(server, db, ctx);
  covenantTools(server, db, ctx);
  commentTools(server, db, ctx);
  projectTools(server, db, ctx);
  capexTools(server, db, ctx);
  loanTools(server, db, ctx);
  creditLineTools(server, db, ctx);
  borrowingBaseTools(server, db, ctx);
  projectedBorrowingBaseTools(server, db, ctx);
  groupBorrowingBaseTools(server, db, ctx);
  borrowingBaseTemplateTools(server, db, ctx);
  documentTools(server, db, ctx);
}
