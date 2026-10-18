import {
  amortize,
  describeTerms,
  imbalance,
  monthIndex,
  monthOf,
  nextYearDebtService,
  projectTotals,
  type CovenantPeriod,
  type DebtSchedule,
  type ExistingLoan,
  type ProjectLoan,
} from "@finance/domain";
import { chartSvg, legendHtml, type ChartInput } from "./chart";
import type { DocumentData, DocumentRun } from "./data";
import { date, escape, figure, money, rate, type Format } from "./format";
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

// A merge field's value, e.g. "borrower.name" or "line.DSCR.post"; null
// for a field there's no such thing as.
function field(path: string, data: DocumentData): string | null {
  const [head, code, post] = path.split(".");
  if (head === "line" && code) {
    const line = data.lines.find((l) => l.code === code);
    if (!line || line.kind === "header" || (post && post !== "post"))
      return null;
    const p = lastYear(data.run);
    const run = post ? data.project : data.run;
    return p < 0 || !run
      ? ""
      : figure(run.values[line.code]?.[p] ?? null, line.format as Format);
  }
  const fields: Record<string, string> = {
    "borrower.name": data.borrower.name,
    "borrower.industry": data.borrower.industry ?? "",
    "analysis.name": data.analysis.name,
    "model.name": data.model.name,
    "model.version": `v${data.model.version}`,
    "scenario.name": data.scenario?.name ?? "Base case",
    "organization.name": data.organization.name,
    date: date(data.date),
  };
  return fields[path] ?? null;
}

// {{borrower.name}} and the like; unknown fields are left as typed.
export function merge(text: string, data: DocumentData): string {
  return text.replace(
    MERGE_FIELD,
    (whole, path: string) => field(path, data) ?? whole,
  );
}

