// Documents are made of blocks, read from one set of data (data.ts): text
// with merge fields, facts, model tables, covenants, charts, the deal's
// sources and uses, debt and amortization schedules, and page breaks. The
// built-in documents are templates of these blocks, and so are an
// organization's own (template-service.ts): configuration, not code.

// When a block shows; it always does without one.
export type Condition =
  | "project"
  | "noProject"
  | "scenario"
  | "baseCase"
  | "covenantFails"
  | "covenantsPass";

export const CONDITIONS: Record<Condition, string> = {
  project: "The scenario has a project",
  noProject: "The scenario has no project",
  scenario: "A scenario, not the base case",
  baseCase: "The base case",
  covenantFails: "A covenant fails",
  covenantsPass: "Every covenant tested passes",
};

export type Block =
  // A heading; `text` takes merge fields such as {{borrower.name}}.
  (
    | { type: "heading"; text: string }
    // Paragraphs with merge fields (MERGE_FIELDS), blank lines between them,
    // and **bold**, *italics* and "- " bullets.
    | { type: "text"; text: string }
    // The borrower, the analysis and what it's run on, as a grid of facts.
    | { type: "facts" }
    // Model lines by period. All of them when `lines` is omitted, by section.
    // "recent" keeps the latest fiscal year, what follows it, and its
    // post-project column; "all" every period.
    | {
        type: "lines";
        title?: string;
        lines?: string[];
        periods?: "all" | "recent";
      }
    // The covenants tested, year by year, with the room left.
    | { type: "covenants" }
    // The model's charts and the analysis's own; or those named.
    | { type: "charts"; charts?: string[] }
    // The scenario's project: sources and uses at closing, the lines of
    // credit it changes, adds or cancels, subordinations, loans consolidated
    // and adjustments.
    | { type: "sourcesUses" }
    // Existing loans and the project's new ones: balance, rate, terms and
    // debt service. Then the lines of credit as the scenario leaves them:
    // limit, rate, the usage assumed and a year's interest.
    | { type: "debt" }
    // Each loan's schedule, year by year.
    | { type: "amortization" }
    | { type: "pageBreak" }
  ) & { when?: Condition };

export type BlockType = Block["type"];

// What each block is called where people see it, and what it prints.
export const SECTIONS: Record<
  BlockType,
  { label: string; description: string }
> = {
  heading: { label: "Heading", description: "A heading, with merge fields." },
  text: {
    label: "Text",
    description: "Paragraphs with merge fields, bullets, bold and italics.",
  },
  facts: {
    label: "Facts",
    description: "The borrower, the analysis and what it runs on.",
  },
  lines: {
    label: "Model lines",
    description:
      "The model's lines by period: all of them by section, or those picked.",
  },
  covenants: {
    label: "Covenants",
    description: "Each covenant tested, year by year, with the room left.",
  },
  charts: {
    label: "Charts",
    description: "The model's and the analysis's charts, or those picked.",
  },
  sourcesUses: {
    label: "Sources and uses",
    description:
      "The scenario's project at closing, and its changes to lines of credit.",
  },
  debt: {
    label: "Debt",
    description:
      "Existing loans and the project's new ones, and the lines of credit with their usage and interest.",
  },
  amortization: {
    label: "Schedules by year",
    description: "Each loan's schedule, year by year.",
  },
  pageBreak: { label: "Page break", description: "Starts a new page." },
};

export type Orientation = "portrait" | "landscape";

// The language a document prints its own wording in (headings of its
// tables, "Base case", "Page 1 of 3") and its figures and dates. Model line
// labels and text sections print as they're written.
export type Language = "en" | "fr";

export const LANGUAGES: Record<Language, string> = {
  en: "English",
  fr: "Français",
};

// What a document prints: the part of a template its draft and published
// definition hold.
export interface Definition {
  // A title with merge fields, e.g. "{{borrower.name}}: deal summary".
  title: string;
  // Landscape fits every period of an analysis.
  orientation: Orientation;
  // English when missing, as in documents kept before languages.
  language?: Language;
  blocks: Block[];
}

export interface Template extends Definition {
  // A built-in's key, or an organization template's id.
  key: string;
  name: string;
  description: string;
}

// {{borrower.name}} and the like, in titles, headings and text.
export const MERGE_FIELD = /\{\{\s*([\w.:/-]+)\s*\}\}/g;

// The merge fields besides a line's: {{line.CODE}} is its latest fiscal
// year, and {{line.CODE.post}} that year post-project.
export const MERGE_FIELDS: Record<string, string> = {
  "borrower.name": "The borrower's name",
  "borrower.industry": "The borrower's industry",
  "analysis.name": "The analysis's name",
  "model.name": "The financial model's name",
  "model.version": "The financial model's version, e.g. v3",
  "scenario.name": "The scenario's name, or Base case",
  "organization.name": "Your organization's name",
  date: "The day it's printed",
};

export const BUILT_IN_TEMPLATES: Template[] = [
  {
    key: "analysis-report",
    name: "Analysis report",
    description:
      "The analysis in full: what it's run on, the covenants year by year, every model line by period, and the charts.",
    title: "{{borrower.name}}: {{analysis.name}}",
    orientation: "landscape",
    blocks: [
      { type: "facts" },
      { type: "covenants" },
      { type: "lines", periods: "all" },
      { type: "pageBreak" },
      { type: "charts" },
    ],
  },
  {
    key: "deal-summary",
    name: "Deal summary",
    description:
      "The scenario's deal for the credit committee: sources and uses, the debt before and after, the covenants, and the figures from the latest year on.",
    title: "{{borrower.name}}: {{scenario.name}}",
    orientation: "portrait",
    blocks: [
      { type: "facts" },
      { type: "heading", text: "Sources and uses" },
      { type: "sourcesUses" },
      { type: "heading", text: "Debt" },
      { type: "debt" },
      { type: "covenants" },
      {
        type: "lines",
        title: "From the latest year on",
        periods: "recent",
      },
    ],
  },
  {
    key: "debt-summary",
    name: "Debt summary",
    description:
      "Existing loans and the deal's new ones, the lines of credit with their usage and interest, and each loan's schedule year by year.",
    title: "{{borrower.name}}: debt summary",
    orientation: "portrait",
    blocks: [
      { type: "facts" },
      { type: "debt" },
      { type: "heading", text: "Schedules by year" },
      { type: "amortization" },
    ],
  },
];

export const templateOf = (key: string) =>
  BUILT_IN_TEMPLATES.find((t) => t.key === key);
