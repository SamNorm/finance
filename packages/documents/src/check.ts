import type { ChartDefinition, Issue, ModelLine } from "@finance/domain";
import {
  CONDITIONS,
  MERGE_FIELD,
  MERGE_FIELDS,
  type Block,
  type BlockType,
  type Definition,
} from "./templates";

// A template's definition as given, from the editor or from MCP as JSON:
// parsed into blocks, then checked against the financial model it reads
// (documents-plan.md §6.3). What can't be stored stops a save; any error
// stops publishing.

// What a document's blocks are called where people see them.
export const SECTIONS: Record<BlockType, string> = {
  heading: "Heading",
  text: "Text",
  facts: "Facts",
  lines: "Model lines",
  covenants: "Covenants",
  charts: "Charts",
  sourcesUses: "Sources and uses",
  debt: "Debt",
  amortization: "Schedules by year",
  pageBreak: "Page break",
};

// Each block's settings besides `type` and `when`, and what each holds.
const SETTINGS: Record<
  BlockType,
  Record<string, "text" | "codes" | "periods">
> = {
  heading: { text: "text" },
  text: { text: "text" },
  facts: {},
  lines: { title: "text", lines: "codes", periods: "periods" },
  covenants: {},
  charts: { charts: "codes" },
  sourcesUses: {},
  debt: {},
  amortization: {},
  pageBreak: {},
};

const MAX_BLOCKS = 100;
const MAX_TEXT = 10_000;

// The lines and charts of the model a template reads: its latest published
// version's.
export interface TemplateModel {
  name: string;
  lines: Pick<ModelLine, "code" | "kind">[];
  charts: Pick<ChartDefinition, "id">[];
}

