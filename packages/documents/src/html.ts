import {
  amortize,
  monthIndex,
  nextYearDebtService,
  projectTotals,
  type CovenantPeriod,
  type DebtSchedule,
  type ExistingLoan,
  type ProjectLoan,
} from "@finance/domain";
import { chartSvg, legendHtml, type ChartInput } from "./chart";
import type { DocumentData, DocumentRun } from "./data";
import { escape, type Format } from "./format";
import { locale, type Locale } from "./locale";
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
function field(path: string, data: DocumentData, l: Locale): string | null {
  const [head, code, post] = path.split(".");
  if (head === "line" && code) {
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
    "analysis.name": data.analysis.name,
    "model.name": data.model.name,
    "model.version": `v${data.model.version}`,
    "scenario.name": data.scenario?.name ?? l.w.baseCase,
    "organization.name": data.organization.name,
    date: l.date(data.date),
  };
  return fields[path] ?? null;
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

function factsBlock(data: DocumentData, l: Locale): string {
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
    [l.w.analysis, data.analysis.name],
    [l.w.financialModel, `${data.model.name} · v${data.model.version}`],
    [l.w.scenario, data.scenario?.name ?? l.w.baseCase],
    [
      l.w.projections,
      data.analysis.projectionMode === "client"
        ? l.w.clientsOwn
        : l.w.yearsFromAssumptions(data.analysis.projectionYears),
    ],
  ];
  return `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`).join("")}</dl>`;
}

const asChartFormat = (format: string): ChartInput["format"] =>
  format === "percent" || format === "ratio" || format === "count"
    ? format
    : "amount";

function covenantsBlock(data: DocumentData, l: Locale): string {
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
  data: DocumentData,
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

function sourcesUsesBlock(data: DocumentData, l: Locale): string {
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
    ...deal.lines.map((line) =>
      l.w.lineIncrease(
        escape(line.name),
        escape(l.figure(line.increase, "amount")),
        escape(l.rate(line.rate)),
        escape(l.rate(line.usage)),
      ),
    ),
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

function debtBlock(data: DocumentData, l: Locale): string {
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
  if (!existingRows && !newRows) return `<p class="muted">${l.w.noLoans}</p>`;
  return `<table class="figures"><thead><tr><th>${l.w.loan}</th><th class="num">${l.w.balance}</th><th class="num">${l.w.rate}</th><th>${l.w.terms}</th><th class="num">${l.w.firstYearService}</th></tr></thead><tbody>${existingRows}${newRows}</tbody><tfoot><tr><td>${l.w.total}${added.length || consolidated.size ? l.w.afterTheDeal : ""}</td><td></td><td></td><td></td><td class="num">${escape(l.figure(String(total), "amount"))}</td></tr></tfoot></table>`;
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

function amortizationBlock(data: DocumentData, l: Locale): string {
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

function block(b: Block, data: DocumentData, l: Locale): string {
  if (!shows(b.when, data)) return "";
  switch (b.type) {
    case "heading":
      return `<h2>${escape(merge(b.text, data, l))}</h2>`;
    case "text":
      return prose(b.text, data, l);
    case "facts":
      return factsBlock(data, l);
    case "lines":
      return linesBlock(b, data, l);
    case "covenants":
      return covenantsBlock(data, l);
    case "charts":
      return chartsBlock(b, data, l);
    case "sourcesUses":
      return sourcesUsesBlock(data, l);
    case "debt":
      return debtBlock(data, l);
    case "amortization":
      return amortizationBlock(data, l);
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
  const l = locale(template.language);
  const title = merge(template.title, data, l);
  const { branding } = data.organization;
  const color = /^#[0-9a-f]{6}$/i.test(branding.color ?? "")
    ? branding.color!
    : DEFAULT_COLOR;
  const { orientation } = template;
  const subtitle = [
    data.analysis.name,
    `${data.model.name} v${data.model.version}`,
    data.scenario?.name ?? l.w.baseCase,
    l.date(data.date),
  ]
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
