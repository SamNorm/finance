import { createServer as createHttpServer } from "node:http";
import { createDb } from "@finance/db";
import { devContext, ensureDevOrganization } from "@finance/domain";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "./server";

// Serves the MCP server over Streamable HTTP at /mcp, a fresh server per
// request. There's no sign-in yet (§9.5): every request acts as the dev
// organization. So the server listens on this machine only, and answers only
// requests addressed to localhost, which a web page can't forge to reach it.
// Authentication replaces `devContext` with the caller's, from a verified
// token, and lifts both limits.

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set. Copy .env.example to .env at the repo root and fill it in.",
  );
  process.exit(1);
}
const port = Number(process.env.MCP_PORT || 3001);
const db = createDb(url);
await ensureDevOrganization(db);

const onerror = (error: Error) => console.error(error);
const handle = toNodeHandler(
  createMcpHandler(() => createServer(db, devContext), { onerror }),
  { onerror },
);
const validHost = localhostHostValidation();
const validOrigin = localhostOriginValidation();

createHttpServer(async (req, res) => {
  if (!validHost(req, res) || !validOrigin(req, res)) return;
  if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") {
    res.writeHead(404).end();
    return;
  }
  await handle(req, res);
}).listen(port, "127.0.0.1", () => {
  console.log(`MCP server at http://localhost:${port}/mcp`);
});
