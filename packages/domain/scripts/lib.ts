import { createDb } from "@finance/db";
import type { Issue } from "../src";

export function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set. Copy .env.example to .env at the repo root and fill it in.",
    );
    process.exit(1);
  }
  return createDb(url);
}

export function printIssues(
  issues: readonly Issue[],
  rowByCode?: Map<string, number>,
) {
  for (const issue of issues) {
    const row =
      issue.row ??
      (issue.itemCode ? rowByCode?.get(issue.itemCode) : undefined);
    const where = row ? `row ${row}: ` : "";
    console.log(
      `  ${issue.severity === "error" ? "error  " : "warning"} ${where}${issue.message}`,
    );
  }
}
