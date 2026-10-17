import { randomUUID } from "node:crypto";
import type { schema } from "@finance/db";
import { DomainError, type Issue } from "../errors";
import type { LineFormat, ModelLine } from "./types";

// Charts over a model's lines (§5.3, views). A chart has one axis, so its
// series share a format; mixing amounts and ratios takes two charts.

export type ChartDefinition = schema.ChartDefinition;
export type ChartMark = ChartDefinition["series"][number]["mark"];

export const CHARTABLE_FORMATS: readonly LineFormat[] = [
  "amount",
  "percent",
  "ratio",
  "count",
];
// The categorical palette has eight colors; more series don't read apart.
export const MAX_SERIES = 8;

export const isChartable = (line: ModelLine) =>
  line.kind !== "header" &&
  line.kind !== "assumption" &&
  CHARTABLE_FORMATS.includes(line.format);

// A chart as sent by a client, before checks.
export interface ChartInput {
  id?: unknown;
  title?: unknown;
  series?: unknown;
  threshold?: unknown;
}

// Makes the charts' shape canonical: trimmed titles, known marks, an id for
// each new chart. What the codes refer to is checked by checkCharts.
export function normalizeCharts(
  list: readonly ChartInput[],
): ChartDefinition[] {
  if (!Array.isArray(list))
    throw new DomainError("invalid", "Charts must be a list.");
  return list.map((chart) => {
    const title = typeof chart.title === "string" ? chart.title.trim() : "";
    if (!title) throw new DomainError("invalid", "Give the chart a title.");
    if (!Array.isArray(chart.series) || !chart.series.length)
      throw new DomainError("invalid", `${title}: choose what it shows.`);
    if (chart.series.length > MAX_SERIES) {
      throw new DomainError(
        "invalid",
        `${title}: show at most ${MAX_SERIES} lines; split the rest into another chart.`,
      );
    }
    const series = chart.series.map((s: { code?: unknown; mark?: unknown }) => {
      if (typeof s?.code !== "string" || !s.code.trim())
        throw new DomainError("invalid", `${title}: a series has no line.`);
      return {
        code: s.code.trim(),
        mark: s.mark === "bar" ? ("bar" as const) : ("line" as const),
      };
    });
    const threshold =
      typeof chart.threshold === "string" && chart.threshold.trim()
        ? chart.threshold.trim()
        : null;
    const id =
      typeof chart.id === "string" && /^[\w-]{1,64}$/.test(chart.id)
        ? chart.id
        : randomUUID();
    return { id, title, series, threshold };
  });
}

// The format a chart's axis shows: its first series line's.
export function chartFormat(
  chart: ChartDefinition,
  lines: readonly ModelLine[],
): LineFormat | null {
  const first = lines.find((l) => l.code === chart.series[0]?.code);
  return first?.format ?? null;
}

// What keeps a chart from drawing on these lines. Errors: a chart that lost a
// line, mixes formats or names a threshold that isn't a matching assumption.
export function checkCharts(
  charts: readonly ChartDefinition[],
  lines: readonly ModelLine[],
): Issue[] {
  const issues: Issue[] = [];
  const byCode = new Map(lines.map((l) => [l.code, l]));
  for (const chart of charts) {
    const error = (code: string, message: string) =>
      issues.push({
        severity: "error",
        code,
        itemCode: chart.id,
        message: `Chart "${chart.title}": ${message}`,
      });
    const seen = new Set<string>();
    let format: LineFormat | null = null;
    for (const { code } of chart.series) {
      const line = byCode.get(code);
      if (seen.has(code)) error("chart_duplicate", `shows ${code} twice.`);
      seen.add(code);
      if (!line) {
        error("chart_line_missing", `no line has the code ${code}.`);
        continue;
      }
      if (!isChartable(line)) {
        error(
          "chart_line_kind",
          `${line.label} can't be charted; chart calculations and inputs shown as amounts, percents, ratios or counts.`,
        );
        continue;
      }
      format ??= line.format;
      if (line.format !== format) {
        error(
          "chart_formats",
          `${line.label} is shown as ${line.format}, unlike the chart's other lines (${format}). A chart has one axis; put it in another chart.`,
        );
      }
    }
    if (chart.threshold) {
      const line = byCode.get(chart.threshold);
      if (!line || line.kind !== "assumption") {
        error(
          "chart_threshold",
          `the threshold ${chart.threshold} isn't an assumption of the model.`,
        );
      } else if (format && line.format !== format) {
        error(
          "chart_threshold",
          `the threshold ${line.label} is shown as ${line.format}, unlike the chart (${format}).`,
        );
      }
    }
  }
  return issues;
}

// Follows a line renamed from one code to another.
export function renameInCharts(
  charts: readonly ChartDefinition[],
  from: string,
  to: string,
): ChartDefinition[] {
  return charts.map((chart) => ({
    ...chart,
    series: chart.series.map((s) => (s.code === from ? { ...s, code: to } : s)),
    threshold: chart.threshold === from ? to : chart.threshold,
  }));
}
