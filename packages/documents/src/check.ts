import {
  TOTALS,
  type ChartDefinition,
  type Issue,
  type ModelLine,
} from "@finance/domain";
import { MAX_BB_MONTHS } from "./data";
import {
  CONDITIONS,
  LINE_MERGE_FIELDS,
  MERGE_FIELD,
  MERGE_FIELDS,
  SECTIONS,
  SOURCES,
  sourceOf,
  type Block,
  type BlockType,
  type Definition,
} from "./templates";

// A template's definition as given, from the editor or from MCP as JSON:
// parsed into blocks, then checked against what it prints from: the
// financial model an analysis runs on, or a margined line, whose blocks
// read any borrower's lines (documents-plan.md §6.3,
// borrowing-base-plan.md §12). What can't be stored stops a save; any error
// stops publishing.

// Each block's settings besides `type` and `when`: what each holds, and
// what it does, as MCP clients read it (describeSections).
type Setting = {
  kind: "text" | "codes" | "periods" | "months";
  help: string;
};

const MONTHS_HELP = (what: string, fallback: number) =>
  `${what}, 1 to ${MAX_BB_MONTHS}; ${fallback} when omitted.`;

const SETTINGS: Record<BlockType, Record<string, Setting>> = {
  heading: {
    text: { kind: "text", help: "The heading, with merge fields." },
  },
  text: {
    text: {
      kind: "text",
      help: 'Paragraphs with a blank line between them; lines starting "- " are bullets; **bold** and *italics*; merge fields for every figure.',
    },
  },
  facts: {},
  lines: {
    title: {
      kind: "text",
      help: "Shown above the table, with merge fields. Optional.",
    },
    lines: {
      kind: "codes",
      help: "Codes of the lines to show, printed in the model's order. Omit for every line, by section. Naming lines needs the document to read a financial model.",
    },
    periods: {
      kind: "periods",
      help: '"all" for every period, or "recent" for the latest fiscal year and what follows it.',
    },
  },
  covenants: {},
  charts: {
    charts: {
      kind: "codes",
      help: "Ids of the charts to show. Omit for every chart: the model's and the analysis's own, or a line's borrowing base's. Naming a model's charts needs the document to read a financial model.",
    },
    months: {
      kind: "months",
      help: MONTHS_HELP(
        "From a line: the months its charts cover, up to the month printed",
        12,
      ),
    },
  },
  sourcesUses: {},
  debt: {},
  amortization: {},
  bbWaterfall: {},
  bbHistory: {
    lines: {
      kind: "codes",
      help: "Codes of the figures to show month by month, in this order: totals such as BB_TOTAL, BB_USAGE and BB_SURPLUS, or the borrowing base's own lines such as AR.MARGINED. Omit for the main totals.",
    },
    months: {
      kind: "months",
      help: MONTHS_HELP("The months shown, up to the month printed", 12),
    },
  },
  bbTests: {
    months: {
      kind: "months",
      help: MONTHS_HELP(
        "The months tested, up to the month printed; 1 for the month's tests alone",
        12,
      ),
    },
  },
  bbCycle: {},
  bbProjection: {
    lines: {
      kind: "codes",
      help: "Codes of the figures to show month by month, such as BB_TOTAL, BB_LIMIT and BB_SURPLUS. Omit for the main totals.",
    },
  },
  bbSignature: {
    text: {
      kind: "text",
      help: "The statement above the signature lines, with merge fields. Omit for the app's: that the information above is true and complete.",
    },
  },
  pageBreak: {},
};

