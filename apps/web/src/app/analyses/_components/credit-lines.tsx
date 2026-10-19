"use client";

import type {
  ExchangeRates,
  LineUsage,
  ProposedLine,
  Term,
} from "@finance/domain";
import type { BorrowingBaseDefinition } from "@finance/domain/borrowing-bases";
import { monthIndex, monthOf } from "@finance/domain/amortization";
import { Dec } from "@finance/engine";
import { ChevronDown, Pencil, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge, Card } from "@/components/page";
import { button, input } from "@/components/styles";
import { TermChanges } from "@/components/term-editor";
import { Icon } from "@/components/ui";
import {
  BLANK_TERM,
  describeMonth,
  describeTerm,
  draftTerm,
  lineDraft,
  lineInput,
  MONTHS,
  termIn,
  typedRate,
  typedShare,
  usageDrafts,
  usageInput,
  type LineDraft,
  type UsageDraft,
} from "@/lib/credit-lines";
import { formatDate, formatFigure } from "@/lib/format";
import { updateAnalysisAction } from "../actions";
import {
  DealTermsEditor,
  dealTermsDraft,
  dealTermsInput,
  definitionAsTyped,
  describeDealTerms,
  type DealTermsDraft,
} from "./proposed-terms";

// Lines of credit in an analysis (borrowing-base-plan.md §4.3, §4.4): the
// usage assumed for each line, a share of its limit with any month
// overridden by an amount drawn, which its interest comes from; and a
// scenario's proposed lines for its deal. Months count only inside the
// windows the run reads: projected periods, and the twelve months after a
// project's closing. Lines in another currency than the analysis's count at
// its exchange rates, which a scenario can change.

// A line in force, as the analysis reads it: the borrower's, or a
// consolidated client's member's.
export interface LineInForce {
  id: string;
  name: string;
  currency: string;
  limit: Term;
  rate: string;
  closedOn: string | null;
}

// What the analysis tells the editors about its lines.
export interface LinesSetup {
  inForce: LineInForce[];
  // The base case's usage, which a scenario's replaces line by line and
  // month by month.
  analysisUsage: LineUsage;
  // The months projected periods cover, "2025-01".
  projectedMonths: string[];
  // The month the latest actual period ends in: with no project, proposed
  // lines apply after it.
  lastActual: string | null;
  // Lines the shown run counts with no usage assumed, as saved.
  withoutUsage: { id: string; name: string }[];
  // The analysis's currency, its statements', which lines in another
  // convert into; the base case's rates; and the lines the shown run counts
  // with no rate, as saved.
  currency: string;
  analysisRates: ExchangeRates;
  withoutRate: { id: string; name: string; currency: string }[];
  // Where lines are entered: the borrower's Existing debt tab.
  borrowerHref: string;
  // The borrowing bases of margined lines in force, by line id, whose terms
  // a deal can change.
  margined?: Record<string, BorrowingBaseDefinition>;
}

// A line as the usage grid shows it.
interface UsageRow {
  id: string;
  name: string;
  currency: string;
  rate: string;
  // The limit, as it stands at the deal when a scenario changes it.
  limit: Term;
  badge?: string;
  // Whether a month's usage counts for the line.
  counts: (month: number) => boolean;
  // Its limit in a month.
  limitIn: (month: number) => string;
}

// "Operating line and USD line": names in a sentence.
const listed = (names: string[]) =>
  names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

function WithoutUsage({ lines }: { lines: { name: string }[] }) {
  if (!lines.length) return null;
  return (
    <p className="flex items-start gap-2 text-sm text-warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      No usage assumed for {listed(lines.map((l) => l.name))}:{" "}
      {lines.length === 1 ? "its" : "their"} interest counts as zero.
    </p>
  );
}

function WithoutRate({
  lines,
  currency,
}: {
  lines: { name: string; currency: string }[];
  currency: string;
}) {
  if (!lines.length) return null;
  const currencies = [...new Set(lines.map((l) => l.currency))];
  return (
    <p className="flex items-start gap-2 text-sm text-warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      No exchange rate for {listed(currencies)}:{" "}
      {listed(lines.map((l) => l.name))}{" "}
      {lines.length === 1 ? "counts" : "count"} nothing in {currency}.
    </p>
  );
}

