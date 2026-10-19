import {
  amortize,
  DEFAULT_BB_CHARTS,
  monthIndex,
  monthNumber,
  nextYearDebtService,
  projectTotals,
  type ChartDefinition,
  type CovenantPeriod,
  type CycleFigure,
  type CycleSummary,
  type DebtSchedule,
  type ExistingLoan,
  type LineCode,
  type LineTerms,
  type ProjectLoan,
  type Season,
  type Term,
} from "@finance/domain";
import { Dec } from "@finance/engine";
import { chartSvg, legendHtml, type ChartInput } from "./chart";
import {
  fromAnalysis,
  lineOf,
  readDocumentData,
  type AnalysisDocumentData,
  type DocumentBorrowingBase,
  type DocumentData,
  type DocumentRow,
  type DocumentRun,
  type DocumentTest,
  type KeptDocumentData,
} from "./data";
import { escape, type Format } from "./format";
import { locale, type Change, type Locale } from "./locale";
import {
  MERGE_FIELD,
  type Block,
  type Condition,
  type Template,
} from "./templates";

// A template's blocks rendered over a document's data, as one standalone
// HTML page with print CSS: what the PDF prints (pdf.ts), and what a preview
// shows. The footer, with the organization's notice and page numbers, is a
// separate template the PDF repeats on every page.

export interface RenderedDocument {
  title: string;
  html: string;
  // For each page's foot: the notice and "Page n of m".
  footer: string;
  orientation: "portrait" | "landscape";
}

const DEFAULT_COLOR = "#1e3a8a";

// A merge field's value, e.g. "borrower.name" or "line.DSCR.post", or from
// a line "bb.BB_SURPLUS" or "line.name"; null for a field there's no such
// thing as.
function field(path: string, data: DocumentData, l: Locale): string | null {
  const [head, code, post] = path.split(".");
  const bb = lineOf(data);
  if (bb) {
    const p = bb.months.length - 1;
    if (path === "bb.month") return l.monthYear(bb.months[p]!.month);
    if (head === "bb") {
      const row = bb.rows.find(
        (r) => r.code === path.slice(3) && r.kind !== "section",
      );
      return row ? bbFigure(row, bb.values[row.code]?.[p] ?? null, l) : null;
    }
    const line: Record<string, string> = {
      "line.name": bb.name,
      "line.currency": bb.currency,
      "line.limit": l.figure(bb.values.BB_LIMIT?.[p] ?? null, "amount"),
      "line.rate": l.rate(bb.rate),
    };
    if (head === "line") return line[path] ?? null;
  } else if (head === "line" && code && fromAnalysis(data)) {
    const line = data.lines.find((l) => l.code === code);
    if (!line || line.kind === "header" || (post && post !== "post"))
      return null;
    const p = lastYear(data.run);
    const run = post ? data.project : data.run;
    return p < 0 || !run
      ? ""
      : l.figure(run.values[line.code]?.[p] ?? null, line.format as Format);
  }
  const fields: Record<string, string> = {
    "borrower.name": data.borrower.name,
    "borrower.industry": data.borrower.industry ?? "",
    "organization.name": data.organization.name,
    date: l.date(data.date),
    ...(fromAnalysis(data)
      ? {
          "analysis.name": data.analysis.name,
          "model.name": data.model.name,
          "model.version": `v${data.model.version}`,
          "scenario.name": data.scenario?.name ?? l.w.baseCase,
        }
      : {}),
  };
  return Object.hasOwn(fields, path) ? fields[path]! : null;
}

// {{borrower.name}} and the like; unknown fields are left as typed.
export function merge(
  text: string,
  data: DocumentData,
  l: Locale = locale(),
): string {
  return text.replace(
    MERGE_FIELD,
    (whole, path: string) => field(path, data, l) ?? whole,
  );
}

// A text block's paragraphs, between blank lines, with "- " bullets,
// **bold** and *italics*. What's typed is escaped before it's formatted, and
// merge fields are filled in last, so neither can make markup.
function prose(text: string, data: DocumentData, l: Locale): string {
  const inline = (line: string) =>
    escape(line)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(MERGE_FIELD, (whole, path: string) =>
        escape(field(path, data, l) ?? whole),
      );
  const bullet = /^[-*]\s+/;
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => {
      const lines = paragraph
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      // Runs of bullets become lists; other lines, paragraphs.
      const runs: { list: boolean; lines: string[] }[] = [];
      for (const line of lines) {
        const list = bullet.test(line);
        const last = runs.at(-1);
        if (last?.list === list) last.lines.push(line);
        else runs.push({ list, lines: [line] });
      }
      return runs
        .map((run) =>
          run.list
            ? `<ul>${run.lines.map((l) => `<li>${inline(l.replace(bullet, ""))}</li>`).join("")}</ul>`
            : `<p>${run.lines.map(inline).join("<br>")}</p>`,
        )
        .join("");
    })
    .join("");
}

// Whether a block with this condition shows in this document. Conditions
// are about an analysis, so none holds for a line's.
export function shows(when: Condition | undefined, data: DocumentData) {
  if (when === undefined) return true;
  if (!fromAnalysis(data)) return false;
  const results = [
    ...data.covenants.run,
    ...(data.covenants.project ?? []),
  ].flatMap((c) => c.periods.map((p) => p.pass));
  switch (when) {
    case "project":
      return data.deal !== null;
    case "noProject":
      return data.deal === null;
    case "scenario":
      return data.scenario !== null;
    case "baseCase":
      return data.scenario === null;
    case "covenantFails":
      return results.includes(false);
    case "covenantsPass":
      return results.includes(true) && !results.includes(false);
  }
}

// The latest fiscal year that isn't projected.
const lastYear = (run: DocumentRun) =>
  run.periods.findLastIndex((p) => !p.projection && p.months === 12);

const periodHead = (run: DocumentRun, p: number, l: Locale) => {
  const period = run.periods[p]!;
  return `${escape(l.date(period.end))}<small>${
    period.projection === "assumptions"
      ? l.w.projected
      : period.projection === "client"
        ? l.w.clientProjection
        : l.w.periodMonths(period.months, l.w.qualities[period.quality])
  }</small>`;
};

// The columns a table shows: each period, and a post-project column after
// those the analysis shows one for.
function columns(data: AnalysisDocumentData, recent: boolean) {
  const from = recent ? Math.max(0, lastYear(data.run)) : 0;
  return data.run.periods.flatMap((period, p) => {
    if (p < from) return [];
    const own = { p, post: false, key: period.key };
    return data.project && data.postProject.includes(period.key)
      ? [own, { p, post: true, key: `${period.key}:post` }]
      : [own];
  });
}

