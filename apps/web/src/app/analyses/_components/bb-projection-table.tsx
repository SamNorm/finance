"use client";

import type {
  BorrowingBaseRun,
  LineageRef,
  ProposedLine,
  ResultCell,
  ResultValue,
  WaterfallRow,
} from "@finance/domain";
import {
  TOTALS,
  type BorrowingBaseDefinition,
  type BorrowingBaseFormat,
} from "@finance/domain/borrowing-bases";
import { monthNumber, termIn, type Term } from "@finance/domain/terms";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { badge, button } from "@/components/styles";
import { Modal } from "@/components/ui";
import {
  addMonths,
  describeMonth,
  QUALITY,
  showFigure,
} from "@/lib/borrowing-bases";
import { describeMonths, describeTerm } from "@/lib/credit-lines";

// A margined line's last twelve months of certificates, then its projected
// months (borrowing-base-plan.md §8), as the line's own page lays out its
// history: the waterfall month by month, each line's details folding under
// it, the tests at the foot, and every figure opening its lineage. Projected
// months are shaded; those the deal's terms apply in are marked.

const SOURCES: Partial<Record<LineageRef["source"], string>> = {
  calculation: "Calculation",
  assumption: "Assumption",
  entered: "Entered",
  term: "Terms",
  blank: "Blank",
};

// The deal's terms for a line, as the scenario proposes them.
export interface DealTerms {
  // Its terms apply after this month, "YYYY-MM".
  after: string;
  limit: Term;
  closed: boolean;
  terms: NonNullable<ProposedLine["terms"]>;
}

interface TermAt {
  term: Term | null;
  format: "amount" | "percent";
  // Proposed for the deal, rather than in force: the month it applies
  // from.
  dealFrom: string | null;
}

// A term of the line or its borrowing base by the code the engine reads (an
// advance rate AR.RATE, a cap, a reserve's amount, the limit), in a month:
// the deal's in projected months after its month, else the one in force.
export function termsLookup(
  definition: BorrowingBaseDefinition,
  limit: Term,
  deal: DealTerms | null,
) {
  const inForce = new Map<string, Omit<TermAt, "dealFrom">>([
    ["BB_LIMIT", { term: limit, format: "amount" }],
  ]);
  for (const line of definition.lines) {
    if (line.kind === "collateral") {
      inForce.set(`${line.code}.RATE`, { term: line.rate, format: "percent" });
      inForce.set(`${line.code}.CAP`, {
        term: line.cap ?? null,
        format: "amount",
      });
    }
    if (line.kind === "group")
      inForce.set(`${line.code}.CAP`, {
        term: line.cap ?? null,
        format: "amount",
      });
    if (line.kind === "reserve" && line.amount)
      inForce.set(line.code, { term: line.amount, format: "amount" });
  }
  const dealFrom = deal && addMonths(deal.after, 1);
  return (code: string, month: string, projected: boolean): TermAt | null => {
    const own = inForce.get(code);
    if (!own) return null;
    if (!deal || !projected || month <= deal.after)
      return { ...own, dealFrom: null };
    if (code === "BB_LIMIT")
      return {
        term: deal.closed ? { value: "0" } : deal.limit,
        format: "amount",
        dealFrom,
      };
    const [line, field] = code.includes(".")
      ? (code.split(".") as [string, string])
      : [code, "AMOUNT"];
    const proposed =
      deal.terms[line]?.[field.toLowerCase() as "rate" | "cap" | "amount"];
    return proposed === undefined
      ? { ...own, dealFrom: null }
      : { term: proposed, format: own.format, dealFrom };
  };
}

// Which step or season of a term applied in a month; a deal's term starts
// with the deal.
function applied(term: Term, month: string, dealFrom: string | null) {
  const { from, season } = termIn(term, monthNumber(month));
  return [
    from && (!dealFrom || from > dealFrom)
      ? `from ${describeMonth(from)}`
      : dealFrom
        ? `from ${describeMonth(dealFrom)}, the deal's first month`
        : "from the start",
    ...(season ? [`${describeMonths(season)} season`] : []),
  ].join(" · ");
}

// Scrolls a table so its first projected month shows with the three
// actual months before it, right of the sticky labels.
export function scrollToProjection(scroller: HTMLElement, first: HTMLElement) {
  const left =
    first.getBoundingClientRect().left -
    scroller.getBoundingClientRect().left +
    scroller.scrollLeft;
  const labels =
    scroller.querySelector("thead tr:last-child th")?.getBoundingClientRect()
      .width ?? 0;
  scroller.scrollLeft = Math.max(0, left - labels - 3 * first.offsetWidth);
}

