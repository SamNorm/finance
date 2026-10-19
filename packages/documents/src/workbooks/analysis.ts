import type { Db } from "@finance/db";
import {
  describeTerms,
  getAnalysis,
  listComments,
  listItems,
  projectTotals,
  runAnalysis,
  type AnalysisResults,
  type AnalysisRun,
  type Context,
  type CovenantPeriod,
  type ModelLine,
  type Project,
  type RunPeriod,
  type Scenario,
} from "@finance/domain";
import type ExcelJS from "exceljs";
import { locale } from "../locale";
import {
  addSheet,
  COLORS,
  excelDate,
  factRows,
  fileOf,
  fill,
  freeze,
  headerRow,
  newWorkbook,
  sectionRow,
  setCode,
  setFigure,
  titleRows,
  type CellFormat,
  type WorkbookFile,
} from "./sheet";

// An analysis as a workbook: a summary, then a sheet for the base case and
// one for each scenario, laid out as the results table is (the model's
// lines over its periods, post-project columns beside the periods the
// analysis shows them for), with the covenants tested and the scenario's
// sources and uses under them.

const l = locale("en");

interface Column {
  p: number;
  post: boolean;
  period: RunPeriod;
}

// Each period, followed by its post-project column where the analysis shows
// one: from the last fiscal year on, and in projected years.
function columnsOf(
  run: AnalysisRun,
  project: AnalysisRun | null,
  postProject: readonly string[],
): Column[] {
  const lastYear = run.periods.findLastIndex(
    (p) => !p.projection && p.months === 12,
  );
  return run.periods.flatMap((period, p) => {
    const own = { p, post: false, period };
    const eligible =
      project !== null && (period.projection !== null || p >= lastYear);
    return eligible && postProject.includes(period.key)
      ? [own, { ...own, post: true }]
      : [own];
  });
}

const kindOf = (column: Column) =>
  column.post
    ? l.w.postProject
    : column.period.projection === "assumptions"
      ? l.w.projected
      : column.period.projection === "client"
        ? column.period.months === 12
          ? l.w.clientProjection
          : `${column.period.months} mo · ${l.w.clientProjection}`
        : l.w.periodMonths(
            column.period.months,
            l.w.qualities[column.period.quality],
          );

const shadeOf = (column: Column) =>
  column.post
    ? COLORS.post
    : column.period.projection
      ? COLORS.projected
      : null;

const asFormat = (format: ModelLine["format"] | null): CellFormat =>
  format ?? "amount";