function linesBlock(
  block: Extract<Block, { type: "lines" }>,
  data: AnalysisDocumentData,
  l: Locale,
): string {
  const cols = columns(data, block.periods === "recent");
  const shown = data.lines.filter(
    (l) =>
      (l.kind === "header" && !block.lines) ||
      (l.kind !== "header" && (!block.lines || block.lines.includes(l.code))),
  );
  const rows = shown
    .map((line) => {
      if (line.kind === "header")
        return `<tr class="section"><td colspan="${cols.length + 1}">${escape(line.label)}</td></tr>`;
      const cells = cols
        .map((c) => {
          const run = c.post ? data.project! : data.run;
          const value = run.values[line.code]?.[c.p] ?? null;
          const shownValue = l.figure(value, line.format as Format);
          const tone =
            line.format === "flag"
              ? value === "true"
                ? " pass"
                : value === "false"
                  ? " fail"
                  : ""
              : "";
          return `<td class="num${c.post ? " post" : ""}${data.run.periods[c.p]!.projection ? " projected" : ""}${tone}">${escape(shownValue) || "–"}</td>`;
        })
        .join("");
      return `<tr><td>${escape(line.label)}</td>${cells}</tr>`;
    })
    .join("");
  const head = cols
    .map(
      (c) =>
        `<th class="num${c.post ? " post" : ""}${data.run.periods[c.p]!.projection ? " projected" : ""}">${c.post ? `${l.w.postProject}<small>${escape(l.date(data.run.periods[c.p]!.end))}</small>` : periodHead(data.run, c.p, l)}</th>`,
    )
    .join("");
  return `${block.title ? `<h2>${escape(merge(block.title, data, l))}</h2>` : ""}<table class="figures"><thead><tr><th>${escape(data.scenario?.name ?? l.w.baseCase)}</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

// The borrower, then what the analysis runs on, or the line and its
// month's certificate.
function factsBlock(data: DocumentData, l: Locale): string {
  const bb = lineOf(data);
  const facts: [string, string][] = [
    [
      data.borrower.kind === "consolidated"
        ? l.w.consolidatedClient
        : l.w.borrower,
      data.borrower.name,
    ],
    ...(data.borrower.members.length
      ? ([[l.w.members, data.borrower.members.join(", ")]] as [
          string,
          string,
        ][])
      : []),
    ...(data.borrower.industry || data.borrower.naicsCode
      ? ([
          [
            l.w.industry,
            [
              data.borrower.industry,
              data.borrower.naicsCode && `NAICS ${data.borrower.naicsCode}`,
            ]
              .filter(Boolean)
              .join(" · "),
          ],
        ] as [string, string][])
      : []),
    ...(data.borrower.riskRating
      ? ([[l.w.riskRating, data.borrower.riskRating]] as [string, string][])
      : []),
  ];
  if (fromAnalysis(data))
    facts.push(
      [l.w.analysis, data.analysis.name],
      [l.w.financialModel, `${data.model.name} · v${data.model.version}`],
      [l.w.scenario, data.scenario?.name ?? l.w.baseCase],
      [
        l.w.projections,
        data.analysis.projectionMode === "client"
          ? l.w.clientsOwn
          : l.w.yearsFromAssumptions(data.analysis.projectionYears),
      ],
    );
  else if (bb) {
    const month = bb.months.at(-1)!;
    const certificate = bb.certificate;
    facts.push(
      [l.w.lineOfCredit, `${bb.name} · ${bb.currency}`],
      [l.w.limit, l.limit(bb.limit)],
      [l.w.rate, l.rate(bb.rate)],
      [l.w.monthEnded, l.date(month.end)],
    );
    if (certificate)
      facts.push([
        l.w.certificate,
        [
          l.w.certificateQualities[certificate.quality],
          certificate.receivedOn &&
            l.w.receivedOn(l.date(certificate.receivedOn)),
        ]
          .filter(Boolean)
          .join(" · "),
      ]);
  }
  return `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`).join("")}</dl>`;
}

const asChartFormat = (format: string): ChartInput["format"] =>
  format === "percent" || format === "ratio" || format === "count"
    ? format
    : "amount";