// Each detail row's line: the nearest line above it, less indented, in its
// section.
function parentsOf(rows: readonly WaterfallRow[]) {
  const parents = new Map<string, string>();
  rows.forEach((row, i) => {
    if (row.kind !== "detail") return;
    for (let j = i - 1; j >= 0; j--) {
      const above = rows[j]!;
      if (above.kind === "section") break;
      if (above.kind === "line" && above.depth < row.depth) {
        parents.set(row.code, above.code);
        break;
      }
    }
  });
  return parents;
}

// Surpluses and availability below zero show in red: the line is short.
const SHORT = new Set(["BB_SURPLUS", "BB_EXCESS"]);

export function Figure({
  cell,
  format,
  code,
  entered = false,
  plain = false,
}: {
  cell: ResultValue;
  format: BorrowingBaseFormat;
  code: string;
  entered?: boolean;
  plain?: boolean;
}) {
  if (cell.error)
    return (
      <span
        className="font-mono text-xs text-warning"
        title={cell.error.message}
      >
        {cell.error.code === "#N/A" ? "n/a" : cell.error.code}
      </span>
    );
  if (cell.value === null)
    return <span className="text-muted">{entered ? "" : "–"}</span>;
  const short = !plain && SHORT.has(code) && Number(cell.value) < 0;
  return (
    <span className={short ? "text-danger" : ""}>
      {showFigure(cell.value, format, code)}
    </span>
  );
}

// How a figure in a projected month came about: given by the client or the
// scenario, or estimated from its projection formula.
export type FigureOrigin = "client" | "scenario" | "estimated" | null;

