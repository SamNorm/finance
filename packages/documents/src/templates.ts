// Documents are made of blocks, read from one set of data (data.ts): text
// with merge fields, facts, model tables, covenants, charts, the deal's
// sources and uses, debt and amortization schedules, and page breaks. The
// built-in documents are templates of these blocks, so an institution's own
// templates (documents-plan.md, phase 3) are the same thing with other
// blocks: configuration, not code.

export type Block =
  // A heading; `text` takes merge fields such as {{borrower.name}}.
  | { type: "heading"; text: string }
  // A paragraph with merge fields: {{borrower.name}}, {{analysis.name}},
  // {{model.name}}, {{scenario.name}}, {{organization.name}}, {{date}}, and
  // {{line.CODE}} for a line's latest fiscal year ({{line.CODE.post}}
  // post-project).
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
  // The scenario's project: sources and uses at closing, line of credit
  // increases, subordinations, loans consolidated and adjustments.
  | { type: "sourcesUses" }
  // Existing loans and the project's new ones: balance, rate, terms and
  // debt service.
  | { type: "debt" }
  // Each loan's schedule, year by year.
  | { type: "amortization" }
  | { type: "pageBreak" };

export type BlockType = Block["type"];

export interface Template {
  key: string;
  name: string;
  description: string;
  // A title with merge fields, e.g. "{{borrower.name}}: deal summary".
  title: string;
  blocks: Block[];
}

export const BUILT_IN_TEMPLATES: Template[] = [
  {
    key: "analysis-report",
    name: "Analysis report",
    description:
      "The analysis in full: what it's run on, the covenants year by year, every model line by period, and the charts.",
    title: "{{borrower.name}}: {{analysis.name}}",
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
      "Existing loans and the deal's new ones, with each loan's schedule year by year.",
    title: "{{borrower.name}}: debt summary",
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