function covenantsBlock(data: AnalysisDocumentData, l: Locale): string {
  const { covenants } = data;
  if (!covenants.run.length) return "";
  const cols = columns(data, false).filter(
    (c) => data.run.periods[c.p]!.months === 12,
  );
  const reference =
    cols.findLast((c) => c.post) ??
    cols.findLast((c) => !data.run.periods[c.p]!.projection);
  const pick = (i: number, c: (typeof cols)[number]) =>
    (c.post ? covenants.project : covenants.run)?.[i]?.periods[c.p];
  const test = (period: CovenantPeriod | undefined, format: Format) => {
    if (!period || period.threshold === null) return "–";
    if (period.actual === null)
      return `<small>${l.w.noFigure} · ${escape(l.figure(period.threshold, format))}</small>`;
    const margin = l.figure(period.margin!.replace(/^-/, ""), format);
    return `<span class="${period.pass ? "pass" : "fail"}">${escape(l.figure(period.actual, format))}</span><small>${escape(l.figure(period.threshold, format))} · ${period.margin!.startsWith("-") ? "−" : "+"}${escape(margin)}</small>`;
  };
  const room = (
    period: CovenantPeriod | undefined,
    format: Format,
    min: boolean,
  ) => {
    if (!period || period.actual === null) return "–";
    const { cushion } = period;
    if (!cushion)
      return period.pass
        ? l.w.toSpare(escape(l.figure(period.margin!, format)))
        : `<span class="fail">${l.w.inBreachBy(escape(l.figure(period.margin!.replace(/^-/, ""), format)))}</span>`;
    const amount = escape(l.figure(cushion.amount.replace(/^-/, ""), "amount"));
    const line = escape(cushion.line);
    if (!period.pass)
      return `<span class="fail">${min ? l.w.inBreachShort(amount, line) : l.w.inBreachOver(amount, line)}</span>`;
    return `${cushion.fall !== null ? l.w.canFall(escape(cushion.fallLine), escape(l.figure(cushion.fall, "percent"))) : ""}${min ? l.w.spare(amount, line) : l.w.allowed(amount, line)}`;
  };
  const rows = covenants.run
    .map((result, i) => {
      const format = asChartFormat(result.format ?? "amount");
      const min = result.covenant.test === "min";
      const what =
        result.label === null
          ? l.w.notALine(escape(result.covenant.metric))
          : `${escape(result.label)}, ${min ? l.w.atLeast : l.w.atMost} ${
              result.covenant.thresholds.length > 1
                ? result.covenant.thresholds
                    .map(
                      (t) =>
                        `${escape(l.figure(t.value, format))}${t.from === null ? "" : l.w.fromYear(t.from)}`,
                    )
                    .join(l.w.then)
                : escape(l.figure(result.covenant.thresholds[0]!.value, format))
            }`;
      return `<tr><td><strong>${escape(result.covenant.name)}</strong><small>${what}</small>${result.covenant.note ? `<small class="note">${escape(result.covenant.note)}</small>` : ""}</td>${cols
        .map(
          (c) =>
            `<td class="num${c.post ? " post" : ""}">${test(pick(i, c), format)}</td>`,
        )
        .join(
          "",
        )}<td class="room">${room(reference && pick(i, reference), format, min)}</td></tr>`;
    })
    .join("");
  return `<h2>${l.w.covenants} <span class="tag">${covenants.source === "scenario" ? l.w.proposedFor(data.scenario ? escape(data.scenario.name) : null) : l.w.inForce}</span></h2><table class="figures covenants"><thead><tr><th>${l.w.covenant}</th>${cols
    .map(
      (c) =>
        `<th class="num${c.post ? " post" : ""}">${escape(data.run.periods[c.p]!.end.slice(0, 4))}<small>${c.post ? l.w.postProjectNote : data.run.periods[c.p]!.projection ? l.w.projectedNote : l.w.actual}</small></th>`,
    )
    .join(
      "",
    )}<th>${l.w.room}${reference ? `<small>${escape(data.run.periods[reference.p]!.end.slice(0, 4))}${reference.post ? ` ${l.w.postProjectNote}` : ""}</small>` : ""}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function chartsBlock(
  block: Extract<Block, { type: "charts" }>,
  data: AnalysisDocumentData,
  l: Locale,
): string {
  const charts = data.charts.filter(
    (c) => !block.charts || block.charts.includes(c.id),
  );
  if (!charts.length) return "";
  const byCode = new Map(data.lines.map((l) => [l.code, l]));
  const years = data.run.periods.map((p) => p.end.slice(0, 4));
  const yearly =
    data.run.periods.every((p) => p.months === 12) &&
    new Set(years).size === years.length;
  const periods = data.run.periods.map((p, i) => ({
    label: yearly ? years[i]! : l.date(p.end),
    projected: p.projection !== null,
  }));
  const values = (run: DocumentRun, code: string) =>
    (run.values[code] ?? []).map((v) => (v === null ? null : Number(v)));
  const items = charts.map((chart) => {
    const first = chart.series[0]!.code;
    const format = asChartFormat(byCode.get(first)?.format ?? "amount");
    const single = chart.series.length === 1;
    const series: ChartInput["series"] = chart.series.map((s) => ({
      label: byCode.get(s.code)?.label ?? s.code,
      mark: s.mark,
      values: values(data.run, s.code),
    }));
    if (single && data.project) {
      const from = lastYear(data.run);
      series[0]!.label += l.w.asIs;
      series.push({
        label: `${byCode.get(first)?.label ?? first}${l.w.postProjectSeries}`,
        mark: "line",
        values: values(data.project, first).map((v, i) =>
          i >= from || data.run.periods[i]!.projection ? v : null,
        ),
      });
    }
    const covenant = single
      ? data.covenants.run.find(
          (c) =>
            c.label !== null &&
            c.covenant.metric.toUpperCase() === first.toUpperCase(),
        )
      : undefined;
    // An assumption's value in each period, which a scenario can set year
    // by year.
    const assumed = chart.threshold ? values(data.run, chart.threshold) : [];
    const input: ChartInput = {
      format,
      periods,
      series,
      threshold: covenant
        ? {
            label: covenant.covenant.name,
            values: covenant.periods.map((p) =>
              p.threshold === null ? null : Number(p.threshold),
            ),
          }
        : chart.threshold && assumed.some((v) => v !== null)
          ? {
              label: byCode.get(chart.threshold)?.label ?? chart.threshold,
              values: assumed,
            }
          : null,
    };
    return `<figure><figcaption>${escape(chart.title)}</figcaption>${legendHtml(input, l)}${chartSvg(input, l)}</figure>`;
  });
  return `<h2>${l.w.charts}</h2><div class="charts">${items.join("")}</div>`;
}

function sourcesUsesBlock(data: AnalysisDocumentData, l: Locale): string {
  const deal = data.deal;
  if (!deal)
    return `<p class="muted">${l.w.financesNoProject(data.scenario ? escape(data.scenario.name) : null)}</p>`;
  const totals = projectTotals(deal);
  const off = l.imbalance(deal);
  const label = (code: string) => data.items[code] ?? code;
  const share = (amount: string, total: string) =>
    escape(l.share(Number(amount), Number(total)));
  const source = deal.sources
    .map(
      (s) =>
        `<tr><td>${escape(s.name)}<small>${
          s.kind === "loan"
            ? `${l.w.newLoan} · ${escape(l.rate(s.rate))} · ${escape(l.terms({ ...s, balance: s.amount }))}`
            : escape(label(s.item))
        }</small></td><td class="num">${escape(l.figure(s.amount, "amount"))}</td><td class="num">${share(s.amount, totals.sources.toFixed())}</td></tr>`,
    )
    .join("");
  const use = deal.uses
    .map(
      (u) =>
        `<tr><td>${escape(u.name)}<small>${escape(label(u.item))}</small></td><td class="num">${escape(l.figure(u.amount, "amount"))}</td><td class="num">${share(u.amount, totals.uses.toFixed())}</td></tr>`,
    )
    .join("");
  const side = (title: string, rows: string, total: string) =>
    `<table class="figures"><thead><tr><th>${title}</th><th class="num">${l.w.amount}</th><th class="num">${l.w.share}</th></tr></thead><tbody>${rows || `<tr><td colspan="3" class="muted">${l.w.none}</td></tr>`}</tbody><tfoot><tr><td>${l.w.total}</td><td class="num">${escape(l.figure(total, "amount"))}</td><td></td></tr></tfoot></table>`;
  const loans = new Map(
    data.debt.flatMap((d) => d.schedule.loans.map((l) => [l.id, l.name])),
  );
  const extras = [
    ...lineChanges(data, l),
    ...deal.subordinations.map((s) =>
      l.w.subordination(escape(s.name), escape(l.figure(s.amount, "amount"))),
    ),
    ...(deal.consolidatedLoans ?? []).map((id) =>
      l.w.refinanced(escape(loans.get(id) ?? l.w.anExistingLoan)),
    ),
    ...(deal.adjustments ?? []).map((a) =>
      l.w.adjustment(
        escape(a.name),
        escape(l.figure(a.amount, "amount")),
        escape(label(a.item)),
        !a.side,
      ),
    ),
  ];
  return `<p class="muted">${l.w.closing(escape(l.date(deal.closing)))}</p>${off ? `<p class="fail">${l.w.unbalanced(escape(off))}</p>` : ""}<div class="pair">${side(l.w.sources, source, totals.sources.toFixed())}${side(l.w.uses, use, totals.uses.toFixed())}</div>${extras.length ? `<ul class="extras">${extras.map((e) => `<li>${e}</li>`).join("")}</ul>` : ""}`;
}

// A term's figures in a set order, to tell whether a proposed limit changes
// the one in force.
function termKey(term: Term): string {
  const seasons = (list: Season[] = []) =>
    list
      .map(
        (s) => [[...s.months].sort((a, b) => a - b), Number(s.value)] as const,
      )
      .sort((a, b) => a[0][0]! - b[0][0]!);
  return JSON.stringify([
    Number(term.value),
    seasons(term.seasons),
    (term.steps ?? []).map((s) => [
      s.from,
      Number(s.value),
      seasons(s.seasons),
    ]),
  ]);
}

const changeOf = (from: string, to: string): Change =>
  Number(to) > Number(from)
    ? "raised"
    : Number(to) < Number(from)
      ? "lowered"
      : "changed";

// Whether a proposed line changes the terms of the one in force.
const changesTerms = (was: LineTerms, line: LineTerms) =>
  termKey(was.limit) !== termKey(line.limit) ||
  Number(was.rate) !== Number(line.rate);

// Each line of credit the scenario changes, adds or cancels, as the deal's
// extras word it. Lines it proposes as they are say nothing.
function lineChanges(data: AnalysisDocumentData, l: Locale): string[] {
  const inForce = new Map(data.creditLines.inForce.map((x) => [x.id, x]));
  return (data.creditLines.proposed ?? []).flatMap((line) => {
    const was = inForce.get(line.id);
    if (!was)
      return line.closed
        ? []
        : [
            l.w.newLine(
              escape(line.name),
              escape(line.currency),
              escape(l.limit(line.limit)),
              escape(l.rate(line.rate)),
            ),
          ];
    if (line.closed) return [l.w.lineClosed(escape(was.name))];
    const changed: string[] = [];
    if (termKey(was.limit) !== termKey(line.limit))
      changed.push(
        l.w.limitChange(
          changeOf(was.limit.value, line.limit.value),
          escape(l.limit(was.limit)),
          escape(l.limit(line.limit)),
        ),
      );
    if (Number(was.rate) !== Number(line.rate))
      changed.push(
        l.w.rateChange(
          changeOf(was.rate, line.rate),
          escape(l.rate(was.rate)),
          escape(l.rate(line.rate)),
        ),
      );
    return changed.length ? [l.w.lineChange(escape(was.name), changed)] : [];
  });
}

// A loan's yearly debt service from its start: the first twelve months'.
function firstYear(loan: Parameters<typeof amortize>[0], start: string) {
  const from = monthIndex(start);
  const { interest, principal } = amortize(loan, start, true).flows(
    from,
    from + 12,
  );
  return interest.plus(principal);
}

const newLoans = (data: AnalysisDocumentData) =>
  (data.deal?.sources.filter((s) => s.kind === "loan") ?? []) as ProjectLoan[];

function debtBlock(data: AnalysisDocumentData, l: Locale): string {
  const consolidated = new Set(data.deal?.consolidatedLoans ?? []);
  const existing = data.debt.flatMap((d) =>
    d.schedule.loans.map((loan) => ({ loan, schedule: d.schedule })),
  );
  const nextYear = new Map(
    data.debt.flatMap((d) =>
      nextYearDebtService(d.schedule).map((y) => [y.id, y]),
    ),
  );
  let total = 0;
  const existingRows = existing
    .map(({ loan, schedule }) => {
      const year = nextYear.get(loan.id);
      const service = year ? Number(year.interest) + Number(year.principal) : 0;
      const repaid = consolidated.has(loan.id);
      if (!repaid) total += service;
      return `<tr><td>${escape(loan.name)}<small>${l.w.asOf(escape(l.date(schedule.asOf!)))}${repaid ? l.w.repaidAtClosing : ""}</small></td><td class="num">${escape(l.figure(loan.balance, "amount"))}</td><td class="num">${escape(l.rate(loan.rate))}</td><td>${escape(l.terms(loan))}</td><td class="num">${escape(l.figure(String(service), "amount"))}</td></tr>`;
    })
    .join("");
  const added = newLoans(data);
  const newRows = added
    .map((loan) => {
      const service = Number(
        firstYear({ ...loan, balance: loan.amount }, data.deal!.closing),
      );
      total += service;
      return `<tr><td>${escape(loan.name)}<small>${l.w.newFrom(escape(l.date(data.deal!.closing)))}</small></td><td class="num">${escape(l.figure(loan.amount, "amount"))}</td><td class="num">${escape(l.rate(loan.rate))}</td><td>${escape(l.terms({ ...loan, balance: loan.amount }))}</td><td class="num">${escape(l.figure(String(service), "amount"))}</td></tr>`;
    })
    .join("");
  const lines = linesOfCredit(data, l);
  if (!existingRows && !newRows)
    return `<p class="muted">${l.w.noLoans}</p>${lines}`;
  return `<table class="figures"><thead><tr><th>${l.w.loan}</th><th class="num">${l.w.balance}</th><th class="num">${l.w.rate}</th><th>${l.w.terms}</th><th class="num">${l.w.firstYearService}</th></tr></thead><tbody>${existingRows}${newRows}</tbody><tfoot><tr><td>${l.w.total}${added.length || consolidated.size ? l.w.afterTheDeal : ""}</td><td></td><td></td><td></td><td class="num">${escape(l.figure(String(total), "amount"))}</td></tr></tfoot></table>${lines}`;
}

// Where the lines of credit's interest and usage are read: the post-project
// column when there's one (a fiscal year's before a year to date's), whose
// run counts the deal's lines; or else the first projected period.
function linePeriod(data: AnalysisDocumentData) {
  if (data.project) {
    const { periods } = data.project;
    const shown = periods.flatMap((period, p) =>
      data.postProject.includes(period.key) ? [p] : [],
    );
    const p = shown.find((p) => periods[p]!.months === 12) ?? shown[0];
    if (p !== undefined) return { run: data.project, p, post: true };
  }
  const run = data.project ?? data.run;
  const p = run.periods.findIndex((period) => period.projection !== null);
  return p < 0 ? null : { run, p, post: false };
}

// The lines of credit beside the loans, as the deal leaves them: those in
// force (closed ones no longer count), each as the scenario proposes it,
// then the new ones; with the usage assumed and a year's interest on it.
function linesOfCredit(data: AnalysisDocumentData, l: Locale): string {
  const { inForce, usage, proposed } = data.creditLines;
  const byId = new Map((proposed ?? []).map((line) => [line.id, line]));
  const ids = new Set(inForce.map((line) => line.id));
  const shown: {
    line: LineTerms;
    change: "changed" | "new" | "cancelled" | null;
  }[] = [
    ...inForce
      .filter((line) => !line.closedOn)
      .map((line) => {
        const own = byId.get(line.id);
        return {
          line: own && !own.closed ? own : line,
          change: !own
            ? null
            : own.closed
              ? ("cancelled" as const)
              : changesTerms(line, own)
                ? ("changed" as const)
                : null,
        };
      }),
    ...(proposed ?? [])
      .filter((line) => !ids.has(line.id) && !line.closed)
      .map((line) => ({ line, change: "new" as const })),
  ];
  if (!shown.length) return "";
  // When the scenario's lines apply: at closing, or with no project from
  // the first projected month.
  const last = data.run.periods.findLast((p) => p.projection === null);
  const when = data.deal
    ? l.w.atClosing
    : last
      ? l.w.asOfMonth(l.month(monthIndex(last.end) + 1))
      : "";
  const at = linePeriod(data);
  const part = (code: LineCode, id: string) => {
    const value = at?.run.creditLines[code][at.p];
    return value
      ? Number(value.parts.find((x) => x.id === id)?.value ?? 0)
      : null;
  };
  // Interest over a period's months, to a year's.
  const scale = at ? 12 / at.run.periods[at.p]!.months : 1;
  const amount = (value: number | null) =>
    value === null ? "–" : escape(l.figure(String(value), "amount"));
  const rows = shown
    .map(({ line, change }) => {
      const own = usage[line.id];
      const months = Object.keys(own?.months ?? {}).length;
      const assumed = own?.share !== undefined || months > 0;
      const tag =
        change === "changed"
          ? l.w.lineChanged(escape(when))
          : change === "new"
            ? l.w.lineAdded(escape(when))
            : change === "cancelled"
              ? l.w.lineCancelled(escape(when))
              : "";
      const interest = part("LINE_INTEREST", line.id);
      const annual = interest === null ? null : interest * scale;
      const how = [
        own?.share !== undefined
          ? l.w.ofTheLimit(escape(l.rate(own.share)))
          : null,
        months ? l.w.monthsEntered(months) : null,
      ].filter(Boolean);
      const used =
        change === "cancelled"
          ? "–"
          : !assumed
            ? `<span class="fail">${l.w.notAssumed}</span>`
            : `${amount(part("LINE_AVERAGE_USAGE", line.id))}${how.length ? `<small>${how.join(" · ")}</small>` : ""}`;
      return `<tr><td>${escape(line.name)}<small>${escape(line.currency)}${tag}</small></td><td>${escape(l.limit(line.limit))}</td><td class="num">${escape(l.rate(line.rate))}</td><td class="num">${used}</td><td class="num">${change === "cancelled" || !assumed ? "–" : amount(annual)}</td></tr>`;
    })
    .join("");
  const note = at
    ? `<small>${escape(at.run.periods[at.p]!.end.slice(0, 4))} ${at.post ? l.w.postProjectNote : l.w.projectedNote}</small>`
    : "";
  return `<table class="figures"><thead><tr><th>${l.w.lineOfCredit}</th><th>${l.w.limit}</th><th class="num">${l.w.rate}</th><th class="num">${l.w.averageUsage}${note}</th><th class="num">${l.w.interestAYear}${note}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// A loan year by year from its start, as the app's "By year" view shows it.
function loanYears(
  loan: Parameters<typeof amortize>[0],
  start: string,
  l: Locale,
) {
  const payments = amortize(loan, start).payments(120);
  if (!payments.length) return [];
  const from = monthIndex(start);
  const count = Math.ceil((payments.at(-1)!.month - from) / 12);
  return Array.from({ length: count }, (_, y) => {
    const first = from + y * 12 + 1;
    const last = from + (y + 1) * 12;
    const inYear = payments.filter((p) => p.month >= first && p.month <= last);
    const sum = (
      pick: (p: (typeof payments)[number]) => { toNumber(): number },
    ) => inYear.reduce((t, p) => t + pick(p).toNumber(), 0);
    return {
      months: l.w.monthRange(l.month(first), l.month(last)),
      interest: sum((p) => p.interest),
      principal: sum((p) => p.principal),
      extra: sum((p) => p.extra),
      balance:
        inYear.at(-1)?.after.toNumber() ?? (y ? 0 : Number(loan.balance)),
    };
  });
}

function amortizationBlock(data: AnalysisDocumentData, l: Locale): string {
  const loans: {
    name: string;
    loan: Parameters<typeof amortize>[0];
    start: string;
  }[] = [
    ...data.debt.flatMap((d: { schedule: DebtSchedule }) =>
      d.schedule.loans.map((loan: ExistingLoan) => ({
        name: loan.name,
        loan,
        start: d.schedule.asOf!,
      })),
    ),
    ...newLoans(data).map((loan) => ({
      name: `${loan.name}${l.w.newSuffix}`,
      loan: { ...loan, balance: loan.amount },
      start: data.deal!.closing,
    })),
  ];
  if (!loans.length) return `<p class="muted">${l.w.noSchedules}</p>`;
  return loans
    .map(({ name, loan, start }) => {
      const years = loanYears(loan, start, l);
      const extra = years.some((y) => y.extra);
      return `<section class="loan"><h3>${escape(name)}</h3><p class="muted">${l.w.loanSummary(escape(l.figure(loan.balance, "amount")), escape(l.rate(loan.rate)), escape(l.terms(loan)), escape(l.date(start)))}</p><table class="figures"><thead><tr><th>${l.w.year}</th><th>${l.w.months}</th><th class="num">${l.w.interest}</th><th class="num">${l.w.principal}</th>${extra ? `<th class="num">${l.w.extra}</th>` : ""}<th class="num">${l.w.balance}</th></tr></thead><tbody>${years
        .map(
          (y, i) =>
            `<tr><td>${i + 1}</td><td>${escape(y.months)}</td><td class="num">${l.money(y.interest)}</td><td class="num">${l.money(y.principal)}</td>${extra ? `<td class="num">${l.money(y.extra)}</td>` : ""}<td class="num">${l.money(y.balance)}</td></tr>`,
        )
        .join("")}</tbody></table></section>`;
    })
    .join("");
}

// Borrowing bases (borrowing-base-plan.md §12). One template serves every
// borrower: the blocks print whatever lines a definition has, in its
// order, and read the totals by their codes.

// A waterfall row's label: the definition's lines as the user wrote them,
// and what the app adds to them in the document's language.
function rowLabel(
  row: Pick<DocumentRow, "code" | "kind" | "label">,
  bb: DocumentBorrowingBase,
  l: Locale,
): string {
  const { w } = l;
  if (row.kind === "section") return w.bbSections[row.code] ?? row.label;
  if (Object.hasOwn(w.bbTotals, row.code)) return w.bbTotals[row.code]!;
  if (row.code.startsWith("FX."))
    return w.fxRate(row.code.slice(3), bb.currency);
  const dot = row.code.indexOf(".");
  if (dot === -1) return row.label;
  const owner = row.code.slice(0, dot);
  const suffix = row.code.slice(dot + 1);
  const own = bb.rows.find((r) => r.code === owner);
  if (suffix === "MARGINED") return own ? w.marginedOf(own.label) : row.label;
  // The first ineligible bucket "and over", the bucket named as the user
  // named it.
  if (suffix === "AGED_OUT") {
    const bucket = bb.rows.find(
      (r) =>
        r.code.startsWith(`${owner}.AGE`) &&
        `${r.label} and over` === row.label,
    );
    return bucket ? w.andOver(bucket.label) : row.label;
  }
  if (/^AGE\d+$/.test(suffix)) return row.label;
  return w.bbDetails[suffix] ?? row.label;
}

// A figure as its row formats it: advance rates as rates, exchange rates
// to four decimals.
function bbFigure(
  row: Pick<DocumentRow, "code" | "format">,
  value: string | null,
  l: Locale,
): string {
  if (value === null) return "";
  if (row.code.startsWith("FX.")) return l.exchange(value);
  if (row.code.endsWith(".RATE")) return l.rate(value);
  return l.figure(value, row.format as Format);
}

const negative = (value: string | null) =>
  value !== null && value.startsWith("-");

// A month as a table's row heads it: "Nov 2025", and whether it's
// reported, verified, projected or missing.
function monthHead(
  bb: DocumentBorrowingBase,
  p: number,
  l: Locale,
  deal = false,
): string {
  const m = bb.months[p]!;
  const note = m.projected
    ? l.w.projected
    : m.quality
      ? l.w.certificateQualities[m.quality]
      : l.w.noCertificate;
  return `${escape(l.month(monthIndex(m.end)))}<small>${escape(note)}${deal ? ` · ${escape(l.w.dealTerms)}` : ""}</small>`;
}

// A month with figures to show: one with a certificate, or projected.
const counted = (bb: DocumentBorrowingBase, p: number) =>
  bb.months[p]!.projected || bb.months[p]!.quality !== null;

const testName = (test: DocumentTest, l: Locale) =>
  test.builtIn ? (l.w.bbTests[test.id] ?? test.name) : test.name;

// A row the definition may not have, such as a code a template names that
// this borrower's lines don't.
const rowOf = (bb: DocumentBorrowingBase, code: string): DocumentRow =>
  bb.rows.find((r) => r.code === code) ?? {
    code,
    label: code,
    kind: "line",
    format: "amount",
    depth: 0,
  };

// The month's waterfall, as a certificate lays it out: each collateral line
// with its amount, ineligibles, eligible amount, advance rate and margined
// amount, its aging and ineligibles under it; groups and their caps; then
// the borrowing base, prior claims and reserves taken off it, the limit,
// usage, and the margin surplus or deficit.
function waterfallBlock(data: DocumentData, l: Locale): string {
  const bb = lineOf(data);
  if (!bb) return "";
  const p = bb.months.length - 1;
  const month = bb.months[p]!;
  const value = (code: string) => bb.values[code]?.[p] ?? null;
  const codes = new Set(bb.rows.map((r) => r.code));
  const amount = (v: string | null) => escape(l.figure(v, "amount")) || "–";
  // An amount in another currency, in the line's.
  const converted = (v: string | null, currency: string | undefined) => {
    const rate = currency ? value(`FX.${currency}`) : null;
    if (!currency || v === null) return { value: v, note: "" };
    if (rate === null) return { value: null, note: "" };
    return {
      value: new Dec(v).times(rate).toFixed(),
      note: `<small>${escape(l.w.atExchange(currency, l.figure(v, "amount"), l.exchange(rate)))}</small>`,
    };
  };
  const indent = (depth: number) =>
    depth ? ` style="padding-left:${6 + depth * 14}px"` : "";
  // A row with one figure, in the last column.
  const single = (row: DocumentRow, figure: string, note = "", tone = "") =>
    `<tr class="${row.kind}"><td${indent(row.depth)}>${escape(rowLabel(row, bb, l))}${note}</td><td></td><td></td><td></td><td></td><td class="num${tone}">${figure}</td></tr>`;
  // Deductions read as such: (285,000).
  const less = (v: string | null) =>
    v === null ? null : negative(v) ? v.slice(1) : v === "0" ? v : `-${v}`;
  const out: string[] = [];
  // The collateral lines in the group being laid out, whose margined
  // amounts its cap applies to.
  let members: string[] = [];
  for (const row of bb.rows) {
    const label = escape(rowLabel(row, bb, l));
    const dot = row.code.indexOf(".");
    const suffix = dot === -1 ? null : row.code.slice(dot + 1);
    if (row.kind === "section") {
      out.push(`<tr class="section"><td colspan="6">${label}</td></tr>`);
      continue;
    }
    // Assumptions are for projections; a month's certificate has none.
    if (row.lineKind === "assumption") continue;
    if (row.lineKind === "group" && row.kind === "line") {
      members = [];
      out.push(
        `<tr class="group"><td${indent(row.depth)}>${label}</td><td colspan="5"></td></tr>`,
      );
      continue;
    }
    if (row.lineKind === "group" && row.kind === "subtotal") {
      const owner = row.code.slice(0, dot);
      const cap = codes.has(`${owner}.CAP`) ? value(`${owner}.CAP`) : null;
      const before = members.reduce(
        (sum, code) => sum.plus(value(code) ?? 0),
        new Dec(0),
      );
      const note =
        cap === null
          ? ""
          : `<small>${escape(l.w.capOf(l.figure(cap, "amount")))}${before.gt(cap) ? ` · ${escape(l.w.beforeCap(l.figure(before.toFixed(), "amount")))}` : ""}</small>`;
      out.push(single(row, amount(value(row.code)), note));
      continue;
    }
    if (row.lineKind === "collateral" && row.kind === "line") {
      members.push(`${row.code}.MARGINED`);
      const rate = row.currency ? value(`FX.${row.currency}`) : null;
      const note = row.currency
        ? `<small>${escape(l.w.inCurrency(row.currency, rate === null ? "–" : l.exchange(rate)))}</small>`
        : "";
      const cap = codes.has(`${row.code}.CAP`)
        ? `<small>${escape(l.w.capOf(l.figure(value(`${row.code}.CAP`), "amount")))}</small>`
        : "";
      out.push(
        `<tr class="line"><td${indent(row.depth)}>${label}${note}</td><td class="num">${amount(value(row.code))}</td><td class="num">${amount(value(`${row.code}.INELIGIBLE`))}</td><td class="num">${amount(value(`${row.code}.ELIGIBLE`))}</td><td class="num">${escape(bbFigure({ code: `${row.code}.RATE`, format: "percent" }, value(`${row.code}.RATE`), l)) || "–"}</td><td class="num">${amount(value(`${row.code}.MARGINED`))}${cap}</td></tr>`,
      );
      continue;
    }
    // What a collateral line computes is in its own row already, and a
    // group's cap in its total's.
    if (
      suffix &&
      ["INELIGIBLE", "ELIGIBLE", "RATE", "CAP", "MARGINED"].includes(suffix)
    )
      continue;
    if (suffix && /^AGE\d+$/.test(suffix)) {
      out.push(
        `<tr class="detail"><td${indent(row.depth)}>${label}</td><td class="num">${amount(value(row.code))}</td><td></td><td></td><td></td><td></td></tr>`,
      );
      continue;
    }
    if (suffix === "AGED_OUT" || row.lineKind === "ineligible") {
      out.push(
        `<tr class="detail"><td${indent(row.depth)}>${label}</td><td></td><td class="num">${amount(value(row.code))}</td><td></td><td></td><td></td></tr>`,
      );
      continue;
    }
    if (row.code === "BB_COLLATERAL") {
      out.push(
        `<tr class="detail"><td>${label}</td><td class="num">${amount(value(row.code))}</td><td></td><td></td><td></td><td></td></tr>`,
      );
      continue;
    }
    if (
      row.lineKind === "prior_claim" ||
      row.lineKind === "reserve" ||
      row.code === "BB_PRIOR_CLAIMS" ||
      row.code === "BB_RESERVES"
    ) {
      const { value: v, note } = converted(value(row.code), row.currency);
      out.push(single(row, amount(less(v)), note));
      continue;
    }
    if (row.lineKind === "usage") {
      const { value: v, note } = converted(value(row.code), row.currency);
      out.push(single(row, amount(v), note));
      continue;
    }
    const v = value(row.code);
    out.push(
      single(
        row,
        escape(bbFigure(row, v, l)) || "–",
        "",
        (row.code === "BB_SURPLUS" || row.code === "BB_EXCESS") && negative(v)
          ? " fail"
          : "",
      ),
    );
  }
  const head = `<tr><th>${escape(l.w.asAt(l.date(month.end)))}</th><th class="num">${l.w.amount}</th><th class="num">${l.w.ineligible}</th><th class="num">${l.w.eligible}</th><th class="num">${l.w.advanceRate}</th><th class="num">${l.w.margined}</th></tr>`;
  return `<h2>${l.w.borrowingBaseCertificate} <span class="tag">${escape(bb.name)} · ${escape(l.monthYear(month.month))}</span></h2><table class="figures waterfall"><thead>${head}</thead><tbody>${out.join("")}</tbody></table>`;
}

// The totals shown month by month when a section names none.
const HISTORY_CODES = [
  "BB_GROSS",
  "BB_TOTAL",
  "BB_LIMIT",
  "BB_AVAILABLE",
  "BB_USAGE",
  "BB_SURPLUS",
  "BB_EXCESS",
  "BB_UTILIZATION",
];
const PROJECTION_CODES = [
  "BB_TOTAL",
  "BB_LIMIT",
  "BB_USAGE",
  "BB_SURPLUS",
  "BB_EXCESS",
  "BB_UTILIZATION",
];

// A figure in a table of months: a dash in a month without a certificate,
// a deficit in red.
function monthCell(
  bb: DocumentBorrowingBase,
  row: DocumentRow,
  p: number,
  l: Locale,
  values = bb.values,
  className = "",
): string {
  const v = values[row.code]?.[p] ?? null;
  const shown = counted(bb, p) ? escape(bbFigure(row, v, l)) : "";
  const tone =
    (row.code === "BB_SURPLUS" || row.code === "BB_EXCESS") && negative(v)
      ? " fail"
      : "";
  return `<td class="num${className}${tone}">${shown || "–"}</td>`;
}

// Chosen figures month by month, up to the month printed.
function historyBlock(
  block: Extract<Block, { type: "bbHistory" }>,
  data: DocumentData,
  l: Locale,
): string {
  const bb = lineOf(data);
  if (!bb) return "";
  const count = Math.min(block.months ?? 12, bb.months.length);
  const from = bb.months.length - count;
  const rows = (block.lines ?? HISTORY_CODES).map((code) => rowOf(bb, code));
  const body = bb.months
    .slice(from)
    .map((_, i) => {
      const p = from + i;
      return `<tr><td>${monthHead(bb, p, l)}</td>${rows.map((row) => monthCell(bb, row, p, l)).join("")}</tr>`;
    })
    .join("");
  return `<h2>${l.w.marginHistory} <span class="tag">${escape(bb.name)}</span></h2><table class="figures months"><thead><tr><th>${l.w.month}</th>${rows.map((row) => `<th class="num">${escape(rowLabel(row, bb, l))}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

// "Margin surplus (deficit), at least 0".
function requirement(
  bb: DocumentBorrowingBase,
  test: DocumentTest,
  threshold: string | null,
  l: Locale,
) {
  const row = rowOf(bb, test.metric);
  return `${rowLabel(row, bb, l)}, ${test.test === "min" ? l.w.atLeast : l.w.atMost}${threshold === null ? "" : ` ${bbFigure(row, threshold, l)}`}`;
}

// Each test, month by month up to the month printed, or the month's alone.
function testsBlock(
  block: Extract<Block, { type: "bbTests" }>,
  data: DocumentData,
  l: Locale,
): string {
  const bb = lineOf(data);
  if (!bb || !bb.tests.length) return "";
  const last = bb.months.length - 1;
  const count = Math.min(block.months ?? 12, bb.months.length);
  const figure = (test: DocumentTest, v: string | null) =>
    escape(bbFigure(rowOf(bb, test.metric), v, l));
  const heading = `<h2>${l.w.bbTestsHeading}${count === 1 ? ` <span class="tag">${escape(l.monthYear(bb.months[last]!.month))}</span>` : ""}</h2>`;
  if (count === 1) {
    const rows = bb.tests
      .map((test) => {
        const m = test.months[last]!;
        const result =
          m.pass === null
            ? "–"
            : `<span class="${m.pass ? "pass" : "fail"}">${escape(l.figure(String(m.pass), "flag"))}</span>`;
        const room =
          m.margin === null
            ? "–"
            : `${negative(m.margin) ? "−" : "+"}${figure(test, m.margin.replace(/^-/, ""))}`;
        return `<tr><td><strong>${escape(testName(test, l))}</strong></td><td>${escape(requirement(bb, test, m.threshold, l))}</td><td class="num">${figure(test, m.value) || "–"}</td><td class="num">${room}</td><td>${result}</td></tr>`;
      })
      .join("");
    return `${heading}<table class="figures"><thead><tr><th>${l.w.test}</th><th>${l.w.requirement}</th><th class="num">${l.w.actualFigure}</th><th class="num">${l.w.bbRoom}</th><th>${l.w.result}</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  const from = bb.months.length - count;
  const cell = (test: DocumentTest, p: number) => {
    const m = test.months[p]!;
    if (m.pass === null) return `<td class="num">–</td>`;
    const margin = figure(test, m.margin!.replace(/^-/, ""));
    return `<td class="num"><span class="${m.pass ? "pass" : "fail"}">${figure(test, m.value)}</span><small>${figure(test, m.threshold)} · ${negative(m.margin) ? "−" : "+"}${margin}</small></td>`;
  };
  const body = bb.months
    .slice(from)
    .map((_, i) => {
      const p = from + i;
      return `<tr><td>${monthHead(bb, p, l)}</td>${bb.tests.map((t) => cell(t, p)).join("")}</tr>`;
    })
    .join("");
  const failed = bb.tests
    .map(
      (t) =>
        `<td class="num">${t.months.slice(from).filter((m) => m.pass === false).length}</td>`,
    )
    .join("");
  return `${heading}<table class="figures months"><thead><tr><th>${l.w.month}</th>${bb.tests.map((t) => `<th class="num">${escape(testName(t, l))}<small>${escape(requirement(bb, t, null, l))}</small></th>`).join("")}</tr></thead><tbody>${body}</tbody><tfoot><tr><td>${l.w.monthsFailed}</td>${failed}</tr></tfoot></table>`;
}

// The business cycle by fiscal year and over the last twelve months: how
// high usage peaked, how low it fell (the part of the line never repaid),
// and how thin the margin got.
function cycleBlock(data: DocumentData, l: Locale): string {
  const bb = lineOf(data);
  const cycle = bb?.cycle;
  if (!bb || !cycle) return "";
  const summaries = [...cycle.years, ...(cycle.last12 ? [cycle.last12] : [])];
  if (!summaries.length) return "";
  const head = (s: CycleSummary) => {
    const year = /^FY(\d{4})$/.exec(s.label);
    const name =
      s === cycle.last12
        ? l.w.last12
        : year
          ? l.w.fiscalYear(year[1]!)
          : s.label;
    const [from, to] = [s.from, s.to].map((m) => l.month(monthNumber(m)));
    return `<th class="num">${escape(name)}<small>${escape(from === to ? from! : l.w.monthRange(from!, to!))}</small></th>`;
  };
  const at = (f: CycleFigure | null, format: Format, fail = false) =>
    f
      ? `<span${fail && negative(f.value) ? ` class="fail"` : ""}>${escape(l.figure(f.value, format))}</span><small>${escape(l.month(monthNumber(f.month)))}</small>`
      : "–";
  const plain = (v: string | null, format: Format = "amount") =>
    escape(l.figure(v, format)) || "–";
  const rows: [string, (s: CycleSummary) => string][] = [
    [l.w.monthsReported, (s) => plain(String(s.months), "count")],
    [l.w.peakUsage, (s) => at(s.peakUsage, "amount")],
    [l.w.averageUsage, (s) => plain(s.averageUsage)],
    [l.w.lowestUsage, (s) => at(s.lowestUsage, "amount")],
    [l.w.lowestSurplus, (s) => at(s.lowestSurplus, "amount", true)],
    [
      l.w.deficitMonths,
      (s) =>
        s.deficitMonths ? `<span class="fail">${s.deficitMonths}</span>` : "0",
    ],
    [l.w.highestUtilization, (s) => at(s.highestUtilization, "percent")],
    [l.w.averageBorrowingBase, (s) => plain(s.averageBorrowingBase)],
    [l.w.lowestBorrowingBase, (s) => at(s.lowestBorrowingBase, "amount")],
    ...bb.tests
      .filter((t) => t.id !== "margin")
      .map((t): [string, (s: CycleSummary) => string] => [
        l.w.failedMonths(testName(t, l)),
        (s) => {
          const n = s.failed[t.id] ?? 0;
          return n ? `<span class="fail">${n}</span>` : "0";
        },
      ]),
  ];
  return `<h2>${l.w.businessCycle}</h2><table class="figures"><thead><tr><th></th>${summaries.map(head).join("")}</tr></thead><tbody>${rows.map(([label, cell]) => `<tr><td>${escape(label)}</td>${summaries.map((s) => `<td class="num">${cell(s)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

// A borrowing base's charts over its months from `from`: bars and lines by
// month, projected months shaded, and a threshold read from its figures,
// such as the limit, which steps with its seasons and a deal's terms.
function bbCharts(
  bb: DocumentBorrowingBase,
  charts: ChartDefinition[],
  from: number,
  l: Locale,
): string[] {
  const months = bb.months.slice(from);
  const periods = months.map((m) => ({
    label: l.monthShort(monthIndex(m.end)),
    projected: m.projected,
  }));
  const series = (code: string) =>
    (bb.values[code] ?? bb.values[code.toUpperCase()] ?? [])
      .slice(from)
      .map((v, i) => (v === null || !counted(bb, from + i) ? null : Number(v)));
  const range = months.length
    ? l.w.monthRange(
        l.month(monthIndex(months[0]!.end)),
        l.month(monthIndex(months.at(-1)!.end)),
      )
    : "";
  return charts.map((chart) => {
    const first = rowOf(bb, chart.series[0]!.code.toUpperCase());
    const input: ChartInput = {
      format: asChartFormat(first.format),
      monthly: true,
      periods,
      series: chart.series.map((s) => ({
        label: rowLabel(rowOf(bb, s.code.toUpperCase()), bb, l),
        mark: s.mark,
        values: series(s.code),
      })),
      threshold: null,
    };
    if (chart.threshold) {
      const values = series(chart.threshold);
      if (values.some((v) => v !== null))
        input.threshold = {
          label: rowLabel(rowOf(bb, chart.threshold.toUpperCase()), bb, l),
          values,
        };
    }
    // The built-in charts in the document's language; a definition's own
    // as titled.
    const builtIn = DEFAULT_BB_CHARTS.find(
      (c) => c.id === chart.id && c.title === chart.title,
    );
    const title = builtIn
      ? (l.w.bbCharts[chart.id] ?? chart.title)
      : chart.title;
    return `<figure><figcaption>${escape(title)}<small>${escape(range)}</small></figcaption>${legendHtml(input, l)}${chartSvg(input, l)}</figure>`;
  });
}

// A line's charts, over its last months to the month printed.
function lineChartsBlock(
  block: Extract<Block, { type: "charts" }>,
  data: DocumentData,
  l: Locale,
): string {
  const bb = lineOf(data);
  if (!bb) return "";
  const charts = bb.charts.filter(
    (c) => !block.charts || block.charts.includes(c.id),
  );
  if (!charts.length) return "";
  const from =
    bb.months.length - Math.min(block.months ?? 12, bb.months.length);
  return `<h2>${l.w.charts}</h2><div class="charts">${bbCharts(bb, charts, from, l).join("")}</div>`;
}

// The totals a deal's terms can move, shown as they'd be without them
// beside the projection where they differ.
const AS_IS_CODES = ["BB_TOTAL", "BB_LIMIT", "BB_SURPLUS", "BB_EXCESS"];

// A month's tests in one cell: a pass, the names of those failed, or a dash
// for a month not tested.
function testsCell(bb: DocumentBorrowingBase, p: number, l: Locale) {
  const tested = bb.tests.filter((t) => (t.months[p]?.pass ?? null) !== null);
  if (!tested.length) return "–";
  const failed = tested.filter((t) => t.months[p]!.pass === false);
  return failed.length
    ? `<span class="fail">${escape(l.figure("false", "flag"))}</span><small>${escape(l.list(failed.map((t) => testName(t, l))))}</small>`
    : `<span class="pass">${escape(l.figure("true", "flag"))}</span>`;
}

// From an analysis: each margined line's last twelve months and its months
// projected under the scenario; the months under the deal's terms shaded
// from the first, and the totals as they'd be without them beside, where
// they differ.
function projectionBlock(
  block: Extract<Block, { type: "bbProjection" }>,
  data: AnalysisDocumentData,
  l: Locale,
): string {
  const heading = `<h2>${l.w.projectedMargin} <span class="tag">${escape(data.scenario?.name ?? l.w.baseCase)}</span></h2>`;
  const lines = data.borrowingBase.lines;
  if (!lines.length)
    return `${heading}<p class="muted">${l.w.noMarginedLines}</p>`;
  const sections = lines.map((bb) => {
    const rows = (block.lines ?? PROJECTION_CODES).map((code) =>
      rowOf(bb, code),
    );
    const after = bb.proposedAfter ? monthNumber(bb.proposedAfter) : null;
    const deal = (p: number) =>
      after !== null && monthNumber(bb.months[p]!.month) > after;
    const asIs = bb.asIs
      ? rows.filter(
          (row) =>
            AS_IS_CODES.includes(row.code) &&
            (bb.asIs![row.code] ?? []).some(
              (v, p) => v !== (bb.values[row.code]?.[p] ?? null),
            ),
        )
      : [];
    const tags = [
      bb.currency,
      ...(bb.proposedNew ? [l.w.proposedNewLine] : []),
      ...(after !== null ? [l.w.dealTermsFrom(l.month(after + 1))] : []),
    ];
    const head = `<tr><th>${l.w.month}</th>${rows.map((row) => `<th class="num">${escape(rowLabel(row, bb, l))}</th>`).join("")}${asIs.map((row) => `<th class="num">${escape(rowLabel(row, bb, l))}${escape(l.w.asIs)}</th>`).join("")}${bb.tests.length ? `<th>${l.w.bbTestsHeading}</th>` : ""}</tr>`;
    const body = bb.months
      .map((m, p) => {
        const tone = `${m.projected ? " projected" : ""}${deal(p) ? " post" : ""}`;
        const first = deal(p) && !deal(p - 1);
        return `<tr><td class="${tone.trim()}">${monthHead(bb, p, l, first)}</td>${rows.map((row) => monthCell(bb, row, p, l, bb.values, tone)).join("")}${asIs.map((row) => monthCell(bb, row, p, l, bb.asIs!, tone)).join("")}${bb.tests.length ? `<td class="${tone.trim()}">${testsCell(bb, p, l)}</td>` : ""}</tr>`;
      })
      .join("");
    const usage =
      bb.usage?.projected != null && bb.usage.assumed != null
        ? `<p class="${bb.usage.gap ? "fail" : "muted"}">${escape(l.w.usageCheck(l.figure(bb.usage.projected, "amount"), l.figure(bb.usage.assumed, "amount")))}</p>`
        : "";
    const charts = bbCharts(bb, bb.charts, 0, l);
    return `<section class="bb"><h3>${escape(bb.name)} ${tags.map((t) => `<span class="tag">${escape(t)}</span>`).join("")}</h3><table class="figures months"><thead>${head}</thead><tbody>${body}</tbody></table>${usage}${charts.length ? `<div class="charts">${charts.join("")}</div>` : ""}</section>`;
  });
  return `${heading}${sections.join("")}`;
}

// A statement and lines for the client's officer to sign and date.
function signatureBlock(
  block: Extract<Block, { type: "bbSignature" }>,
  data: DocumentData,
  l: Locale,
): string {
  const bb = lineOf(data);
  const statement = block.text
    ? prose(block.text, data, l)
    : `<p>${escape(
        bb
          ? l.w.certifiesMonth(
              data.borrower.name,
              l.date(bb.months.at(-1)!.end),
              data.organization.name,
            )
          : l.w.certifies(data.borrower.name),
      )}</p>`;
  const lines = [l.w.signature, l.w.nameAndTitle, l.w.signedOn]
    .map(
      (label) => `<div><span class="rule"></span><small>${label}</small></div>`,
    )
    .join("");
  return `<section class="signature">${statement}<div class="sign">${lines}</div></section>`;
}

// A block over the data; one its source can't fill prints nothing, as in a
// draft's preview (checkDefinition refuses it at publishing).
function block(b: Block, data: DocumentData, l: Locale): string {
  if (!shows(b.when, data)) return "";
  const analysis = fromAnalysis(data) ? data : null;
  switch (b.type) {
    case "heading":
      return `<h2>${escape(merge(b.text, data, l))}</h2>`;
    case "text":
      return prose(b.text, data, l);
    case "facts":
      return factsBlock(data, l);
    case "lines":
      return analysis ? linesBlock(b, analysis, l) : "";
    case "covenants":
      return analysis ? covenantsBlock(analysis, l) : "";
    case "charts":
      return analysis
        ? chartsBlock(b, analysis, l)
        : lineChartsBlock(b, data, l);
    case "sourcesUses":
      return analysis ? sourcesUsesBlock(analysis, l) : "";
    case "debt":
      return analysis ? debtBlock(analysis, l) : "";
    case "amortization":
      return analysis ? amortizationBlock(analysis, l) : "";
    case "bbWaterfall":
      return waterfallBlock(data, l);
    case "bbHistory":
      return historyBlock(b, data, l);
    case "bbTests":
      return testsBlock(b, data, l);
    case "bbCycle":
      return cycleBlock(data, l);
    case "bbProjection":
      return analysis ? projectionBlock(b, analysis, l) : "";
    case "bbSignature":
      return signatureBlock(b, data, l);
    case "pageBreak":
      return `<div class="page-break"></div>`;
  }
}

const css = (color: string, orientation: RenderedDocument["orientation"]) => `
@page { size: Letter ${orientation}; margin: 16mm 14mm 18mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 9.5pt/1.4 "Inter", "Helvetica Neue", Arial, sans-serif; color: #0f172a; }
header.doc { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; border-bottom: 2px solid ${color}; padding-bottom: 10px; margin-bottom: 14px; }
header.doc h1 { font-size: 16pt; margin: 0 0 2px; letter-spacing: -0.01em; }
header.doc p { margin: 0; color: #475569; }
header.doc img { max-height: 40px; max-width: 160px; }
header.doc .org { text-align: right; font-weight: 600; color: ${color}; }
h2 { font-size: 11pt; color: ${color}; margin: 18px 0 6px; break-after: avoid; }
h3 { font-size: 10pt; margin: 14px 0 2px; break-after: avoid; }
p { margin: 4px 0; }
small { display: block; font-size: 7.5pt; color: #64748b; font-weight: 400; }
.muted { color: #64748b; }
.pass { color: #15803d; font-weight: 600; }
.fail { color: #b91c1c; font-weight: 600; }
.tag { font-size: 8pt; font-weight: 500; color: #475569; background: #f1f5f9; border-radius: 4px; padding: 1px 6px; margin-left: 6px; vertical-align: middle; }
dl.facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 16px; margin: 0 0 8px; padding: 10px 12px; background: #f8fafc; border-radius: 6px; }
dl.facts dt { font-size: 7.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
dl.facts dd { margin: 0; font-weight: 500; }
table.figures { width: 100%; border-collapse: collapse; margin: 4px 0 10px; font-size: 8.5pt; }
table.figures th { text-align: left; font-weight: 600; color: #334155; border-bottom: 1px solid #94a3b8; padding: 4px 6px; vertical-align: bottom; }
table.figures td { border-bottom: 1px solid #e2e8f0; padding: 3px 6px; vertical-align: top; }
table.figures tfoot td { font-weight: 600; border-top: 1px solid #94a3b8; border-bottom: none; }
table.figures tr { break-inside: avoid; }
table.figures thead { display: table-header-group; }
table.figures .num, .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
th.projected, td.projected { background: #f8fafc; }
th.post, td.post { background: #eff6ff; }
tr.section td { font-weight: 600; color: ${color}; text-transform: uppercase; font-size: 7.5pt; letter-spacing: 0.05em; padding-top: 8px; border-bottom: 1px solid #cbd5e1; }
table.covenants td.room { font-size: 8pt; color: #334155; max-width: 220px; }
small.note { font-style: italic; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
ul { margin: 4px 0; padding-left: 16px; }
ul.extras { margin: 4px 0 8px; }
.charts { display: grid; grid-template-columns: repeat(${orientation === "landscape" ? 3 : 2}, 1fr); gap: 14px; }
figure { margin: 0; padding: 8px; border: 1px solid #e2e8f0; border-radius: 6px; break-inside: avoid; }
figcaption { font-weight: 600; margin-bottom: 4px; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 7.5pt; color: #475569; margin-bottom: 4px; }
.legend .key { display: inline-flex; align-items: center; gap: 4px; }
.legend i { display: inline-block; width: 10px; height: 8px; border-radius: 2px; }
.legend i.dashed { height: 0; border-top: 1.5px dashed #0f172a; border-radius: 0; }
section.loan { break-inside: avoid-page; }
table.months th, table.months th.num { white-space: normal; }
table.months td:first-child { white-space: nowrap; }
table.waterfall tr.subtotal td { font-weight: 600; border-top: 1px solid #cbd5e1; }
table.waterfall tr.total td { font-weight: 700; border-top: 1.5px solid #64748b; }
table.waterfall tr.group td { font-weight: 600; }
table.waterfall tr.detail td { color: #475569; font-size: 8pt; }
section.bb { margin-bottom: 12px; }
section.bb h3 .tag { margin-left: 4px; }
section.signature { margin-top: 18px; break-inside: avoid; }
.sign { display: grid; grid-template-columns: 2fr 2fr 1fr; gap: 24px; margin-top: 40px; }
.sign .rule { display: block; border-bottom: 1px solid #0f172a; height: 28px; }
.page-break { break-after: page; }
@media screen { body { max-width: ${orientation === "landscape" ? 1056 : 816}px; margin: 24px auto; padding: 0 24px; } }
`;

// A document from its data, as assembled now or as a snapshot kept it,
// whatever its version.
export function renderDocument(
  template: Template,
  kept: KeptDocumentData,
): RenderedDocument {
  const data = readDocumentData(kept);
  const l = locale(template.language);
  const title = merge(template.title, data, l);
  const { branding } = data.organization;
  const color = /^#[0-9a-f]{6}$/i.test(branding.color ?? "")
    ? branding.color!
    : DEFAULT_COLOR;
  const { orientation } = template;
  const bb = lineOf(data);
  const subtitle = (
    fromAnalysis(data)
      ? [
          data.analysis.name,
          `${data.model.name} v${data.model.version}`,
          data.scenario?.name ?? l.w.baseCase,
          l.date(data.date),
        ]
      : bb
        ? [
            `${bb.name} · ${bb.currency}`,
            l.monthYear(bb.months.at(-1)!.month),
            l.date(data.date),
          ]
        : [l.date(data.date)]
  )
    .map(escape)
    .join(" · ");
  const html = `<!doctype html>
<html lang="${l.language}">
<head>
<meta charset="utf-8">
<title>${escape(title)}</title>
<style>${css(color, orientation)}</style>
</head>
<body>
<header class="doc">
<div><h1>${escape(title)}</h1><p>${subtitle}</p></div>
<div class="org">${branding.logo?.startsWith("data:image/") ? `<img src="${escape(branding.logo)}" alt="">` : escape(data.organization.name)}</div>
</header>
${template.blocks.map((b) => block(b, data, l)).join("\n")}
</body>
</html>`;
  const notice =
    branding.notice?.trim() ||
    `${data.organization.name} · ${l.w.confidential}`;
  const footer = `<div style="width:100%;font:7pt Arial,sans-serif;color:#64748b;padding:0 14mm;display:flex;justify-content:space-between;"><span>${escape(notice)}</span><span>${escape(title)} · ${l.w.page(`<span class="pageNumber"></span>`, `<span class="totalPages"></span>`)}</span></div>`;
  return { title, html, footer, orientation };
}
