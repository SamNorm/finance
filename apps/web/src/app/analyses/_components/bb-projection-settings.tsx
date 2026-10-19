"use client";

import type {
  AnalysisBorrowingBase,
  ScenarioBorrowingBase,
} from "@finance/domain";
import type {
  BorrowingBaseFormat,
  LineOf,
} from "@finance/domain/borrowing-bases";
import { CalendarRange, History } from "lucide-react";
import { useState, useTransition } from "react";
import { Card } from "@/components/page";
import { button, input } from "@/components/styles";
import { Segmented } from "@/components/ui";
import { describeMonth } from "@/lib/borrowing-bases";
import { MONTHS, typedAmount, typedRate } from "@/lib/credit-lines";
import { formatFigure } from "@/lib/format";
import {
  fillSeasonalAssumptionAction,
  setAnalysisBorrowingBaseAction,
  setScenarioBorrowingBaseAction,
} from "../borrowing-base-actions";

// How an analysis projects a margined line (borrowing-base-plan.md §8.2,
// §8.3): from its assumptions or the client's figures, over how many
// months, and the base case's values for the definition's assumptions, one
// for every month or one per calendar month for a season. A scenario
// overrides them, for every month or month by month.

type Assumption = LineOf<"assumption">;

const SOURCES = {
  assumptions: "Assumptions",
  client: "The client's figures",
};

// A stored value as typed back: "5%", "1,250,000".
export function typedValue(
  raw: string | null | undefined,
  format: BorrowingBaseFormat,
): string {
  if (raw === null || raw === undefined) return "";
  if (format === "percent") return typedRate(raw);
  if (format === "amount") return typedAmount(raw);
  return raw;
}

// A month's input: compact, so a year fits on a row.
const cell =
  "w-full min-w-[4.75rem] rounded border px-1.5 py-1 text-right text-xs tabular-nums outline-none placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20";
// A value entered stands out from the one it falls back on.
const tone = (value: string) =>
  value.trim()
    ? "border-accent/50 bg-accent-soft/40"
    : "border-line bg-surface";
const box = input.replace("w-full ", "");

// The definition's own value, in words.
const definitionValue = (a: Assumption) =>
  a.byMonth?.some((v) => v !== null)
    ? "By month"
    : formatFigure(a.value, a.format) || "Blank";

function Feedback({
  feedback,
  dirty,
}: {
  feedback: { ok: boolean; message: string } | null;
  dirty: boolean;
}) {
  if (feedback)
    return (
      <span
        className={`text-sm ${feedback.ok ? "text-success" : "text-danger"}`}
      >
        {feedback.message}
      </span>
    );
  return dirty ? (
    <span className="flex items-center gap-2 text-sm text-muted">
      <span className="size-2 rounded-full bg-warning" />
      Unsaved changes
    </span>
  ) : null;
}

interface BaseDraft {
  source: "assumptions" | "client";
  months: string;
  values: Record<string, { value: string; byMonth: string[] | null }>;
}

// An assumption the definition sets by calendar month: a seasonal profile,
// which can be filled from the certificates.
const seasonal = (a: Assumption) => Boolean(a.byMonth);

const baseDraft = (line: AnalysisBorrowingBase): BaseDraft => ({
  source: line.settings.source,
  months: String(line.settings.months),
  values: Object.fromEntries(
    line.assumptions.map((a) => {
      const own = line.settings.assumptions?.[a.code];
      return [
        a.code,
        {
          value: typedValue(own?.value, a.format),
          // A seasonal profile, set by calendar month in the definition,
          // opens by month.
          byMonth: own?.byMonth
            ? own.byMonth.map((v) => typedValue(v, a.format))
            : seasonal(a)
              ? Array.from({ length: 12 }, () => "")
              : null,
        },
      ];
    }),
  ),
});

const baseInput = (draft: BaseDraft) => ({
  source: draft.source,
  months: Number(draft.months),
  assumptions: Object.fromEntries(
    Object.entries(draft.values).map(([code, v]) => [
      code,
      { value: v.value, ...(v.byMonth ? { byMonth: v.byMonth } : {}) },
    ]),
  ),
});

// Figures a season can follow: entered collateral, drivers and usage, and
// the line's balance.
function seasonSources(line: AnalysisBorrowingBase) {
  const rows = line.rows.filter(
    (r) =>
      r.kind === "line" &&
      ["collateral", "driver", "usage"].includes(r.lineKind ?? "") &&
      line.run.cells[r.code],
  );
  const drivers = rows.filter((r) => r.lineKind === "driver");
  return [
    ...drivers,
    ...rows.filter((r) => r.lineKind !== "driver"),
    ...line.rows.filter(
      (r) =>
        (r.code === "BB_OUTSTANDING" || r.code === "BB_USAGE") &&
        line.run.cells[r.code],
    ),
  ].map((r) => ({ code: r.code, label: r.label }));
}

