// Imports an item list (CSV, or TSV pasted from Excel) into the draft of one of
// the dev organization's scoring models, creating the model or the draft when
// needed, and shows what changed since the latest published version. The
// model is found by name (--name, or the file name), case-insensitively.
//
//   pnpm import-scoring-model <file> [--dry-run] [--publish]
//     [--name <model name>] [--source mirrored|native] [--system <source system>]
import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  createDraft,
  createScoringModel,
  devContext,
  ensureDevOrganization,
  diffItems,
  getScoringModel,
  listScoringModels,
  hasErrors,
  isStructural,
  listItems,
  parseItemTable,
  publishVersion,
  replaceItems,
  validateItems,
  type ScoringItem,
} from "../src";
import { connect, printIssues } from "./lib";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean", default: false },
    publish: { type: "boolean", default: false },
    name: { type: "string" },
    source: { type: "string", default: "mirrored" },
    system: { type: "string" },
  },
});

const [file] = positionals;
if (!file || (args.source !== "mirrored" && args.source !== "native")) {
  console.error(
    "Usage: pnpm import-scoring-model <file> [--dry-run] [--publish] [--name <name>] [--source mirrored|native] [--system <source system>]",
  );
  process.exit(1);
}

// pnpm runs scripts from the package folder; resolve the path from where the
// command was typed.
const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
const {
  items,
  issues: parseIssues,
  rowByCode,
} = parseItemTable(readFileSync(path, "utf8"));
const issues = [...parseIssues, ...validateItems(items)];

console.log(`${basename(path)}: ${items.length} items`);
for (const statement of new Set(items.map((item) => item.statement))) {
  const list = items.filter((item) => item.statement === statement);
  const subtotals = list.filter((item) => item.kind === "subtotal").length;
  console.log(
    `  ${statement.padEnd(16)} ${String(list.length).padStart(4)} items, ${subtotals} subtotals`,
  );
}
if (issues.length) {
  console.log("\nIssues:");
  printIssues(issues, rowByCode);
}
if (hasErrors(parseIssues) || issues.some(isStructural)) {
  console.error("\nFix the errors above, then import again.");
  process.exit(1);
}
if (args["dry-run"]) process.exit(0);

const db = connect();
try {
  await ensureDevOrganization(db);
  const name = args.name ?? basename(path, extname(path));
  let model = (await listScoringModels(db, devContext)).find(
    (m) => m.name.toLowerCase() === name.toLowerCase(),
  );
  if (!model) {
    const created = await createScoringModel(db, devContext, {
      name,
      source: args.source,
      sourceSystem: args.system,
    });
    model = await getScoringModel(db, devContext, created.model.id);
    console.log(`\nCreated the scoring model "${model.name}".`);
  }
  const draft =
    model.versions.find((v) => v.status === "draft") ??
    (await createDraft(db, devContext, model.id));
  const base = model.versions.findLast((v) => v.status === "published");

  await replaceItems(db, devContext, draft.id, items);
  console.log(`\nSaved into draft v${draft.number}.`);
  if (base)
    printDiff(base.number, await listItems(db, devContext, base.id), items);

  if (args.publish) {
    if (hasErrors(issues)) {
      console.error("Not published: the draft still has errors.");
      process.exitCode = 1;
    } else {
      await publishVersion(db, devContext, draft.id);
      console.log(`Published v${draft.number}.`);
    }
  }
} finally {
  await db.$client.end();
}

function printDiff(
  baseNumber: number,
  before: ScoringItem[],
  after: ScoringItem[],
) {
  const { added, removed, changed } = diffItems(before, after);
  console.log(
    `Compared with v${baseNumber}: ${added.length} added, ${removed.length} removed, ${changed.length} changed.`,
  );
  for (const code of added) console.log(`  + ${code}`);
  for (const code of removed) console.log(`  - ${code}`);
  for (const { code, changes } of changed) {
    const detail = changes.map(
      (c) => `${c.field}: ${c.before ?? "∅"} → ${c.after ?? "∅"}`,
    );
    console.log(`  ~ ${code} (${detail.join("; ")})`);
  }
}