// A text block's paragraphs, between blank lines, with "- " bullets,
// **bold** and *italics*. What's typed is escaped before it's formatted, and
// merge fields are filled in last, so neither can make markup.
function prose(text: string, data: DocumentData): string {
  const inline = (line: string) =>
    escape(line)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(MERGE_FIELD, (whole, path: string) =>
        escape(field(path, data) ?? whole),
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

// Whether a block with this condition shows in this document.
export function shows(when: Condition | undefined, data: DocumentData) {
  const results = [
    ...data.covenants.run,
    ...(data.covenants.project ?? []),
  ].flatMap((c) => c.periods.map((p) => p.pass));
  switch (when) {
    case undefined:
      return true;
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

const QUALITIES: Record<DocumentRun["periods"][number]["quality"], string> = {
  audited: "Audited",
  review: "Review engagement",
  compilation: "Compilation",
  internal: "Internal",
  projected: "Projected",
};

// A month index as "Jan 2025".
const month = (index: number) => {
  const [year, m] = monthOf(index).split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleString("en-CA", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

// The latest fiscal year that isn't projected.
const lastYear = (run: DocumentRun) =>
  run.periods.findLastIndex((p) => !p.projection && p.months === 12);

const periodHead = (run: DocumentRun, p: number) => {
  const period = run.periods[p]!;
  return `${escape(date(period.end))}<small>${
    period.projection === "assumptions"
      ? "Projected"
      : period.projection === "client"
        ? "Client projection"
        : `${period.months} mo · ${QUALITIES[period.quality]}`
  }</small>`;
};

// The columns a table shows: each period, and a post-project column after
// those the analysis shows one for.
function columns(data: DocumentData, recent: boolean) {
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
  data: DocumentData,
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
          const shownValue = figure(value, line.format as Format);
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
        `<th class="num${c.post ? " post" : ""}${data.run.periods[c.p]!.projection ? " projected" : ""}">${c.post ? `Post-project<small>${escape(date(data.run.periods[c.p]!.end))}</small>` : periodHead(data.run, c.p)}</th>`,
    )
    .join("");
  return `${block.title ? `<h2>${escape(merge(block.title, data))}</h2>` : ""}<table class="figures"><thead><tr><th>${escape(data.scenario?.name ?? "Base case")}</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function factsBlock(data: DocumentData): string {
  const facts: [string, string][] = [
    [
      data.borrower.kind === "consolidated"
        ? "Consolidated client"
        : "Borrower",
      data.borrower.name,
    ],
    ...(data.borrower.members.length
      ? ([["Members", data.borrower.members.join(", ")]] as [string, string][])
      : []),
    ...(data.borrower.industry || data.borrower.naicsCode
      ? ([
          [
            "Industry",
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
      ? ([["Risk rating", data.borrower.riskRating]] as [string, string][])
      : []),
    ["Analysis", data.analysis.name],
    ["Financial model", `${data.model.name} · v${data.model.version}`],
    ["Scenario", data.scenario?.name ?? "Base case"],
    [
      "Projections",
      data.analysis.projectionMode === "client"
        ? "The client's own"
        : `${data.analysis.projectionYears} years from assumptions`,
    ],
  ];
  return `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`).join("")}</dl>`;
}

const asChartFormat = (format: string): ChartInput["format"] =>
  format === "percent" || format === "ratio" || format === "count"
    ? format
    : "amount";

function covenantsBlock(data: DocumentData): string {
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
      return `<small>no figure · ${escape(figure(period.threshold, format))}</small>`;
    const margin = figure(period.margin!.replace(/^-/, ""), format);
    return `<span class="${period.pass ? "pass" : "fail"}">${escape(figure(period.actual, format))}</span><small>${escape(figure(period.threshold, format))} · ${period.margin!.startsWith("-") ? "−" : "+"}${escape(margin)}</small>`;
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
        ? `${escape(figure(period.margin!, format))} to spare`
        : `<span class="fail">In breach by ${escape(figure(period.margin!.replace(/^-/, ""), format))}</span>`;
    const amount = escape(figure(cushion.amount.replace(/^-/, ""), "amount"));
    if (!period.pass)
      return `<span class="fail">In breach: ${amount} of ${escape(cushion.line)} ${min ? "short" : "too many"}</span>`;
    return `${cushion.fall !== null ? `${escape(cushion.fallLine)} can fall ${escape(figure(cushion.fall, "percent"))} before a breach. ` : ""}${amount} ${min ? `of ${escape(cushion.line)} to spare` : `more ${escape(cushion.line)} allowed`}.`;
  };
  const rows = covenants.run
    .map((result, i) => {
      const format = asChartFormat(result.format ?? "amount");
      const min = result.covenant.test === "min";
      const what =
        result.label === null
          ? `${escape(result.covenant.metric)} isn't a line of this model`
          : `${escape(result.label)}, ${min ? "at least" : "at most"} ${
              result.covenant.thresholds.length > 1
                ? result.covenant.thresholds
                    .map(
                      (t) =>
                        `${escape(figure(t.value, format))}${t.from === null ? "" : ` from ${t.from}`}`,
                    )
                    .join(", then ")
                : escape(figure(result.covenant.thresholds[0]!.value, format))
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
  return `<h2>Covenants <span class="tag">${covenants.source === "scenario" ? `Proposed for ${escape(data.scenario?.name ?? "the deal")}` : "In force"}</span></h2><table class="figures covenants"><thead><tr><th>Covenant</th>${cols
    .map(
      (c) =>
        `<th class="num${c.post ? " post" : ""}">${escape(data.run.periods[c.p]!.end.slice(0, 4))}<small>${c.post ? "post-project" : data.run.periods[c.p]!.projection ? "projected" : "actual"}</small></th>`,
    )
    .join(
      "",
    )}<th>Room${reference ? `<small>${escape(data.run.periods[reference.p]!.end.slice(0, 4))}${reference.post ? " post-project" : ""}</small>` : ""}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function chartsBlock(
  block: Extract<Block, { type: "charts" }>,
  data: DocumentData,
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
    label: yearly ? years[i]! : date(p.end),
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
      series[0]!.label += " · as is";
      series.push({
        label: `${byCode.get(first)?.label ?? first} · post-project`,
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
    const assumption = chart.threshold
      ? data.run.assumptions[chart.threshold]?.value
      : null;
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
        : chart.threshold && assumption !== null && assumption !== undefined
          ? {
              label: byCode.get(chart.threshold)?.label ?? chart.threshold,
              values: periods.map(() => Number(assumption)),
            }
          : null,
    };
    return `<figure><figcaption>${escape(chart.title)}</figcaption>${legendHtml(input)}${chartSvg(input)}</figure>`;
  });
  return `<h2>Charts</h2><div class="charts">${items.join("")}</div>`;
}

function sourcesUsesBlock(data: DocumentData): string {
  const deal = data.deal;
  if (!deal)
    return `<p class="muted">${escape(data.scenario?.name ?? "The base case")} finances no project.</p>`;
  const totals = projectTotals(deal);
  const off = imbalance(deal);
  const label = (code: string) => data.items[code] ?? code;
  const share = (amount: string, total: string) =>
    Number(total)
      ? `${(Math.round((Number(amount) / Number(total)) * 1000) / 10).toFixed(1)}%`
      : "";
  const source = deal.sources
    .map(
      (s) =>
        `<tr><td>${escape(s.name)}<small>${
          s.kind === "loan"
            ? `New loan · ${escape(rate(s.rate))} · ${escape(describeTerms({ ...s, balance: s.amount }))}`
            : escape(label(s.item))
        }</small></td><td class="num">${escape(figure(s.amount, "amount"))}</td><td class="num">${share(s.amount, totals.sources.toFixed())}</td></tr>`,
    )
    .join("");
  const use = deal.uses
    .map(
      (u) =>
        `<tr><td>${escape(u.name)}<small>${escape(label(u.item))}</small></td><td class="num">${escape(figure(u.amount, "amount"))}</td><td class="num">${share(u.amount, totals.uses.toFixed())}</td></tr>`,
    )
    .join("");
  const side = (title: string, rows: string, total: string) =>
    `<table class="figures"><thead><tr><th>${title}</th><th class="num">Amount</th><th class="num">Share</th></tr></thead><tbody>${rows || `<tr><td colspan="3" class="muted">None</td></tr>`}</tbody><tfoot><tr><td>Total</td><td class="num">${escape(figure(total, "amount"))}</td><td></td></tr></tfoot></table>`;
  const loans = new Map(
    data.debt.flatMap((d) => d.schedule.loans.map((l) => [l.id, l.name])),
  );
  const extras = [
    ...deal.lines.map(
      (l) =>
        `Line of credit increase, ${escape(l.name)}: ${escape(figure(l.increase, "amount"))} at ${escape(rate(l.rate))}, ${escape(rate(l.usage))} used on average.`,
    ),
    ...deal.subordinations.map(
      (s) =>
        `${escape(s.name)}: ${escape(figure(s.amount, "amount"))} postponed in favour of the lender and treated as equity.`,
    ),
    ...(deal.consolidatedLoans ?? []).map(
      (id) =>
        `${escape(loans.get(id) ?? "An existing loan")}: repaid or refinanced at closing.`,
    ),
    ...(deal.adjustments ?? []).map(
      (a) =>
        `${escape(a.name)}: ${escape(figure(a.amount, "amount"))} to ${escape(label(a.item))}${a.side ? "" : " a year"}.`,
    ),
  ];
  return `<p class="muted">Closing ${escape(date(deal.closing))}.</p>${off ? `<p class="fail">${escape(off)}: the post-project balance sheet doesn't balance.</p>` : ""}<div class="pair">${side("Sources", source, totals.sources.toFixed())}${side("Uses", use, totals.uses.toFixed())}</div>${extras.length ? `<ul class="extras">${extras.map((e) => `<li>${e}</li>`).join("")}</ul>` : ""}`;
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

const newLoans = (data: DocumentData) =>
  (data.deal?.sources.filter((s) => s.kind === "loan") ?? []) as ProjectLoan[];

function debtBlock(data: DocumentData): string {
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
      return `<tr><td>${escape(loan.name)}<small>As of ${escape(date(schedule.asOf!))}${repaid ? " · repaid at closing" : ""}</small></td><td class="num">${escape(figure(loan.balance, "amount"))}</td><td class="num">${escape(rate(loan.rate))}</td><td>${escape(describeTerms(loan))}</td><td class="num">${escape(figure(String(service), "amount"))}</td></tr>`;
    })
    .join("");
  const added = newLoans(data);
  const newRows = added
    .map((loan) => {
      const service = Number(
        firstYear({ ...loan, balance: loan.amount }, data.deal!.closing),
      );
      total += service;
      return `<tr><td>${escape(loan.name)}<small>New · from ${escape(date(data.deal!.closing))}</small></td><td class="num">${escape(figure(loan.amount, "amount"))}</td><td class="num">${escape(rate(loan.rate))}</td><td>${escape(describeTerms({ ...loan, balance: loan.amount }))}</td><td class="num">${escape(figure(String(service), "amount"))}</td></tr>`;
    })
    .join("");
  if (!existingRows && !newRows)
    return `<p class="muted">No existing loans are entered, and the scenario adds none.</p>`;
  return `<table class="figures"><thead><tr><th>Loan</th><th class="num">Balance</th><th class="num">Rate</th><th>Terms</th><th class="num">Debt service, first 12 months</th></tr></thead><tbody>${existingRows}${newRows}</tbody><tfoot><tr><td>Total${added.length || consolidated.size ? ", after the deal" : ""}</td><td></td><td></td><td></td><td class="num">${escape(figure(String(total), "amount"))}</td></tr></tfoot></table>`;
}

// A loan year by year from its start, as the app's "By year" view shows it.
function loanYears(loan: Parameters<typeof amortize>[0], start: string) {
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
      months: `${month(first)} to ${month(last)}`,
      interest: sum((p) => p.interest),
      principal: sum((p) => p.principal),
      extra: sum((p) => p.extra),
      balance:
        inYear.at(-1)?.after.toNumber() ?? (y ? 0 : Number(loan.balance)),
    };
  });
}

function amortizationBlock(data: DocumentData): string {
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
      name: `${loan.name} (new)`,
      loan: { ...loan, balance: loan.amount },
      start: data.deal!.closing,
    })),
  ];
  if (!loans.length) return `<p class="muted">No loans to schedule.</p>`;
  return loans
    .map(({ name, loan, start }) => {
      const years = loanYears(loan, start);
      const extra = years.some((y) => y.extra);
      return `<section class="loan"><h3>${escape(name)}</h3><p class="muted">${escape(figure(loan.balance, "amount"))} at ${escape(rate(loan.rate))}, ${escape(describeTerms(loan))}, from ${escape(date(start))}.</p><table class="figures"><thead><tr><th>Year</th><th>Months</th><th class="num">Interest</th><th class="num">Principal</th>${extra ? `<th class="num">Extra</th>` : ""}<th class="num">Balance</th></tr></thead><tbody>${years
        .map(
          (y, i) =>
            `<tr><td>${i + 1}</td><td>${escape(y.months)}</td><td class="num">${money(y.interest)}</td><td class="num">${money(y.principal)}</td>${extra ? `<td class="num">${money(y.extra)}</td>` : ""}<td class="num">${money(y.balance)}</td></tr>`,
        )
        .join("")}</tbody></table></section>`;
    })
    .join("");
}