// The base case's settings for a line: its source, months and assumption
// values, saved together. A seasonal assumption fills from history once.
export function ProjectionSettings({
  analysisId,
  line,
}: {
  analysisId: string;
  line: AnalysisBorrowingBase;
}) {
  const [draft, setDraft] = useState(() => baseDraft(line));
  // Once saved or filled, show the settings as the server keeps them.
  const serialized = JSON.stringify(line.settings);
  const [synced, setSynced] = useState(serialized);
  if (synced !== serialized) {
    setSynced(serialized);
    setDraft(baseDraft(line));
  }
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const dirty =
    JSON.stringify(baseInput(draft)) !==
    JSON.stringify(baseInput(baseDraft(line)));
  const sources = seasonSources(line);
  const [follow, setFollow] = useState(sources[0]?.code ?? "");
  const firstAhead = line.run.months.find((m) => m.projected)?.month;
  const lastAhead = line.run.months.findLast((m) => m.projected)?.month;

  const set = (code: string, patch: Partial<BaseDraft["values"][string]>) =>
    setDraft((d) => ({
      ...d,
      values: { ...d.values, [code]: { ...d.values[code]!, ...patch } },
    }));

  function save() {
    setFeedback(null);
    startTransition(async () => {
      const result = await setAnalysisBorrowingBaseAction(
        analysisId,
        line.key,
        baseInput(draft),
      );
      startTransition(() =>
        setFeedback(
          result.ok
            ? { ok: true, message: "Saved. The projection is updated." }
            : { ok: false, message: result.message },
        ),
      );
    });
  }

  function fill(a: Assumption) {
    const figure = sources.find((s) => s.code === follow);
    if (!figure) return;
    if (
      !confirm(
        `Fill ${a.label} month by month from ${figure.label}: each calendar month's share of a typical month over the last three years of certificates. It replaces its values by month and saves them${dirty ? "; other unsaved changes here are lost" : ""}.`,
      )
    )
      return;
    setFeedback(null);
    startTransition(async () => {
      const result = await fillSeasonalAssumptionAction(
        analysisId,
        line.key,
        a.code,
        figure.code,
      );
      startTransition(() =>
        setFeedback(
          result.ok
            ? {
                ok: true,
                message: `${a.label} filled from ${figure.label}. Review the months: they're now the analysis's own.`,
              }
            : { ok: false, message: result.message },
        ),
      );
    });
  }

  return (
    <Card
      title="Projection"
      description={`Where ${line.name}'s months ahead come from, and the base case's assumption values. Scenarios start from them.`}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Source</span>
            <div className="w-72">
              <Segmented
                name={`source-${line.key}`}
                options={SOURCES}
                value={draft.source}
                onChange={(source) => setDraft((d) => ({ ...d, source }))}
              />
            </div>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">
              Months projected
            </span>
            <input
              type="number"
              min={1}
              max={24}
              value={draft.months}
              onChange={(e) =>
                setDraft((d) => ({ ...d, months: e.target.value }))
              }
              className={`${box} w-24 text-right tabular-nums`}
            />
          </label>
          <p className="pb-1.5 text-xs text-muted">
            {firstAhead && lastAhead
              ? `Now ${describeMonth(firstAhead)} to ${describeMonth(lastAhead)}, from the month after the last certificate; 12 by default, up to 24.`
              : "From the month after the last certificate; 12 by default, up to 24."}
            {draft.source === "client" &&
              " Lines the client doesn't project come from their projection formula, flagged as estimated."}
          </p>
        </div>

        {line.assumptions.length === 0 ? (
          <p className="text-sm text-muted">
            The borrowing base has no assumptions: its projection formulas read
            only its own figures.
          </p>
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="py-1.5 pr-3 text-left font-medium">
                    Assumption
                  </th>
                  <th className="px-2 py-1.5 text-right font-medium">
                    Definition
                  </th>
                  <th className="px-1 py-1.5 text-left font-medium whitespace-nowrap">
                    This analysis
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {line.assumptions.map((a) => {
                  const own = draft.values[a.code]!;
                  const fallback = (m: number) =>
                    own.value.trim() ||
                    typedValue(a.byMonth?.[m] ?? a.value, a.format);
                  return [
                    <tr key={a.code}>
                      <td
                        title={`${a.code}${a.description ? ` · ${a.description}` : ""}`}
                        className="min-w-56 border-t border-line/60 py-1.5 pr-3 font-medium"
                      >
                        {a.label}
                        {a.description && (
                          <span className="block text-xs font-normal text-muted">
                            {a.description}
                          </span>
                        )}
                      </td>
                      <td className="border-t border-line/60 px-2 py-1.5 text-right whitespace-nowrap text-muted tabular-nums">
                        {definitionValue(a)}
                      </td>
                      <td className="w-40 min-w-36 border-t border-line/60 px-1 py-1">
                        <input
                          aria-label={`${a.label}, every month`}
                          value={own.value}
                          placeholder={
                            formatFigure(a.value, a.format) || "Definition"
                          }
                          onChange={(e) =>
                            set(a.code, { value: e.target.value })
                          }
                          className={`${input} text-right tabular-nums ${own.value.trim() ? "border-accent/50 bg-accent-soft/40" : ""}`}
                        />
                      </td>
                      <td className="w-full border-t border-line/60 px-2 py-1">
                        <button
                          type="button"
                          className={`${button.ghost} px-2 py-1 text-xs`}
                          onClick={() =>
                            set(a.code, {
                              byMonth: own.byMonth
                                ? null
                                : Array.from({ length: 12 }, () => ""),
                            })
                          }
                        >
                          <CalendarRange />
                          {own.byMonth ? "One value" : "By month"}
                        </button>
                      </td>
                    </tr>,
                    own.byMonth && (
                      <tr key={`${a.code}:months`}>
                        <td colSpan={4} className="pb-2">
                          <div className="flex flex-col gap-2 rounded-lg bg-surface-2/50 p-2">
                            <table className="w-full border-separate border-spacing-x-1">
                              <thead>
                                <tr className="text-xs text-muted">
                                  {MONTHS.map((m) => (
                                    <th
                                      key={m}
                                      className="text-right font-medium"
                                    >
                                      {m}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  {MONTHS.map((name, m) => {
                                    const value = own.byMonth![m] ?? "";
                                    return (
                                      <td key={name}>
                                        <input
                                          aria-label={`${a.label}, ${name}`}
                                          value={value}
                                          placeholder={fallback(m)}
                                          onChange={(e) =>
                                            set(a.code, {
                                              byMonth: own.byMonth!.map(
                                                (v, i) =>
                                                  i === m ? e.target.value : v,
                                              ),
                                            })
                                          }
                                          className={`${cell} ${tone(value)}`}
                                        />
                                      </td>
                                    );
                                  })}
                                </tr>
                              </tbody>
                            </table>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                              <span>
                                A month left blank takes this analysis&apos;s
                                value for every month, or else the
                                definition&apos;s, shown in grey.
                              </span>
                              {!line.proposedNew &&
                                seasonal(a) &&
                                sources.length > 0 && (
                                  <span className="ml-auto flex items-center gap-2">
                                    Fill from history, following
                                    <select
                                      aria-label="The figure the season follows"
                                      value={follow}
                                      onChange={(e) =>
                                        setFollow(e.target.value)
                                      }
                                      className={`${box} py-1 text-xs`}
                                    >
                                      {sources.map((s) => (
                                        <option key={s.code} value={s.code}>
                                          {s.label}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      className={`${button.secondary} px-2 py-1 text-xs`}
                                      disabled={pending}
                                      onClick={() => fill(a)}
                                    >
                                      <History />
                                      Fill
                                    </button>
                                  </span>
                                )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <button
            type="button"
            className={button.primary}
            onClick={save}
            disabled={pending || !dirty}
          >
            {pending ? "Saving…" : "Save projection"}
          </button>
          <Feedback feedback={feedback} dirty={dirty} />
        </div>
      </div>
    </Card>
  );
}

type ScenarioDraft = Record<
  string,
  { value: string; months: Record<string, string> }
>;

export const scenarioDraft = (
  line: AnalysisBorrowingBase,
  own: ScenarioBorrowingBase | undefined,
): ScenarioDraft =>
  Object.fromEntries(
    line.assumptions.map((a) => {
      const given = own?.assumptions?.[a.code];
      return [
        a.code,
        {
          value: typedValue(given?.value, a.format),
          months: Object.fromEntries(
            Object.entries(given?.months ?? {}).map(([m, v]) => [
              m,
              typedValue(v, a.format),
            ]),
          ),
        },
      ];
    }),
  );

// What the domain reads, blanks left out.
export const scenarioAssumptionsInput = (draft: ScenarioDraft) =>
  Object.fromEntries(
    Object.entries(draft).flatMap(([code, v]) => {
      const months = Object.fromEntries(
        Object.entries(v.months).filter(([, x]) => x.trim()),
      );
      if (!v.value.trim() && !Object.keys(months).length) return [];
      return [
        [
          code,
          {
            ...(v.value.trim() ? { value: v.value } : {}),
            ...(Object.keys(months).length ? { months } : {}),
          },
        ],
      ];
    }),
  );

// A scenario's own assumption values for a line, over the base case's: one
// for every month, or month by month, such as sales down 15% from June.
export function ScenarioProjection({
  scenario,
  line,
  own,
}: {
  scenario: { id: string; name: string };
  line: AnalysisBorrowingBase;
  own: ScenarioBorrowingBase | undefined;
}) {
  const [draft, setDraft] = useState(() => scenarioDraft(line, own));
  const serialized = JSON.stringify(own ?? null);
  const [synced, setSynced] = useState(serialized);
  if (synced !== serialized) {
    setSynced(serialized);
    setDraft(scenarioDraft(line, own));
  }
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const dirty =
    JSON.stringify(scenarioAssumptionsInput(draft)) !==
    JSON.stringify(scenarioAssumptionsInput(scenarioDraft(line, own)));
  const months = line.run.months.filter((m) => m.projected).map((m) => m.month);
  const base = line.settings.assumptions ?? {};
  // The base case's value in a month: the analysis's for that calendar
  // month or every month, else the definition's.
  const baseAt = (a: Assumption, month: string) => {
    const m = Number(month.slice(5, 7)) - 1;
    return typedValue(
      base[a.code]?.byMonth?.[m] ??
        base[a.code]?.value ??
        a.byMonth?.[m] ??
        a.value,
      a.format,
    );
  };
  const baseText = (a: Assumption) =>
    base[a.code]?.byMonth?.some((v) => v !== null)
      ? "By month"
      : base[a.code]?.value !== undefined && base[a.code]?.value !== null
        ? formatFigure(base[a.code]!.value!, a.format)
        : definitionValue(a);

  function save() {
    setFeedback(null);
    const assumptions = scenarioAssumptionsInput(draft);
    const figures = own?.figures ?? {};
    startTransition(async () => {
      const result = await setScenarioBorrowingBaseAction(
        scenario.id,
        line.key,
        Object.keys(assumptions).length || Object.keys(figures).length
          ? { assumptions, figures }
          : null,
      );
      startTransition(() =>
        setFeedback(
          result.ok
            ? { ok: true, message: "Saved. The projection is updated." }
            : { ok: false, message: result.message },
        ),
      );
    });
  }

  return (
    <Card
      title={`Assumptions in ${scenario.name}`}
      description={`Projected from ${line.settings.source === "client" ? "the client's figures, lines it leaves out from their projection formulas" : "assumptions"}, ${line.settings.months} months, as the base case sets. Override what changes in this scenario; blank keeps the base case, shown in grey. A month's own value applies that month alone.`}
    >
      {line.assumptions.length === 0 ? (
        <p className="text-sm text-muted">
          The borrowing base has no assumptions. A scenario can still change the
          figures of projected months, below.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full border-separate border-spacing-x-1 border-spacing-y-0.5 text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="sticky left-0 z-10 bg-surface py-1.5 pr-2 text-left font-medium">
                    Assumption
                  </th>
                  <th className="px-1 py-1.5 text-right font-medium">Base</th>
                  <th className="px-1 py-1.5 text-left font-medium whitespace-nowrap">
                    Every month
                  </th>
                  {months.map((m) => (
                    <th
                      key={m}
                      className="px-0.5 py-1.5 text-right font-medium whitespace-nowrap"
                    >
                      {describeMonth(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {line.assumptions.map((a) => {
                  const own = draft[a.code]!;
                  return (
                    <tr key={a.code}>
                      <td
                        title={a.code}
                        className="sticky left-0 z-10 min-w-48 bg-surface py-1 pr-2 font-medium"
                      >
                        {a.label}
                      </td>
                      <td className="px-1 py-1 text-right whitespace-nowrap text-muted tabular-nums">
                        {baseText(a)}
                      </td>
                      <td className="min-w-28 px-0.5 py-0.5">
                        <input
                          aria-label={`${a.label}, every month`}
                          value={own.value}
                          placeholder="Base case"
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              [a.code]: { ...own, value: e.target.value },
                            }))
                          }
                          className={`${cell} ${tone(own.value)}`}
                        />
                      </td>
                      {months.map((m) => {
                        const value = own.months[m] ?? "";
                        return (
                          <td key={m} className="px-0.5 py-0.5">
                            <input
                              aria-label={`${a.label}, ${describeMonth(m)}`}
                              value={value}
                              placeholder={own.value.trim() || baseAt(a, m)}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  [a.code]: {
                                    ...own,
                                    months: {
                                      ...own.months,
                                      [m]: e.target.value,
                                    },
                                  },
                                }))
                              }
                              className={`${cell} ${tone(value)}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <button
              type="button"
              className={button.primary}
              onClick={save}
              disabled={pending || !dirty}
            >
              {pending ? "Saving…" : "Save assumptions"}
            </button>
            <Feedback feedback={feedback} dirty={dirty} />
          </div>
        </div>
      )}
    </Card>
  );
}