export function ProjectionTable({
  run,
  from,
  deal,
  terms,
  estimated,
  originOf,
  title,
  toolbar,
}: {
  run: BorrowingBaseRun;
  // The first month shown: twelve of history before the projection.
  from: number;
  // The deal's terms, in the run that applies them; null as is.
  deal: DealTerms | null;
  terms: ReturnType<typeof termsLookup>;
  // Entered lines the client's figures leave out in some months.
  estimated: readonly string[];
  // Where an entered line's figure came from in a projected month.
  originOf: (code: string, month: string) => FigureOrigin;
  title: string;
  toolbar?: ReactNode;
}) {
  const [trail, setTrail] = useState<{ code: string; period: number }[]>([]);
  const parents = useMemo(() => parentsOf(run.rows), [run.rows]);
  const foldable = useMemo(() => new Set(parents.values()), [parents]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const firstProjected = useRef<HTMLTableCellElement>(null);
  // The last actual months and the projection in view.
  useLayoutEffect(() => {
    const el = scroller.current;
    const th = firstProjected.current;
    if (el && th) scrollToProjection(el, th);
  }, []);

  const columns = run.months.map((_, p) => p).slice(from);
  const firstAhead = columns.find((p) => run.months[p]!.projected);
  const dealFrom = deal
    ? columns.find(
        (p) => run.months[p]!.projected && run.months[p]!.month > deal.after,
      )
    : undefined;
  // Actual months, projected months, then those under the deal's terms.
  const phase = (p: number) =>
    !run.months[p]!.projected
      ? "Actual"
      : dealFrom !== undefined && p >= dealFrom
        ? "Projected · the deal's terms"
        : "Projected";
  const groups = columns.reduce<{ label: string; count: number }[]>(
    (list, p) => {
      const label = phase(p);
      const last = list.at(-1);
      if (last?.label === label) last.count++;
      else list.push({ label, count: 1 });
      return list;
    },
    [],
  );
  const formats = new Map(run.rows.map((r) => [r.code, r.format]));
  const allOpen = open.size === foldable.size && foldable.size > 0;
  const toggleLine = (code: string) =>
    setOpen((set) => {
      const next = new Set(set);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  const shown = run.rows.filter((row) => {
    const parent = parents.get(row.code);
    return !parent || open.has(parent);
  });
  const shade = (p: number) =>
    run.months[p]!.projected
      ? "bg-accent-soft/40"
      : run.months[p]!.quality
        ? ""
        : "bg-surface-2/50";
  const edge = (p: number) =>
    p === dealFrom || (p === firstAhead && dealFrom === undefined)
      ? "border-l-2 border-l-accent/60"
      : p === firstAhead
        ? "border-l-2 border-l-line-strong"
        : "border-l border-line/60";
  const failedAhead = (id: string) =>
    run.tests
      .find((t) => t.id === id)!
      .months.filter((m, p) => run.months[p]!.projected && m.pass === false)
      .length;

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted">
          The last 12 months of certificates, then the projection, shaded. Click
          a figure to see how it was computed.
        </p>
        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          {foldable.size > 0 && (
            <button
              type="button"
              className={`${button.ghost} px-2 py-1 text-xs`}
              onClick={() => setOpen(allOpen ? new Set() : new Set(foldable))}
            >
              {allOpen ? "Hide details" : "Show details"}
            </button>
          )}
        </div>
      </div>
      <div ref={scroller} className="max-h-[min(78vh,64rem)] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-xs">
              <th className="sticky top-0 left-0 z-30 h-7 border-b border-line bg-surface" />
              {groups.map((g, i) => (
                <th
                  key={`${g.label}:${i}`}
                  colSpan={g.count}
                  className={`sticky top-0 z-10 h-7 border-b border-l border-line px-2.5 text-left font-medium whitespace-nowrap ${g.label === "Actual" ? "bg-surface text-muted" : "bg-accent-soft text-accent"}`}
                >
                  {g.label === "Actual"
                    ? `Actual · ${g.count === 1 ? "1 month" : `last ${g.count} months`}`
                    : g.label}
                </th>
              ))}
              <th className="sticky top-0 border-b border-line bg-surface" />
            </tr>
            <tr className="text-xs text-muted">
              <th className="sticky top-7 left-0 z-30 w-48 max-w-48 min-w-48 border-b border-line bg-surface px-4 py-2 text-left font-medium sm:w-80 sm:max-w-80 sm:min-w-80">
                Line
              </th>
              {columns.map((p) => {
                const m = run.months[p]!;
                return (
                  <th
                    key={m.month}
                    ref={p === firstAhead ? firstProjected : undefined}
                    className={`sticky top-7 z-10 w-28 min-w-28 border-b border-line bg-surface px-2.5 py-1.5 text-right align-top font-normal ${edge(p)}`}
                  >
                    <span className="block font-medium whitespace-nowrap text-foreground">
                      {describeMonth(m.month)}
                    </span>
                    <span className={m.quality || m.projected ? "" : "italic"}>
                      {m.projected
                        ? "Projected"
                        : m.quality
                          ? QUALITY[m.quality]
                          : "No certificate"}
                    </span>
                  </th>
                );
              })}
              <th className="sticky top-7 w-full border-b border-line bg-surface" />
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              if (row.kind === "section")
                return (
                  <tr key={row.code}>
                    <td className="sticky left-0 z-20 border-b border-line/60 bg-surface px-4 pt-4 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                      {row.label}
                    </td>
                    <td
                      colSpan={columns.length + 1}
                      className="border-b border-line/60"
                    />
                  </tr>
                );
              const group = row.kind === "line" && row.lineKind === "group";
              const strong = row.kind === "subtotal" || row.kind === "total";
              const band =
                row.kind === "total"
                  ? "bg-surface-2 font-semibold"
                  : row.kind === "subtotal"
                    ? "bg-surface-2/60 font-medium"
                    : "";
              const sticky = strong ? "bg-surface-2" : "bg-surface";
              const canFold = foldable.has(row.code);
              const isOpen = open.has(row.code);
              const isEstimated = estimated.includes(row.code);
              return (
                <tr key={row.code} className={band}>
                  <td
                    title={row.help ? `${row.code} · ${row.help}` : row.code}
                    style={{ paddingLeft: 12 + row.depth * 16 }}
                    className={`sticky left-0 z-20 max-w-48 border-b border-line/60 py-1 pr-3 sm:max-w-80 ${sticky} ${row.kind === "detail" ? "text-muted" : ""} ${group ? "font-medium" : ""}`}
                  >
                    <span className="flex min-w-0 items-center gap-1">
                      {canFold ? (
                        <button
                          type="button"
                          onClick={() => toggleLine(row.code)}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Hide" : "Show"} ${row.label}'s details`}
                          className="-ml-1 rounded text-muted hover:bg-surface-2 hover:text-foreground"
                        >
                          {isOpen ? (
                            <ChevronDown className="size-3.5" aria-hidden />
                          ) : (
                            <ChevronRight className="size-3.5" aria-hidden />
                          )}
                        </button>
                      ) : (
                        <span className="w-3.5 shrink-0" />
                      )}
                      <span className="truncate">{row.label}</span>
                      {row.currency && (
                        <span className="rounded bg-surface-2 px-1 text-[11px] font-normal text-muted">
                          {row.currency}
                        </span>
                      )}
                      {isEstimated && (
                        <span
                          className={badge("warning")}
                          title="The client's figures leave out some projected months: those come from the line's projection formula, in italics."
                        >
                          Estimated
                        </span>
                      )}
                    </span>
                  </td>
                  {columns.map((p) => {
                    const m = run.months[p]!;
                    const cell = run.cells[row.code]?.[p];
                    const origin =
                      m.projected && row.entered
                        ? originOf(row.code, m.month)
                        : null;
                    return (
                      <td
                        key={m.month}
                        className={`border-b border-line/60 p-0 text-right tabular-nums ${edge(p)} ${shade(p)}`}
                      >
                        {group || !cell ? null : (
                          <button
                            type="button"
                            onClick={() =>
                              setTrail([{ code: row.code, period: p }])
                            }
                            className={`block w-full px-2.5 py-1 text-right whitespace-nowrap hover:bg-accent-soft/60 ${origin === "estimated" ? "text-muted italic" : origin === "scenario" ? "font-medium text-accent" : ""}`}
                            title={
                              origin === "estimated"
                                ? "Estimated from the projection formula: the client's figures leave this month out"
                                : origin === "scenario"
                                  ? "The scenario's figure"
                                  : origin === "client"
                                    ? "The client's projected figure"
                                    : "Show how this was computed"
                            }
                          >
                            <Figure
                              cell={cell}
                              format={row.format}
                              code={row.code}
                              entered={row.entered}
                            />
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="border-b border-line/60" />
                </tr>
              );
            })}
            {run.tests.length > 0 && (
              <tr>
                <td className="sticky left-0 z-20 border-b border-line/60 bg-surface px-4 pt-4 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                  Tests
                </td>
                <td
                  colSpan={columns.length + 1}
                  className="border-b border-line/60"
                />
              </tr>
            )}
            {run.tests.map((test) => {
              const failed = failedAhead(test.id);
              return (
                <tr key={test.id}>
                  <td
                    title={test.metric}
                    className="sticky left-0 z-20 max-w-48 border-b border-line/60 bg-surface py-1 pr-3 pl-[30px] sm:max-w-80"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{test.name}</span>
                      {failed > 0 && (
                        <span
                          className={badge("danger")}
                          title="Projected months failed"
                        >
                          {failed} projected
                        </span>
                      )}
                    </span>
                  </td>
                  {columns.map((p) => {
                    const result = test.months[p];
                    const format = formats.get(test.metric) ?? "amount";
                    return (
                      <td
                        key={run.months[p]!.month}
                        title={
                          result?.threshold
                            ? `${test.test === "min" ? "At least" : "At most"} ${showFigure(result.threshold, format, test.metric)}${result.margin ? ` · room ${showFigure(result.margin, format, test.metric)}` : ""}`
                            : undefined
                        }
                        className={`border-b border-line/60 px-2.5 py-1 text-right text-xs ${edge(p)} ${shade(p)}`}
                      >
                        {result?.pass === true && (
                          <span className="text-success">Pass</span>
                        )}
                        {result?.pass === false && (
                          <span className={badge("danger")}>Fail</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="border-b border-line/60" />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Lineage
        trail={trail}
        onTrail={setTrail}
        run={run}
        terms={terms}
        originOf={originOf}
      />
    </section>
  );
}

function Lineage({
  trail,
  onTrail,
  run,
  terms,
  originOf,
}: {
  trail: { code: string; period: number }[];
  onTrail: (trail: { code: string; period: number }[]) => void;
  run: BorrowingBaseRun;
  terms: ReturnType<typeof termsLookup>;
  originOf: (code: string, month: string) => FigureOrigin;
}) {
  const current = trail.at(-1);
  const rows = new Map(run.rows.map((r) => [r.code, r]));
  const labelOf = (code: string, fallback?: string) =>
    rows.get(code)?.label ?? fallback ?? code;
  const formatOf = (code: string): BorrowingBaseFormat =>
    rows.get(code)?.format ??
    TOTALS.find((t) => t.code === code)?.format ??
    (code.endsWith(".RATE") ? "percent" : "amount");
  const cell: ResultCell | undefined = current
    ? run.cells[current.code]?.[current.period]
    : undefined;
  const month = current ? run.months[current.period] : undefined;
  const term =
    current && month ? terms(current.code, month.month, month.projected) : null;
  const row = current ? rows.get(current.code) : undefined;
  const origin =
    current && month?.projected && row?.entered
      ? originOf(current.code, month.month)
      : null;

  return (
    <Modal
      side
      open={trail.length > 0}
      onClose={() => onTrail([])}
      title="How this was computed"
    >
      {current && cell && month && (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          {trail.length > 1 && (
            <button
              type="button"
              className={`${button.ghost} self-start`}
              onClick={() => onTrail(trail.slice(0, -1))}
            >
              ← Back
            </button>
          )}
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted">
              {describeMonth(month.month)} ·{" "}
              {month.projected
                ? "Projected"
                : month.quality
                  ? QUALITY[month.quality]
                  : "No certificate"}
            </p>
            <p className="text-lg font-semibold">{labelOf(current.code)}</p>
            <p className="font-mono text-xs text-muted">{current.code}</p>
            <p className="text-2xl tabular-nums">
              <Figure
                cell={cell}
                format={formatOf(current.code)}
                code={current.code}
                plain
              />
            </p>
            {cell.error && (
              <p className="text-sm text-warning">{cell.error.message}</p>
            )}
            {row?.help && <p className="text-sm text-muted">{row.help}</p>}
          </div>
          {term ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted">
                {term.dealFrom ? "Proposed for the deal" : "From the terms"}
              </p>
              <p className="rounded-md bg-surface-2 px-3 py-2 text-sm tabular-nums">
                {term.term ? describeTerm(term.term, term.format) : "None"}
              </p>
              {term.term && (
                <p className="text-xs text-muted">
                  {term.dealFrom ? "Applies" : "In force"}{" "}
                  {applied(term.term, month.month, term.dealFrom)}.
                </p>
              )}
            </div>
          ) : origin === "client" || origin === "scenario" ? (
            <p className="text-sm text-muted">
              {origin === "client"
                ? "The client's projected figure, entered in the analysis."
                : "The scenario's figure for this month."}
            </p>
          ) : cell.formula ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted">
                {month.projected && row?.entered
                  ? origin === "estimated"
                    ? "Estimated: the client's figures leave this month out, so its projection formula"
                    : "Projection formula"
                  : "Formula"}
              </p>
              <code className="rounded-md bg-surface-2 px-3 py-2 font-mono text-xs break-words">
                {cell.formula}
              </code>
            </div>
          ) : row?.entered ? (
            <p className="text-sm text-muted">
              {cell.value === null
                ? "Not entered for this month."
                : "Entered from the client's certificate."}
            </p>
          ) : null}
          {cell.refs.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted">Reads</p>
              <ul className="divide-y divide-line rounded-md border border-line">
                {cell.refs.map((ref, i) => {
                  const refMonth = run.months[ref.period];
                  const refTerm = refMonth
                    ? terms(ref.code, refMonth.month, refMonth.projected)
                    : null;
                  const drillable =
                    (ref.source === "calculation" ||
                      ref.source === "term" ||
                      ref.source === "entered") &&
                    run.cells[ref.code]?.[ref.period];
                  const content = (
                    <>
                      <span className="flex min-w-0 flex-col items-start">
                        <span className="truncate">
                          {labelOf(ref.code, ref.label)}
                        </span>
                        <span className="text-xs text-muted">
                          <span className="font-mono">{ref.code}</span>
                          {refMonth && ref.period !== current.period
                            ? ` · ${describeMonth(refMonth.month)}`
                            : ""}{" "}
                          ·{" "}
                          {refTerm?.dealFrom
                            ? "The deal's terms"
                            : (SOURCES[ref.source] ?? ref.source)}
                          {refTerm?.term && refMonth
                            ? `, ${applied(refTerm.term, refMonth.month, refTerm.dealFrom)}`
                            : ""}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        <Figure
                          cell={ref}
                          format={formatOf(ref.code)}
                          code={ref.code}
                          plain
                        />
                      </span>
                    </>
                  );
                  return (
                    <li key={i}>
                      {drillable ? (
                        <button
                          type="button"
                          onClick={() =>
                            onTrail([
                              ...trail,
                              { code: ref.code, period: ref.period },
                            ])
                          }
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent-soft/60"
                        >
                          {content}
                        </button>
                      ) : (
                        <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          {content}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