// A rate as typed, "1.37" or "1,37"; null when blank or not above zero.
function typedNumber(raw: string): number | null {
  const text = raw.replace(/\s/g, "").replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Exchange rates as the domain reads them: those entered.
export const ratesInput = (drafts: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(drafts)
      .map(([code, rate]) => [code, rate.trim()] as const)
      .filter(([, rate]) => rate),
  );

// The other currencies lines count in, which need a rate.
const foreign = (rows: readonly { currency: string }[], currency: string) =>
  [...new Set(rows.map((r) => r.currency))]
    .filter((c) => c !== currency && /^[A-Z]{3}$/.test(c))
    .sort();

// A rate per currency other than the analysis's. In a scenario,
// `inherited` is the analysis's, which applies where the scenario's is
// blank.
function ExchangeRateFields({
  currencies,
  currency,
  drafts,
  inherited,
  onChange,
}: {
  currencies: string[];
  currency: string;
  drafts: Record<string, string>;
  inherited?: ExchangeRates;
  onChange: (drafts: Record<string, string>) => void;
}) {
  if (!currencies.length) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line/70 bg-surface-2/30 px-3 py-2.5">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">Exchange rates</p>
        <p className="text-xs text-muted">
          Lines in another currency count in {currency} at{" "}
          {inherited ? "the scenario's rate, or else the analysis's" : "these"}:
          their interest, limit and average usage. Their usage below stays in
          their own currency.
        </p>
      </div>
      {currencies.map((code) => {
        const value = drafts[code] ?? "";
        const applied =
          typedNumber(value) ??
          (inherited?.[code] ? Number(inherited[code]) : null);
        return (
          <label
            key={code}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
          >
            <span className="text-muted">
              {currency} for one {code}
            </span>
            <input
              aria-label={`${code} rate`}
              value={value}
              placeholder={inherited?.[code] ?? "None"}
              inputMode="decimal"
              onChange={(e) => onChange({ ...drafts, [code]: e.target.value })}
              className={`${box.replace("border-line bg-surface", tone(value))} w-24 text-right tabular-nums`}
            />
            <span className="text-xs text-muted tabular-nums">
              {applied
                ? `${code} 100,000 = ${currency} ${formatFigure((100000 * applied).toFixed(0), "amount")}`
                : `No rate: lines in ${code} count nothing`}
            </span>
          </label>
        );
      })}
    </div>
  );
}

// The calendar years a set of months spans, in order.
const yearsOf = (months: readonly number[]) =>
  [...new Set(months.map((m) => Math.floor(m / 12)))].sort((a, b) => a - b);

// The input style without its full width, so fields keep their own.
const box = input.replace("w-full ", "");
// A month's input: compact, so a year fits on a row.
const cell =
  "w-full min-w-[5.5rem] rounded border px-1.5 py-1 text-right text-xs tabular-nums outline-none placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20";
// A value entered stands out from the figure shown when blank. Its colors
// replace the field's rather than add to them, so they don't compete.
const tone = (value: string) =>
  value.trim()
    ? "border-accent/50 bg-accent-soft/40"
    : "border-line bg-surface";