// The scenario's sheet: lines, covenants, then sources and uses.
function scenarioSheet(
  workbook: ExcelJS.Workbook,
  title: string,
  subtitle: string[],
  lines: readonly ModelLine[],
  results: AnalysisResults,
  project: Project | null,
  items: Record<string, string>,
) {
  const sheet = addSheet(workbook, title);
  const run = results.scenario ?? results.base;
  const post = results.project;
  const columns = columnsOf(run, post, results.postProject);
  const last = columns.length + 1;
  const codeColumn = last + 1;
  const formulaColumn = last + 2;
  let row = titleRows(sheet, title, subtitle);

  // Two header rows: each period's end, then what it is.
  const dates = sheet.getRow(row);
  const kinds = sheet.getRow(row + 1);
  dates.getCell(1).value = "Line";
  columns.forEach((column, i) => {
    const cell = dates.getCell(i + 2);
    cell.value = excelDate(column.period.end);
    cell.numFmt = "mmm d, yyyy";
    kinds.getCell(i + 2).value = kindOf(column);
  });
  dates.getCell(codeColumn).value = "Code";
  dates.getCell(formulaColumn).value = "Formula";
  headerRow(dates, 1, formulaColumn);
  headerRow(kinds, 1, formulaColumn);
  for (let c = 2; c <= last; c++) {
    dates.getCell(c).alignment = { horizontal: "right" };
    kinds.getCell(c).alignment = { horizontal: "right", wrapText: true };
  }
  freeze(sheet, row + 1);
  row += 2;

  const shade = (r: ExcelJS.Row) =>
    columns.forEach((column, i) => {
      const color = shadeOf(column);
      if (color) r.getCell(i + 2).fill = fill(color);
    });

  for (const line of lines) {
    const r = sheet.getRow(row++);
    if (line.kind === "header") {
      sectionRow(r, line.label, formulaColumn);
      continue;
    }
    r.getCell(1).value = line.label;
    if (line.kind === "assumption")
      r.getCell(1).font = { italic: true, color: { argb: COLORS.muted } };
    columns.forEach((column, i) => {
      const cell = (column.post ? post! : run).cells[line.code]?.[column.p];
      if (cell)
        setFigure(
          r.getCell(i + 2),
          cell.value,
          asFormat(line.format),
          cell.error,
        );
    });
    shade(r);
    setCode(r.getCell(codeColumn), line.code);
    const formula = [
      line.formula,
      line.projectionFormula && `Projected: ${line.projectionFormula}`,
    ]
      .filter(Boolean)
      .join("  ·  ");
    if (formula) {
      r.getCell(formulaColumn).value = formula;
      r.getCell(formulaColumn).font = { color: { argb: COLORS.muted } };
    }
  }

  // Each covenant: the figure, coloured by its test, its threshold and the
  // room left before a breach.
  const { covenants } = results;
  if (covenants.run.length) {
    row++;
    sectionRow(
      sheet.getRow(row++),
      covenants.source === "scenario"
        ? `Covenants proposed for ${title}`
        : "Covenants in force",
      formulaColumn,
    );
    covenants.run.forEach((result, index) => {
      const format = asFormat(result.format);
      const tested = (column: Column): CovenantPeriod | undefined =>
        (column.post ? covenants.project : covenants.run)?.[index]?.periods[
          column.p
        ];
      const name = sheet.getRow(row++);
      name.getCell(1).value = result.covenant.name;
      name.getCell(1).font = { bold: true };
      setCode(name.getCell(codeColumn), result.covenant.metric);
      name.getCell(formulaColumn).value =
        result.label === null
          ? "Not a line of this model"
          : `${result.label} ${result.covenant.test === "min" ? "at least" : "at most"} the threshold`;
      name.getCell(formulaColumn).font = { color: { argb: COLORS.muted } };
      const threshold = sheet.getRow(row++);
      const room = sheet.getRow(row++);
      threshold.getCell(1).value = "   Threshold";
      room.getCell(1).value = "   Room before a breach";
      for (const r of [threshold, room])
        r.getCell(1).font = { color: { argb: COLORS.muted } };
      columns.forEach((column, i) => {
        const test = tested(column);
        if (!test || test.threshold === null) return;
        setFigure(name.getCell(i + 2), test.actual, format);
        if (test.pass !== null)
          name.getCell(i + 2).font = {
            bold: true,
            color: { argb: test.pass ? COLORS.pass : COLORS.fail },
          };
        setFigure(threshold.getCell(i + 2), test.threshold, format);
        setFigure(room.getCell(i + 2), test.margin, format);
      });
      for (const r of [name, threshold, room]) shade(r);
    });
  }

  if (project) row = sourcesAndUses(sheet, row + 1, project, items);
  // Printed without the formulas, which would shrink the figures to fit.
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(codeColumn).letter}${row}`;

  sheet.getColumn(1).width = 44;
  for (let c = 2; c <= last; c++) sheet.getColumn(c).width = 15;
  sheet.getColumn(codeColumn).width = 24;
  sheet.getColumn(formulaColumn).width = 70;
}

// The project at closing: sources and uses with their totals, then what
// moves no funds at closing.
function sourcesAndUses(
  sheet: ExcelJS.Worksheet,
  start: number,
  project: Project,
  items: Record<string, string>,
): number {
  let row = start;
  const block = (label: string, detail: string) => {
    const r = sheet.getRow(row++);
    r.values = [label, "Amount", detail];
    headerRow(r, 1, 3);
    r.getCell(2).alignment = { horizontal: "right", vertical: "top" };
    r.getCell(3).alignment = { vertical: "top" };
  };
  const entry = (name: string, amount: string, detail = "") => {
    const r = sheet.getRow(row++);
    r.getCell(1).value = name;
    setFigure(r.getCell(2), amount, "amount");
    if (detail) {
      r.getCell(3).value = detail;
      r.getCell(3).font = { color: { argb: COLORS.muted } };
    }
    return r;
  };
  const total = (label: string, amount: string) => {
    const r = entry(label, amount);
    r.getCell(1).font = { bold: true };
    r.getCell(2).font = { bold: true };
    r.getCell(2).border = {
      top: { style: "thin", color: { argb: COLORS.line } },
    };
  };
  const item = (code: string) => `Posted to ${items[code] ?? code}`;

  sectionRow(
    sheet.getRow(row++),
    `Sources and uses at closing, ${l.date(project.closing)}`,
    3,
  );
  const { sources, uses, difference } = projectTotals(project);
  block("Sources", "Terms");
  for (const s of project.sources)
    entry(
      s.name,
      s.amount,
      s.kind === "loan"
        ? `New loan at ${l.figure(s.rate, "percent")}, ${describeTerms({ ...s, balance: s.amount })}`
        : item(s.item),
    );
  total("Total sources", sources.toFixed());
  row++;
  block("Uses", "Posted to");
  for (const u of project.uses) entry(u.name, u.amount, item(u.item));
  total("Total uses", uses.toFixed());
  if (!difference.isZero()) {
    const r = entry("Sources less uses", difference.toFixed());
    r.getCell(1).font = { bold: true, color: { argb: COLORS.fail } };
  }
  if (project.subordinations.length) {
    row++;
    block("Subordinated to the lender", "Saved each year");
    for (const s of project.subordinations)
      entry(
        s.name,
        s.amount,
        `Interest ${l.figure(s.interestSaved, "amount")}, principal ${l.figure(s.principalSaved, "amount")}`,
      );
  }
  if (project.adjustments?.length) {
    row++;
    block("Adjustments", "Item");
    for (const a of project.adjustments)
      entry(a.name, a.amount, items[a.item] ?? a.item);
  }
  return row;
}

// What a scenario changes from the base case, in a few words.
function changesOf(scenario: Scenario, lines: readonly ModelLine[]): string {
  const byCode = new Map(lines.map((line) => [line.code, line]));
  const changes = [
    ...Object.entries(scenario.overrides).map(([code, value]) => {
      const line = byCode.get(code);
      return `${line?.label ?? code}: ${l.figure(value, asFormat(line?.format ?? null))}`;
    }),
    ...Object.keys(scenario.periodOverrides ?? {}).map(
      (code) => `${byCode.get(code)?.label ?? code}, year by year`,
    ),
    ...(scenario.project
      ? [
          `A project closing ${l.date(scenario.project.closing)}, ${l.figure(projectTotals(scenario.project).sources.toFixed(), "amount")} of sources`,
        ]
      : []),
    ...(scenario.capex.length
      ? [`A capex plan of ${scenario.capex.length}`]
      : []),
    ...(scenario.covenants ? ["Covenants of its own"] : []),
    ...(scenario.lines?.length ? ["Lines of credit for its deal"] : []),
  ];
  return changes.join("; ") || "Nothing yet";
}

export async function analysisWorkbook(
  db: Db,
  ctx: Context,
  analysisId: string,
): Promise<WorkbookFile> {
  const detail = await getAnalysis(db, ctx, analysisId);
  const { analysis, entity, model, version, lines, scenarios } = detail;
  const [comments, scoringItems, ...results] = await Promise.all([
    listComments(db, ctx, { analysisId }),
    listItems(db, ctx, version.scoringModelVersionId),
    runAnalysis(db, ctx, analysisId, null),
    ...scenarios.map((s) => runAnalysis(db, ctx, analysisId, s.id)),
  ]);
  // Labels of the items projects post to.
  const items = Object.fromEntries(scoringItems.map((i) => [i.code, i.label]));
  const workbook = newWorkbook();
  const downloaded = `Downloaded ${l.date(new Date().toISOString().slice(0, 10))}`;
  const subtitle = [
    `${analysis.name} · ${entity.name} · ${model.name} v${version.number}`,
    downloaded,
  ];

  const summary = addSheet(workbook, "Summary", false);
  let row = titleRows(summary, analysis.name, [entity.name, downloaded]);
  const base = results[0]!.base;
  row = factRows(summary, row, [
    ["Borrower", entity.name],
    ["Financial model", `${model.name}, version ${version.number}`],
    [
      "Status",
      analysis.status === "completed"
        ? `Completed ${analysis.completedAt!.toISOString().slice(0, 10)}`
        : "In progress",
    ],
    [
      "Projections",
      analysis.projectionMode === "client"
        ? "The client's projections"
        : `${analysis.projectionYears} ${analysis.projectionYears === 1 ? "year" : "years"} from the model's assumptions`,
    ],
    [
      "Periods",
      base.periods
        .filter((p) => !p.projection)
        .map((p) =>
          p.months === 12 ? p.end.slice(0, 4) : `${p.end} (${p.months} mo)`,
        )
        .join(", "),
    ],
    ["Currency", results[0]!.creditLines.currency],
  ]);
  row++;
  const head = summary.getRow(row++);
  head.values = ["Sheet", "What it changes from the base case"];
  headerRow(head, 1, 2);
  summary.getRow(row++).values = [l.w.baseCase, "The borrower as is"];
  for (const scenario of scenarios)
    summary.getRow(row++).values = [scenario.name, changesOf(scenario, lines)];
  if (comments.length) {
    row++;
    const r = summary.getRow(row++);
    r.values = ["Comments", ""];
    headerRow(r, 1, 2);
    for (const comment of comments) {
      const c = summary.getRow(row++);
      c.getCell(1).value = excelDate(
        comment.createdAt.toISOString().slice(0, 10),
      );
      c.getCell(1).numFmt = "mmm d, yyyy";
      c.getCell(1).alignment = { vertical: "top", horizontal: "left" };
      c.getCell(2).value = comment.body;
      c.getCell(2).alignment = { wrapText: true, vertical: "top" };
    }
  }
  summary.getColumn(1).width = 30;
  summary.getColumn(2).width = 100;

  scenarioSheet(
    workbook,
    l.w.baseCase,
    subtitle,
    lines,
    results[0]!,
    null,
    items,
  );
  scenarios.forEach((scenario, i) =>
    scenarioSheet(
      workbook,
      scenario.name,
      subtitle,
      lines,
      results[i + 1]!,
      scenario.project,
      items,
    ),
  );
  return fileOf(workbook, `${entity.name} - ${analysis.name}`);
}