// The sections a document is made of, each with its settings, the
// conditions any can show on, and the merge fields text takes: what an AI
// client reads before writing a document's sections.
export function describeSections() {
  return {
    // What a document prints from, as its definition's "source" says.
    sources: SOURCES,
    sections: (Object.keys(SECTIONS) as BlockType[]).map((type) => ({
      type,
      label: SECTIONS[type].label,
      description: SECTIONS[type].description,
      sources: SECTIONS[type].sources,
      settings: Object.fromEntries(
        Object.entries(SETTINGS[type]).map(([key, { help }]) => [key, help]),
      ),
    })),
    // Conditions are about an analysis; a document printed from a line
    // takes none.
    when: CONDITIONS,
    mergeFields: {
      ...MERGE_FIELDS,
      "line.CODE":
        "A line's figure in the latest fiscal year, e.g. {{line.DSCR}}",
      "line.CODE.post":
        "That figure post-project, when the scenario has a project",
    },
    lineMergeFields: {
      ...LINE_MERGE_FIELDS,
      "bb.CODE":
        "A borrowing base figure in the month printed, e.g. {{bb.BB_SURPLUS}}, {{bb.BB_TOTAL}} or {{bb.AR.MARGINED}}",
    },
  };
}

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
  `Section ${index + 1} (${SECTIONS[type].label})`;

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
      const kind = Object.hasOwn(settings, key)
        ? settings[key]!.kind
        : undefined;
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
      } else if (kind === "months") {
        if (
          typeof value !== "number" ||
          !Number.isInteger(value) ||
          value < 1 ||
          value > MAX_BB_MONTHS
        )
          fail(
            "invalid_setting",
            `"${key}" is a number of months, 1 to ${MAX_BB_MONTHS}.`,
          );
        else block[key] = value;
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

// A borrowing base figure a template names: a total (BB_…), or a code a
// borrower's own lines may have, such as AR or AR.MARGINED. One template
// serves every borrower, so only the totals are known ahead.
const BB_CODE = /^[A-Z][A-Z0-9_]{0,39}(\.[A-Z][A-Z0-9_]*)?$/;
const TOTAL_CODES = new Set<string>(TOTALS.map((t) => t.code));

function bbCodeProblem(code: string): string | null {
  if (code.startsWith("BB_"))
    return TOTAL_CODES.has(code)
      ? null
      : `${code} isn't a borrowing base total; they are ${[...TOTAL_CODES].join(", ")}.`;
  return BB_CODE.test(code)
    ? null
    : `"${code}" isn't a borrowing base code, such as BB_SURPLUS or AR.MARGINED.`;
}

// What would keep a definition from being published: sections it doesn't
// have, or that what it prints from can't fill; settings left blank; and
// lines, charts or merge fields the model, or a line, doesn't have.
export function checkDefinition(
  definition: Definition,
  model: TemplateModel | null,
): Issue[] {
  const issues: Issue[] = [];
  const source = sourceOf(definition);
  const fromLine = source === "line";
  const codes = new Set(
    model?.lines.filter((l) => l.kind !== "header").map((l) => l.code),
  );
  const charts = new Set(model?.charts.map((c) => c.id));
  const noModel = "choose the financial model it reads first.";
  if (fromLine && model)
    issues.push(
      error(
        "line_model",
        `A document printed from a line of credit reads no financial model: clear ${model.name}.`,
      ),
    );

  const fields = (text: string, at: string) => {
    for (const [whole, path] of text.matchAll(MERGE_FIELD)) {
      const [head, code, post, ...rest] = path!.split(".");
      if (fromLine) {
        if (Object.hasOwn(LINE_MERGE_FIELDS, path!)) continue;
        const problem =
          head === "bb" && code
            ? bbCodeProblem(path!.slice(3))
            : `${whole} isn't a merge field of a document printed from a line.`;
        if (problem) issues.push(error("unknown_field", `${at}: ${problem}`));
        continue;
      }
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

  const bbCodes = (list: string[] | undefined, at: string) => {
    if (!list) return;
    if (!list.length)
      issues.push(
        error("blank", `${at}: pick its figures, or show the main totals.`),
      );
    for (const code of list) {
      const problem = bbCodeProblem(code);
      if (problem)
        issues.push(error("unknown_code", `${at}: ${problem}`, code));
    }
  };

  if (!definition.title.trim())
    issues.push(error("no_title", "Give the document a title."));
  fields(definition.title, "The title");
  if (!definition.blocks.length) issues.push(error("empty", "Add a section."));
  definition.blocks.forEach((block, index) => {
    const at = where(index, block.type);
    if (!SECTIONS[block.type].sources.includes(source)) {
      issues.push(
        error(
          "wrong_source",
          `${at}: it prints from ${SOURCES[SECTIONS[block.type].sources[0]!].toLowerCase()}, and this document prints from ${SOURCES[source].toLowerCase()}.`,
        ),
      );
      return;
    }
    if (block.when && fromLine)
      issues.push(
        error(
          "wrong_source",
          `${at}: its condition is about an analysis, and this document prints from a line of credit.`,
        ),
      );
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
      case "bbHistory":
      case "bbProjection":
        bbCodes(block.lines, at);
        break;
      case "bbSignature":
        if (block.text !== undefined) {
          if (!block.text.trim())
            issues.push(
              error("blank", `${at}: write its statement, or use the app's.`),
            );
          fields(block.text, at);
        }
        break;
      case "charts":
        if (block.months !== undefined && !fromLine)
          issues.push(
            error(
              "wrong_source",
              `${at}: "months" is for a document printed from a line; an analysis's charts cover its periods.`,
            ),
          );
        if (!block.charts) break;
        if (!block.charts.length)
          issues.push(
            error("blank", `${at}: pick its charts, or show all of them.`),
          );
        // A line's charts are its borrower's own, so any id can name one.
        else if (fromLine) break;
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