const error = (code: string, message: string, itemCode?: string): Issue => ({
  severity: "error",
  code,
  message,
  ...(itemCode ? { itemCode } : {}),
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// "Section 3 (Model lines)", as issues name a block.
const where = (index: number, type: BlockType) =>
  `Section ${index + 1} (${SECTIONS[type]})`;

// Blocks from untrusted JSON. Issues are what keeps them from being stored:
// an unknown section or setting, or a setting of the wrong kind.
export function parseBlocks(input: unknown): {
  blocks: Block[];
  issues: Issue[];
} {
  if (!Array.isArray(input))
    return {
      blocks: [],
      issues: [error("not_a_list", "The sections must be a list.")],
    };
  if (input.length > MAX_BLOCKS)
    return {
      blocks: [],
      issues: [
        error(
          "too_many",
          `Keep a document to ${MAX_BLOCKS} sections or fewer.`,
        ),
      ],
    };
  const issues: Issue[] = [];
  const blocks = input.flatMap((raw, index): Block[] => {
    const at = `Section ${index + 1}`;
    if (!isRecord(raw) || typeof raw.type !== "string") {
      issues.push(error("no_type", `${at} needs a type.`));
      return [];
    }
    const type = raw.type as BlockType;
    const settings = Object.hasOwn(SETTINGS, type) ? SETTINGS[type] : null;
    if (!settings) {
      issues.push(
        error(
          "unknown_section",
          `${at}: "${raw.type}" isn't a section. Choose one of: ${Object.keys(SETTINGS).join(", ")}.`,
        ),
      );
      return [];
    }
    const block: Record<string, unknown> = { type };
    let ok = true;
    const fail = (code: string, message: string) => {
      issues.push(error(code, `${where(index, type)}: ${message}`));
      ok = false;
    };
    for (const [key, value] of Object.entries(raw)) {
      if (key === "type" || value === undefined || value === null) continue;
      if (key === "when") {
        if (typeof value === "string" && Object.hasOwn(CONDITIONS, value))
          block.when = value;
        else
          fail(
            "invalid_setting",
            `"when" is one of: ${Object.keys(CONDITIONS).join(", ")}.`,
          );
        continue;
      }
      const kind = Object.hasOwn(settings, key) ? settings[key] : undefined;
      if (!kind) {
        fail(
          "unknown_setting",
          `"${key}" isn't one of its settings${Object.keys(settings).length ? ` (${Object.keys(settings).join(", ")})` : ""}.`,
        );
      } else if (kind === "text") {
        if (typeof value !== "string")
          fail("invalid_setting", `"${key}" is text.`);
        else if (value.length > MAX_TEXT)
          fail(
            "invalid_setting",
            `keep "${key}" under ${MAX_TEXT.toLocaleString("en-CA")} characters.`,
          );
        else block[key] = type === "text" ? value : value.trim();
      } else if (kind === "codes") {
        if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
          fail("invalid_setting", `"${key}" is a list of codes.`);
        else
          block[key] = [
            ...new Set(
              (value as string[]).map((v) => v.trim()).filter(Boolean),
            ),
          ];
      } else if (value === "all" || value === "recent") {
        block[key] = value;
      } else {
        fail("invalid_setting", `"${key}" is "all" or "recent".`);
      }
    }
    if ((type === "heading" || type === "text") && block.text === undefined)
      block.text = "";
    // A blank title shows none.
    if (block.title === "") delete block.title;
    return ok ? [block as Block] : [];
  });
  return { blocks, issues };
}

// What would keep a definition from being published: sections it doesn't
// have, settings left blank, and lines, charts or merge fields the model
// doesn't have.
export function checkDefinition(
  definition: Definition,
  model: TemplateModel | null,
): Issue[] {
  const issues: Issue[] = [];
  const codes = new Set(
    model?.lines.filter((l) => l.kind !== "header").map((l) => l.code),
  );
  const charts = new Set(model?.charts.map((c) => c.id));
  const noModel = "choose the financial model it reads first.";

  const fields = (text: string, at: string) => {
    for (const [whole, path] of text.matchAll(MERGE_FIELD)) {
      const [head, code, post, ...rest] = path!.split(".");
      if (
        head === "line" &&
        code &&
        (!post || post === "post") &&
        !rest.length
      ) {
        if (!model)
          issues.push(
            error("no_model", `${at}: ${whole} names a line; ${noModel}`),
          );
        else if (!codes.has(code))
          issues.push(
            error(
              "unknown_line",
              `${at}: ${model.name} has no line ${code}.`,
              code,
            ),
          );
      } else if (!Object.hasOwn(MERGE_FIELDS, path!)) {
        issues.push(
          error("unknown_field", `${at}: ${whole} isn't a merge field.`),
        );
      }
    }
  };

  if (!definition.title.trim())
    issues.push(error("no_title", "Give the document a title."));
  fields(definition.title, "The title");
  if (!definition.blocks.length) issues.push(error("empty", "Add a section."));
  definition.blocks.forEach((block, index) => {
    const at = where(index, block.type);
    switch (block.type) {
      case "heading":
      case "text":
        if (!block.text.trim())
          issues.push(error("blank", `${at}: write its text.`));
        fields(block.text, at);
        break;
      case "lines":
        if (block.title) fields(block.title, at);
        if (!block.lines) break;
        if (!block.lines.length)
          issues.push(
            error("blank", `${at}: pick its lines, or show all of them.`),
          );
        else if (!model) issues.push(error("no_model", `${at}: ${noModel}`));
        else
          for (const code of block.lines)
            if (!codes.has(code))
              issues.push(
                error(
                  "unknown_line",
                  `${at}: ${model.name} has no line ${code}.`,
                  code,
                ),
              );
        break;
      case "charts":
        if (!block.charts) break;
        if (!block.charts.length)
          issues.push(
            error("blank", `${at}: pick its charts, or show all of them.`),
          );
        else if (!model) issues.push(error("no_model", `${at}: ${noModel}`));
        else
          for (const id of block.charts)
            if (!charts.has(id))
              issues.push(
                error(
                  "unknown_chart",
                  `${at}: ${model.name} has no chart ${id}.`,
                ),
              );
        break;
    }
  });
  return issues;
}
