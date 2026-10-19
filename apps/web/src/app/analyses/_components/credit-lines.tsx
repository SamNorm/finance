"use client";

import type { LineUsage, ProposedLine, Term } from "@finance/domain";
import { monthIndex, monthOf } from "@finance/domain/amortization";
import { Dec } from "@finance/engine";
import { Pencil, Trash2, TriangleAlert } from "lucide-react";
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

// Lines of credit in an analysis (borrowing-base-plan.md §4.3, §4.4): the
// usage assumed for each line, a share of its limit with any month
// overridden by an amount drawn, which its interest comes from; and a
// scenario's proposed lines for its deal. Months count only inside the
// windows the run reads: projected periods, and the twelve months after a
// project's closing.

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
  // Where lines are entered: the borrower's Existing debt tab.
  borrowerHref: string;
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
  // Once saved, or changed elsewhere such as from MCP, show the usage as
  // the server keeps it.
  const serialized = JSON.stringify(setup.analysisUsage);
  const [synced, setSynced] = useState(serialized);
  if (synced !== serialized) {
    setSynced(serialized);
    setDrafts(saved());
  }
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const ids = new Set(setup.inForce.map((l) => l.id));
  const dirty =
    JSON.stringify(usageInput(drafts, ids)) !==
    JSON.stringify(usageInput(saved(), ids));
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
      description="The usage assumed for each line, a share of its limit, which its interest in projected years comes from. A month's amount replaces the share that month. Scenarios can assume their own."
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
              {pending ? "Saving…" : "Save usage"}
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
}

export const scenarioLinesDraft = (
  lines: ProposedLine[] | null,
  usage: LineUsage,
): ScenarioLinesDraft => ({
  proposed: lines && lines.map(lineDraft),
  usage: usageDrafts(usage),
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
          : change && differs(change, line)
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
  onChange,
  onRemove,
}: {
  line: LineDraft;
  // The line in force it changes; null for a new line.
  was: LineInForce | null;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
}) {
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
    </fieldset>
  );
}

// A deal's changes to the lines, a line each, for its summary: "Operating
// line: limit 2,000,000 → 2,500,000".
export function lineChanges(
  proposed: readonly ProposedLine[],
  inForce: readonly LineInForce[],
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
    ].filter(Boolean);
    return changes.length ? [`${was.name}: ${changes.join(", ")}`] : [];
  });
}