function block(b: Block, data: DocumentData): string {
  if (!shows(b.when, data)) return "";
  switch (b.type) {
    case "heading":
      return `<h2>${escape(merge(b.text, data))}</h2>`;
    case "text":
      return prose(b.text, data);
    case "facts":
      return factsBlock(data);
    case "lines":
      return linesBlock(b, data);
    case "covenants":
      return covenantsBlock(data);
    case "charts":
      return chartsBlock(b, data);
    case "sourcesUses":
      return sourcesUsesBlock(data);
    case "debt":
      return debtBlock(data);
    case "amortization":
      return amortizationBlock(data);
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
.page-break { break-after: page; }
@media screen { body { max-width: ${orientation === "landscape" ? 1056 : 816}px; margin: 24px auto; padding: 0 24px; } }
`;

export function renderDocument(
  template: Template,
  data: DocumentData,
): RenderedDocument {
  const title = merge(template.title, data);
  const { branding } = data.organization;
  const color = /^#[0-9a-f]{6}$/i.test(branding.color ?? "")
    ? branding.color!
    : DEFAULT_COLOR;
  const { orientation } = template;
  const subtitle = [
    data.analysis.name,
    `${data.model.name} v${data.model.version}`,
    data.scenario?.name ?? "Base case",
    date(data.date),
  ]
    .map(escape)
    .join(" · ");
  const html = `<!doctype html>
<html lang="en">
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
${template.blocks.map((b) => block(b, data)).join("\n")}
</body>
</html>`;
  const notice =
    branding.notice?.trim() || `${data.organization.name} · Confidential`;
  const footer = `<div style="width:100%;font:7pt Arial,sans-serif;color:#64748b;padding:0 14mm;display:flex;justify-content:space-between;"><span>${escape(notice)}</span><span>${escape(title)} · Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
  return { title, html, footer, orientation };
}