// Each line's average usage and its months, a row per calendar year. In a
// scenario, `inherited` is the analysis's usage, which applies where the
// scenario's is blank.
function UsageGrid({
  rows,
  months,
  drafts,
  inherited,
  onChange,
}: {
  rows: UsageRow[];
  // The months that count, by monthIndex.
  months: number[];
  drafts: Record<string, UsageDraft>;
  inherited?: LineUsage;
  onChange: (drafts: Record<string, UsageDraft>) => void;
}) {
  const years = yearsOf(months);
  const set = (id: string, patch: Partial<UsageDraft>) =>
    onChange({
      ...drafts,
      [id]: { ...(drafts[id] ?? { share: "", months: {} }), ...patch },
    });
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row) => {
        const draft = drafts[row.id];
        const base = inherited?.[row.id];
        const share = draft?.share ?? "";
        const applied =
          typedShare(share) ?? (base?.share ? Number(base.share) : null);
        // What a month left blank comes to: the analysis's amount, or the
        // share of that month's limit.
        const blank = (month: number) => {
          const own = base?.months?.[monthOf(month)];
          if (own !== undefined)
            return {
              value: formatFigure(own, "amount"),
              title: "The analysis's amount",
            };
          if (applied === null) return { value: "", title: "No usage" };
          const limit = row.limitIn(month);
          return {
            value: formatFigure(
              new Dec(limit).times(applied).toFixed(0),
              "amount",
            ),
            title: `${typedRate(String(applied))} of ${formatFigure(limit, "amount")}`,
          };
        };
        return (
          <div
            key={row.id}
            className="flex flex-col gap-2 border-b border-line/70 pb-4 last:border-b-0 last:pb-0"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-medium">{row.name}</span>
              {row.badge && <Badge tone="accent">{row.badge}</Badge>}
              <span className="text-xs text-muted tabular-nums">
                {row.currency} · {formatFigure(row.rate, "percent")} · limit{" "}
                {describeTerm(row.limit)}
              </span>
              <label className="ml-auto flex items-center gap-2 text-xs text-muted">
                Average usage
                <input
                  aria-label={`${row.name}, average usage`}
                  value={share}
                  placeholder={
                    base?.share !== undefined ? typedRate(base.share) : "None"
                  }
                  onChange={(e) => set(row.id, { share: e.target.value })}
                  className={`${box.replace("border-line bg-surface", tone(share))} w-24 text-right tabular-nums`}
                />
                <span>of the limit</span>
              </label>
            </div>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full border-separate border-spacing-x-1 border-spacing-y-0.5">
                <thead>
                  <tr className="text-xs text-muted">
                    <th className="sticky left-0 z-10 w-12 bg-surface text-left font-medium">
                      <span className="sr-only">Year</span>
                    </th>
                    {MONTHS.map((m) => (
                      <th key={m} className="text-right font-medium">
                        {m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {years.map((year) => (
                    <tr key={year}>
                      <th className="sticky left-0 z-10 bg-surface pr-1 text-left text-xs font-medium text-muted tabular-nums">
                        {year}
                      </th>
                      {MONTHS.map((name, i) => {
                        const month = year * 12 + i;
                        const key = monthOf(month);
                        const value = draft?.months[key] ?? "";
                        if (!row.counts(month))
                          return (
                            <td key={name}>
                              <div
                                title="Doesn't count: outside the projected months, or the line isn't open"
                                className="h-[26px] rounded bg-surface-2/60 px-1.5 py-1 text-right text-xs text-muted/70 tabular-nums"
                              >
                                {value}
                              </div>
                            </td>
                          );
                        const hint = blank(month);
                        return (
                          <td key={name}>
                            <input
                              aria-label={`${row.name}, ${describeMonth(key)}`}
                              title={value.trim() ? undefined : hint.title}
                              value={value}
                              placeholder={hint.value}
                              inputMode="decimal"
                              onChange={(e) =>
                                set(row.id, {
                                  months: {
                                    ...draft?.months,
                                    [key]: e.target.value,
                                  },
                                })
                              }
                              className={`${cell} ${tone(value)}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// The months, by monthIndex, from "2025-01" strings, with the twelve after
// a closing when there's one.
function countedMonths(projected: readonly string[], closing: number | null) {
  const months = new Set(projected.map((m) => monthIndex(`${m}-01`)));
  if (closing !== null)
    for (let m = closing + 1; m <= closing + 12; m++) months.add(m);
  return [...months].sort((a, b) => a - b);
}

// Whether a line in force is open in a month: up to the month it closed.
const openIn = (line: LineInForce, month: number) =>
  !line.closedOn || month <= monthIndex(line.closedOn);

// The base case's usage of the lines in force, saved on its own.
export function BaseCaseLines({
  analysisId,
  setup,
}: {
  analysisId: string;
  setup: LinesSetup;
}) {
  const saved = () => usageDrafts(setup.analysisUsage);
  const [drafts, setDrafts] = useState(saved);
  const [rates, setRates] = useState(() => ({ ...setup.analysisRates }));
  // Once saved, or changed elsewhere such as from MCP, show the usage and
  // rates as the server keeps them.
  const serialized = JSON.stringify([setup.analysisUsage, setup.analysisRates]);
  const [synced, setSynced] = useState(serialized);
  if (synced !== serialized) {
    setSynced(serialized);
    setDrafts(saved());
    setRates({ ...setup.analysisRates });
  }
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const ids = new Set(setup.inForce.map((l) => l.id));
  const dirty =
    JSON.stringify(usageInput(drafts, ids)) !==
      JSON.stringify(usageInput(saved(), ids)) ||
    JSON.stringify(ratesInput(rates)) !==
      JSON.stringify(ratesInput(setup.analysisRates));
  const months = countedMonths(setup.projectedMonths, null);
  const rows: UsageRow[] = setup.inForce
    .filter((line) => months.some((m) => openIn(line, m)))
    .map((line) => ({
      ...line,
      counts: (m) => months.includes(m) && openIn(line, m),
      limitIn: (m) => termIn(line.limit, m),
    }));

  function save() {
    setFeedback(null);
    startTransition(async () => {
      const result = await updateAnalysisAction(analysisId, {
        lineUsage: usageInput(drafts, ids),
        exchangeRates: ratesInput(rates),
      });
      startTransition(() =>
        setFeedback(
          result.ok
            ? { ok: true, message: "Saved. Results and charts are updated." }
            : { ok: false, message: result.message },
        ),
      );
    });
  }

  return (
    <Card
      title="Lines of credit"
      description={`The usage assumed for each line, a share of its limit, which its interest in projected years comes from. A month's amount replaces the share that month. Scenarios can assume their own. The analysis counts in ${setup.currency}, its statements' currency.`}
    >
      {!setup.inForce.length ? (
        <NoLines href={setup.borrowerHref} />
      ) : !rows.length ? (
        <p className="text-sm text-muted">
          No month counts: the analysis has no projected years, and line
          interest counts only in those and after a project&apos;s closing.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <WithoutUsage lines={setup.withoutUsage} />
          <WithoutRate lines={setup.withoutRate} currency={setup.currency} />
          <ExchangeRateFields
            currencies={foreign(rows, setup.currency)}
            currency={setup.currency}
            drafts={rates}
            onChange={setRates}
          />
          <UsageGrid
            rows={rows}
            months={months}
            drafts={drafts}
            onChange={setDrafts}
          />
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <button
              type="button"
              className={button.primary}
              onClick={save}
              disabled={pending || !dirty}
            >
              {pending ? "Saving…" : "Save"}
            </button>
            {feedback ? (
              <span
                className={`text-sm ${feedback.ok ? "text-success" : "text-danger"}`}
              >
                {feedback.message}
              </span>
            ) : (
              dirty && (
                <span className="flex items-center gap-2 text-sm text-muted">
                  <span className="size-2 rounded-full bg-warning" />
                  Unsaved changes
                </span>
              )
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function NoLines({ href }: { href: string }) {
  return (
    <p className="text-sm text-muted">
      The borrower has no lines of credit in force. Add them on its{" "}
      <Link href={href} className="text-accent hover:underline">
        Existing debt
      </Link>{" "}
      tab.
    </p>
  );
}

// The lines a scenario proposes for its deal, and the usage it assumes, as
// the scenario editor holds them until "Save scenario".
export interface ScenarioLinesDraft {
  // Null keeps the lines in force.
  proposed: LineDraft[] | null;
  usage: Record<string, UsageDraft>;
  // The borrowing base terms the deal changes, by line id.
  terms: Record<string, DealTermsDraft>;
  // New margined lines' borrowing bases, by line id, kept as saved.
  definitions: Record<string, BorrowingBaseDefinition>;
  // Exchange rates over the analysis's, by currency.
  rates: Record<string, string>;
}

export const scenarioLinesDraft = (
  lines: ProposedLine[] | null,
  usage: LineUsage,
  rates: ExchangeRates,
): ScenarioLinesDraft => ({
  proposed: lines && lines.map(lineDraft),
  usage: usageDrafts(usage),
  rates: { ...rates },
  terms: Object.fromEntries(
    (lines ?? []).map((l) => [l.id, dealTermsDraft(l.terms)]),
  ),
  definitions: Object.fromEntries(
    (lines ?? []).flatMap((l) =>
      l.borrowingBase ? [[l.id, l.borrowingBase]] : [],
    ),
  ),
});

// The proposed lines as the domain reads them, with their borrowing base
// terms; a line closed at the deal changes none.
export const proposedLinesInput = (draft: ScenarioLinesDraft) =>
  draft.proposed &&
  draft.proposed.map((line) => {
    const terms = line.closed ? {} : dealTermsInput(draft.terms[line.id] ?? {});
    const definition = draft.definitions[line.id];
    return {
      ...lineInput(line),
      ...(Object.keys(terms).length ? { terms } : {}),
      ...(definition ? { borrowingBase: definitionAsTyped(definition) } : {}),
    };
  });

// The lines a scenario can assume usage for: those in force, and the new
// lines it proposes.
export const scenarioLineIds = (
  setup: LinesSetup,
  proposed: readonly { id: string }[] | null,
) =>
  new Set([
    ...setup.inForce.map((l) => l.id),
    ...(proposed ?? []).map((l) => l.id),
  ]);

// Whether a proposed line, as typed, changes the line in force.
const differs = (draft: LineDraft, line: LineInForce) =>
  draft.name !== line.name ||
  draft.currency !== line.currency ||
  describeTerm(draftTerm(draft.limit)) !== describeTerm(line.limit) ||
  Math.abs((typedShare(draft.rate) ?? 0) - Number(line.rate)) > 1e-9;

// The lines in force a deal starts from: those still open.
const copyInForce = (setup: LinesSetup): LineDraft[] =>
  setup.inForce.filter((l) => !l.closedOn).map(lineDraft);

export function ScenarioLines({
  setup,
  draft,
  closing,
  scenarioName,
  onChange,
}: {
  setup: LinesSetup;
  draft: ScenarioLinesDraft;
  // The project's closing, as being edited; null without a project.
  closing: string | null;
  scenarioName: string;
  onChange: (draft: ScenarioLinesDraft) => void;
}) {
  const { proposed } = draft;
  const closingMonth = closing ? monthIndex(closing) : null;
  // Proposed lines apply after this month: closing, or with no project the
  // latest actual period's.
  const after =
    closingMonth ??
    (setup.lastActual ? monthIndex(`${setup.lastActual}-01`) : null);
  const months = countedMonths(setup.projectedMonths, closingMonth);
  const byId = new Map((proposed ?? []).map((l) => [l.id, l]));
  const inForceIds = new Set(setup.inForce.map((l) => l.id));
  const deal = (m: number) => proposed !== null && after !== null && m > after;
  const rows: UsageRow[] = [
    ...setup.inForce.map((line): UsageRow => {
      const change = byId.get(line.id);
      const term = change && draftTerm(change.limit);
      return {
        ...line,
        ...(change && !change.closed
          ? {
              name: change.name || line.name,
              currency: change.currency,
              rate: change.rate.trim()
                ? String(typedShare(change.rate) ?? line.rate)
                : line.rate,
              limit: term!,
            }
          : {}),
        badge: change?.closed
          ? "Closed at the deal"
          : change &&
              (differs(change, line) ||
                Object.keys(dealTermsInput(draft.terms[line.id] ?? {})).length >
                  0)
            ? "Changed at the deal"
            : undefined,
        counts: (m) =>
          months.includes(m) && openIn(line, m) && !(change?.closed && deal(m)),
        limitIn: (m) => termIn(term && deal(m) ? term : line.limit, m),
      };
    }),
    ...(proposed ?? [])
      .filter((line) => !inForceIds.has(line.id) && !line.closed)
      .map((line): UsageRow => {
        const term = draftTerm(line.limit);
        return {
          id: line.id,
          name: line.name || "New line",
          currency: line.currency,
          rate: String(typedShare(line.rate) ?? 0),
          limit: term,
          badge: "New",
          counts: (m) => months.includes(m) && deal(m),
          limitIn: (m) => termIn(term, m),
        };
      }),
  ].filter((row) => months.some(row.counts));
  const setProposed = (next: LineDraft[] | null) =>
    onChange({ ...draft, proposed: next });
  const update = (key: string, patch: Partial<LineDraft>) =>
    setProposed(
      (proposed ?? []).map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  const unlisted = setup.inForce.filter((l) => !l.closedOn && !byId.has(l.id));
  const when = closing
    ? `With the project, proposed lines apply from closing on ${formatDate(closing)}: in post-project columns, and projected years after it. The scenario as is keeps the lines in force.`
    : after !== null
      ? `With no project, proposed lines apply from the first projected month, ${describeMonth(monthOf(after + 1))}.`
      : "";

  return (
    <Card
      title="Lines of credit"
      description={`${proposed ? "Proposed for this deal." : "This scenario keeps the lines in force. A deal can propose its own: a new limit or rate, a new line, or a line closed."} ${when}`}
      actions={
        proposed ? (
          <button
            type="button"
            className={button.ghost}
            onClick={() => setProposed(null)}
          >
            Keep the lines in force
          </button>
        ) : (
          <button
            type="button"
            className={button.secondary}
            onClick={() => setProposed(copyInForce(setup))}
          >
            <Pencil />
            Propose lines
          </button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {proposed ? (
          <div className="flex flex-col gap-3">
            {proposed.map((line) => (
              <ProposedLineFields
                key={line.key}
                line={line}
                was={setup.inForce.find((l) => l.id === line.id) ?? null}
                margined={setup.margined?.[line.id] ?? null}
                newMargined={draft.definitions[line.id] ?? null}
                terms={draft.terms[line.id] ?? {}}
                onTerms={(terms) =>
                  onChange({
                    ...draft,
                    terms: { ...draft.terms, [line.id]: terms },
                  })
                }
                onChange={(patch) => update(line.key, patch)}
                onRemove={() =>
                  setProposed(proposed.filter((l) => l.key !== line.key))
                }
              />
            ))}
            {unlisted.length > 0 && (
              <p className="text-xs text-muted">
                Not listed, so as in force:{" "}
                {listed(unlisted.map((l) => l.name))}.
              </p>
            )}
            <div>
              <button
                type="button"
                className={button.secondary}
                onClick={() => {
                  const id = crypto.randomUUID();
                  setProposed([
                    ...proposed,
                    {
                      key: id,
                      id,
                      name: "",
                      currency: "CAD",
                      limit: BLANK_TERM,
                      rate: "",
                      closed: false,
                    },
                  ]);
                }}
              >
                <Icon name="plus" />
                Add a line
              </button>
            </div>
          </div>
        ) : !setup.inForce.length ? (
          <NoLines href={setup.borrowerHref} />
        ) : null}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium">Usage</p>
            <p className="text-xs text-muted">
              Assumed in {scenarioName}, over the analysis&apos;s: blank keeps
              it, shown in grey. A month&apos;s amount replaces the share that
              month.
            </p>
          </div>
          <WithoutUsage lines={setup.withoutUsage} />
          <WithoutRate lines={setup.withoutRate} currency={setup.currency} />
          <ExchangeRateFields
            currencies={foreign(rows, setup.currency)}
            currency={setup.currency}
            drafts={draft.rates}
            inherited={setup.analysisRates}
            onChange={(rates) => onChange({ ...draft, rates })}
          />
          {rows.length ? (
            <UsageGrid
              rows={rows}
              months={months}
              drafts={draft.usage}
              inherited={setup.analysisUsage}
              onChange={(usage) => onChange({ ...draft, usage })}
            />
          ) : (
            <p className="text-sm text-muted">
              No line counts in any month: the analysis has no projected years,
              and the scenario no project.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

const caption = "text-xs font-medium text-muted";

// A line as the deal proposes it: one in force, changed or closed, or a new
// one.
function ProposedLineFields({
  line,
  was,
  margined,
  newMargined,
  terms,
  onTerms,
  onChange,
  onRemove,
}: {
  line: LineDraft;
  // The line in force it changes; null for a new line.
  was: LineInForce | null;
  // Its borrowing base in force, when it's margined.
  margined: BorrowingBaseDefinition | null;
  // A new line's own borrowing base, when the deal margins it.
  newMargined: BorrowingBaseDefinition | null;
  terms: DealTermsDraft;
  onTerms: (terms: DealTermsDraft) => void;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
}) {
  const changedTerms = Object.keys(dealTermsInput(terms)).length;
  const name = line.name || was?.name || "The line";
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <legend className="sr-only">{name}</legend>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-48 flex-[2] flex-col gap-1">
          <span className={caption}>{was ? "Line in force" : "New line"}</span>
          <input
            value={line.name}
            placeholder="Operating line"
            onChange={(e) => onChange({ name: e.target.value })}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={caption}>Currency</span>
          <input
            value={line.currency}
            maxLength={3}
            onChange={(e) =>
              onChange({ currency: e.target.value.toUpperCase() })
            }
            className={`${box} w-20`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={caption}>Limit</span>
          <input
            value={line.limit.value}
            placeholder="2,000,000"
            inputMode="decimal"
            disabled={line.closed}
            onChange={(e) =>
              onChange({ limit: { ...line.limit, value: e.target.value } })
            }
            className={`${box} w-36 text-right tabular-nums`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={caption}>Rate</span>
          <input
            value={line.rate}
            placeholder="7.2%"
            disabled={line.closed}
            onChange={(e) => onChange({ rate: e.target.value })}
            className={`${box} w-24 text-right tabular-nums`}
          />
        </label>
        {was && (
          <label className="flex items-center gap-2 self-center pt-5 text-sm">
            <input
              type="checkbox"
              checked={line.closed}
              onChange={(e) => onChange({ closed: e.target.checked })}
            />
            Close at the deal
          </label>
        )}
        <button
          type="button"
          className={`${button.icon} mb-1 ml-auto`}
          aria-label={
            was
              ? `Leave ${was.name} as in force`
              : `Remove ${line.name || "the new line"}`
          }
          title={was ? "Leave as in force" : "Remove"}
          onClick={onRemove}
        >
          <Trash2 />
        </button>
      </div>
      {!line.closed && (
        <TermChanges
          draft={line.limit}
          name={`${name}, limit`}
          onChange={(limit) => onChange({ limit })}
        />
      )}
      {was && (
        <p className="text-xs text-muted tabular-nums">
          In force: {describeTerm(was.limit)} at{" "}
          {formatFigure(was.rate, "percent")}
        </p>
      )}
      {margined && !line.closed && (
        <details
          open={changedTerms > 0}
          className="group rounded-md border border-line/70 bg-surface-2/30"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
            <span className="font-medium">Borrowing base terms</span>
            <span className="text-xs text-muted">
              {changedTerms
                ? `${changedTerms} ${changedTerms === 1 ? "line" : "lines"} changed at the deal`
                : "As in force: advance rates, caps and reserves the deal can change"}
            </span>
            <ChevronDown
              className="ml-auto size-4 text-muted transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="border-t border-line/70 px-3 py-2">
            <DealTermsEditor
              name={name}
              definition={margined}
              draft={terms}
              onChange={onTerms}
            />
          </div>
        </details>
      )}
      {!was && newMargined && (
        <p className="text-xs text-muted">
          Margined
          {newMargined.basedOn ? ` from ${newMargined.basedOn.name}` : ""}:
          projected from its own borrowing base and assumptions, with no
          history.
        </p>
      )}
    </fieldset>
  );
}

// A deal's changes to the lines, a line each, for its summary: "Operating
// line: limit 2,000,000 → 2,500,000".
export function lineChanges(
  proposed: readonly ProposedLine[],
  inForce: readonly LineInForce[],
  margined: Record<string, BorrowingBaseDefinition> = {},
): string[] {
  const percent = (rate: string) => formatFigure(rate, "percent");
  return proposed.flatMap((line) => {
    const was = inForce.find((l) => l.id === line.id);
    if (!was)
      return [
        `${line.name}: new line, ${describeTerm(line.limit)} at ${percent(line.rate)}`,
      ];
    if (line.closed) return [`${was.name}: closed at the deal`];
    const changes = [
      line.name !== was.name && `renamed ${line.name}`,
      line.currency !== was.currency &&
        `currency ${was.currency} → ${line.currency}`,
      describeTerm(line.limit) !== describeTerm(was.limit) &&
        `limit ${describeTerm(was.limit)} → ${describeTerm(line.limit)}`,
      line.rate !== was.rate &&
        `rate ${percent(was.rate)} → ${percent(line.rate)}`,
      ...describeDealTerms(line.terms, margined[line.id]),
    ].filter(Boolean);
    return changes.length ? [`${was.name}: ${changes.join(", ")}`] : [];
  });
}
