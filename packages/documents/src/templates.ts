// Documents are made of blocks, read from one set of data (data.ts): text
// with merge fields, facts, model tables, covenants, charts, the deal's
// sources and uses, debt and amortization schedules, borrowing bases, and
// page breaks. The built-in documents are templates of these blocks, and so
// are an organization's own (template-service.ts): configuration, not code.

// What a document prints from: an analysis and a scenario, or a margined
// line of credit and a month (borrowing-base-plan.md §12).
export type Source = "analysis" | "line";

export const SOURCES: Record<Source, string> = {
  analysis: "An analysis",
  line: "A margined line of credit",
};

// When a block shows; it always does without one. Each is about an
// analysis, so a document printed from a line takes none.
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
    // The model's charts and the analysis's own; or those named. From a
    // line, its borrowing base's charts over `months` up to its month (12
    // by default).
    | { type: "charts"; charts?: string[]; months?: number }
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
    // From a line: the month's waterfall, the certificate's body. Every
    // line of the borrower's definition, in its order.
    | { type: "bbWaterfall" }
    // From a line: figures by month up to its month, 12 by default and up
    // to 24; the main totals when `lines` is omitted.
    | { type: "bbHistory"; lines?: string[]; months?: number }
    // From a line: each test, month by month up to its month (12 by
    // default), or with `months` 1 the month's alone.
    | { type: "bbTests"; months?: number }
    // From a line: the business cycle by fiscal year and over the last 12
    // months.
    | { type: "bbCycle" }
    // From an analysis: each margined line's last 12 months and its
    // projection under the scenario, the deal's terms marked from when they
    // apply, and its charts.
    | { type: "bbProjection"; lines?: string[] }
    // Lines for the client's officer to sign and date, under a statement
    // (with merge fields) or the one the app words.
    | { type: "bbSignature"; text?: string }
    | { type: "pageBreak" }
  ) & { when?: Condition };

export type BlockType = Block["type"];

const BOTH: Source[] = ["analysis", "line"];

// What each block is called where people see it, what it prints, and the
// sources it prints from.
export const SECTIONS: Record<
  BlockType,
  { label: string; description: string; sources: Source[] }
> = {
  heading: {
    label: "Heading",
    description: "A heading, with merge fields.",
    sources: BOTH,
  },
  text: {
    label: "Text",
    description: "Paragraphs with merge fields, bullets, bold and italics.",
    sources: BOTH,
  },
  facts: {
    label: "Facts",
    description:
      "The borrower, and the analysis and what it runs on; or the line of credit and its month's certificate.",
    sources: BOTH,
  },
  lines: {
    label: "Model lines",
    description:
      "The model's lines by period: all of them by section, or those picked.",
    sources: ["analysis"],
  },
  covenants: {
    label: "Covenants",
    description: "Each covenant tested, year by year, with the room left.",
    sources: ["analysis"],
  },
  charts: {
    label: "Charts",
    description:
      "The model's and the analysis's charts, or those picked; from a line, its borrowing base's.",
    sources: BOTH,
  },
  sourcesUses: {
    label: "Sources and uses",
    description:
      "The scenario's project at closing, and its changes to lines of credit.",
    sources: ["analysis"],
  },
  debt: {
    label: "Debt",
    description:
      "Existing loans and the project's new ones, and the lines of credit with their usage and interest.",
    sources: ["analysis"],
  },
  amortization: {
    label: "Schedules by year",
    description: "Each loan's schedule, year by year.",
    sources: ["analysis"],
  },
  bbWaterfall: {
    label: "Borrowing base",
    description:
      "The month's waterfall: each collateral line, its ineligibles, advance rate and cap, prior claims, the borrowing base, the limit and usage.",
    sources: ["line"],
  },
  bbHistory: {
    label: "Margin history",
    description:
      "Figures month by month up to the month: the main totals, or those picked.",
    sources: ["line"],
  },
  bbTests: {
    label: "Borrowing base tests",
    description:
      "The margin, overline and custom tests, month by month or the month's.",
    sources: ["line"],
  },
  bbCycle: {
    label: "Business cycle",
    description:
      "Peak, average and lowest usage, the thinnest margin and months in deficit, by fiscal year and over the last 12 months.",
    sources: ["line"],
  },
  bbProjection: {
    label: "Projected margin",
    description:
      "Each margined line's last 12 months and its projection under the scenario, with the deal's terms from when they apply.",
    sources: ["analysis"],
  },
  bbSignature: {
    label: "Signature",
    description:
      "A statement, and lines for the client's officer to sign and date.",
    sources: BOTH,
  },
  pageBreak: {
    label: "Page break",
    description: "Starts a new page.",
    sources: BOTH,
  },
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
  // An analysis when missing, as in documents kept before lines printed.
  source?: Source;
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

// A document printed from a line's merge fields, besides its figures:
// {{bb.CODE}} is a figure of the month, such as {{bb.BB_SURPLUS}} or
// {{bb.AR.MARGINED}}.
export const LINE_MERGE_FIELDS: Record<string, string> = {
  "borrower.name": "The borrower's name",
  "borrower.industry": "The borrower's industry",
  "line.name": "The line of credit's name",
  "line.currency": "The line's currency, e.g. CAD",
  "line.limit": "The line's authorized limit that month",
  "line.rate": "The line's annual rate",
  "bb.month": "The month printed, e.g. November 2025",
  "organization.name": "Your organization's name",
  date: "The day it's printed",
};

export const mergeFieldsOf = (source: Source = "analysis") =>
  source === "line" ? LINE_MERGE_FIELDS : MERGE_FIELDS;

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
  {
    key: "projected-margin",
    name: "Projected margin",
    description:
      "Each margined line's last 12 months and its borrowing base projected under the scenario, with the deal's terms from when they apply, the tests and the charts.",
    title: "{{borrower.name}}: projected margin, {{scenario.name}}",
    orientation: "landscape",
    blocks: [{ type: "facts" }, { type: "bbProjection" }],
  },
  {
    key: "borrowing-base-certificate",
    name: "Borrowing base certificate",
    description:
      "A margined line's month for the client to sign: the waterfall from collateral to the margin surplus, the month's tests, and signature lines.",
    source: "line",
    title: "{{borrower.name}}: borrowing base certificate, {{bb.month}}",
    orientation: "portrait",
    blocks: [
      { type: "facts" },
      { type: "bbWaterfall" },
      { type: "bbTests", months: 1 },
      { type: "bbSignature" },
    ],
  },
  {
    key: "margin-history",
    name: "Margin history",
    description:
      "A margined line over the last 12 months to the month: the main totals month by month, the business cycle, the tests and the charts.",
    source: "line",
    title: "{{borrower.name}}: margin history, {{line.name}}",
    orientation: "landscape",
    blocks: [
      { type: "facts" },
      { type: "bbHistory" },
      { type: "bbCycle" },
      { type: "bbTests" },
      { type: "pageBreak" },
      { type: "charts" },
    ],
  },
];

// The source a definition prints from.
export const sourceOf = (definition: Pick<Definition, "source">): Source =>
  definition.source ?? "analysis";

export const templateOf = (key: string) =>
  BUILT_IN_TEMPLATES.find((t) => t.key === key);
