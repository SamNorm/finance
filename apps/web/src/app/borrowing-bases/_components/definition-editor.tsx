"use client";

import type { Issue } from "@finance/domain";
import {
  COLLATERAL_CODES,
  COLLATERAL_TYPES,
  DEFAULT_BUCKETS,
  DEFAULT_INELIGIBLE_FROM,
  LINE_CODE,
  LINE_KINDS,
  TOTALS,
  type BorrowingBaseDefinition,
  type BorrowingBaseFormat,
  type BorrowingBaseLineKind,
  type CollateralType,
} from "@finance/domain/borrowing-bases";
import { checkFormula, referenceText, renameReferences } from "@finance/engine";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { ask } from "@/components/confirm";
import { IssueList } from "@/components/issue-list";
import { Menu, MenuItem } from "@/components/menu";
import { Card } from "@/components/page";
import { button, input } from "@/components/styles";
import { TermChanges } from "@/components/term-editor";
import { Field, Icon, Modal, Segmented } from "@/components/ui";
import type { ActionFailure, ActionResult } from "@/lib/action-result";
import {
  blankLine,
  computedCodes,
  describeMonth,
  lineDraft,
  lineInput,
  newTest,
  ratesOf,
  testDraft,
  testInput,
  type Figure,
  type LineDraft,
  type TestDraft,
} from "@/lib/borrowing-bases";
import {
  BLANK_TERM,
  describeMonths,
  MONTHS,
  type TermDraft,
} from "@/lib/credit-lines";

// A borrowing base's definition as typed (borrowing-base-plan.md §5): its
// typed lines, the line outstanding and its tests, shared by a margined
// line's Terms tab and the organization's templates.

const FORMATS: Record<BorrowingBaseFormat, string> = {
  amount: "Amount",
  percent: "Percent",
  ratio: "Ratio",
  count: "Count",
  flag: "Pass or fail",
};

// What a collateral line computes, renamed with it in formulas.
const SUFFIXES = [
  "",
  ...COLLATERAL_CODES.map((c) => `.${c.suffix}`),
  ".AGED_OUT",
  ...Array.from({ length: 12 }, (_, i) => `.AGE${i + 1}`),
];

// The input style without its full width, so fields keep their own.
const box = input.replace("w-full ", "");

// A term draft in words, as typed: "75% · from Jun 2026: 70%".
function typedTerm(draft: TermDraft) {
  return [
    draft.value || "–",
    ...draft.seasons.map((s) => `${s.value} ${describeMonths(s.months)}`),
    ...draft.steps.map(
      (s) => `from ${s.from ? describeMonth(s.from) : "?"}: ${s.value}`,
    ),
  ].join(" · ");
}

interface Outstanding {
  reconcilesWith: string;
  projection: string;
}

type Editing =
  | { mode: "edit"; key: string }
  | { mode: "new"; draft: LineDraft }
  | { mode: "outstanding" }
  | { mode: "test"; draft: TestDraft; isNew: boolean };

// The sections lines are listed in, in waterfall order.
const SECTIONS: { title: string; kinds: BorrowingBaseLineKind[] }[] = [
  { title: "Collateral", kinds: ["group", "collateral", "ineligible"] },
  { title: "Prior claims", kinds: ["prior_claim"] },
  { title: "Reserves", kinds: ["reserve"] },
  { title: "Usage", kinds: ["usage"] },
  { title: "Drivers", kinds: ["driver"] },
  { title: "Assumptions", kinds: ["assumption"] },
  { title: "Calculations", kinds: ["calculation"] },
];

interface Entry {
  draft: LineDraft;
  depth: number;
  // Why it's out of the waterfall, when it is.
  orphan?: string;
}

// Lines and the siblings they move among: collateral within its group or
// at the top with groups, ineligibles within their line, the rest by kind.
function levelOf(draft: LineDraft, groups: ReadonlySet<string>) {
  if (draft.kind === "group") return "top";
  if (draft.kind === "collateral")
    return groups.has(draft.group) ? `in:${draft.group}` : "top";
  if (draft.kind === "ineligible") return `of:${draft.of}`;
  return draft.kind;
}

// A borrowing base's definition, edited as a whole then saved: its lines
// in waterfall order, each opening in a drawer, the line outstanding, and
// its tests. A line's Terms tab and an organization's template both edit
// with it; charts are saved apart, from their own card.
export function DefinitionEditor({
  currency,
  definition,
  items,
  figures,
  issues = [],
  onSave,
  onWarnings,
  description,
  unsaved,
  actions,
}: {
  // The line's currency; null for a template, which any line copies.
  currency: string | null;
  definition: BorrowingBaseDefinition;
  // Balance sheet items lines reconcile with.
  items: { code: string; label: string }[];
  // What tests can read.
  figures: Figure[];
  // The saved definition's issues, flagged on its lines, when it's kept
  // with them, as a template's draft is.
  issues?: Issue[];
  // Saves the whole definition, lines renamed old code → new; its
  // warnings come back.
  onSave: (
    definition: Record<string, unknown>,
    renames: Record<string, string>,
  ) => Promise<ActionResult<Issue[]>>;
  onWarnings: (issues: Issue[]) => void;
  description: string;
  // What unsaved changes mean, shown while there are some.
  unsaved: string;
  // More actions in the header, given whether there are unsaved changes.
  actions?: (dirty: boolean) => ReactNode;
}) {
  const formatOf = (code: string) =>
    figures.find((f) => f.code === code)?.format ?? "amount";
  // As saved, to start from and to go back to.
  const [initial] = useState(() => ({
    drafts: definition.lines.map(lineDraft),
    outstanding: {
      reconcilesWith: definition.outstandingReconcilesWith ?? "",
      projection: definition.outstandingProjection ?? "",
    },
    tests: (definition.tests ?? []).map((t) =>
      testDraft(t, formatOf(t.metric)),
    ),
  }));
  const [drafts, setDrafts] = useState<LineDraft[]>(initial.drafts);
  const [outstanding, setOutstanding] = useState<Outstanding>(
    initial.outstanding,
  );
  const [tests, setTests] = useState<TestDraft[]>(initial.tests);
  // Charts are left out: they're saved from their tab, as they are when
  // this is.
  const payload = (
    list: LineDraft[],
    out: Outstanding,
    checks: TestDraft[],
  ) => ({
    ...(definition.basedOn ? { basedOn: definition.basedOn } : {}),
    outstandingReconcilesWith: out.reconcilesWith,
    outstandingProjection: out.projection,
    lines: list.map(lineInput),
    tests: checks.map(testInput),
  });
  const [baseline] = useState(() =>
    JSON.stringify(payload(initial.drafts, initial.outstanding, initial.tests)),
  );
  const dirty =
    JSON.stringify(payload(drafts, outstanding, tests)) !== baseline;
  // Lines whose code changed since saved, old → new: their figures follow.
  const renames = Object.fromEntries(
    initial.drafts.flatMap((was) => {
      const now = drafts.find((d) => d.key === was.key);
      return now && was.code && now.code !== was.code
        ? [[was.code, now.code]]
        : [];
    }),
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, startSave] = useTransition();
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  const groups = new Set(
    drafts.filter((d) => d.kind === "group").map((d) => d.code),
  );
  const flagged = new Map<string, Issue[]>();
  for (const issue of failure?.issues ?? issues)
    if (issue.itemCode)
      flagged.set(issue.itemCode, [
        ...(flagged.get(issue.itemCode) ?? []),
        issue,
      ]);

  // The waterfall's order: groups with their collateral and each
  // collateral line's ineligibles under it, collateral in no group in
  // between; lines that point nowhere last.
  const entriesOf = (kinds: BorrowingBaseLineKind[]): Entry[] => {
    if (!kinds.includes("collateral"))
      return drafts
        .filter((d) => kinds.includes(d.kind))
        .map((draft) => ({ draft, depth: 0 }));
    const entries: Entry[] = [];
    const collateral = new Set(
      drafts.filter((d) => d.kind === "collateral").map((d) => d.code),
    );
    const block = (x: LineDraft, depth: number, orphan?: string) => {
      entries.push({ draft: x, depth, orphan });
      for (const i of drafts)
        if (i.kind === "ineligible" && i.of === x.code)
          entries.push({ draft: i, depth: depth + 1 });
    };
    for (const d of drafts) {
      if (d.kind === "group") {
        entries.push({ draft: d, depth: 0 });
        for (const x of drafts)
          if (x.kind === "collateral" && x.group === d.code) block(x, 1);
      } else if (d.kind === "collateral" && !groups.has(d.group))
        block(
          d,
          0,
          d.group ? `"${d.group}" isn't a group of this borrowing base.` : "",
        );
    }
    for (const d of drafts)
      if (d.kind === "ineligible" && !collateral.has(d.of))
        entries.push({
          draft: d,
          depth: 0,
          orphan: "Reduces no collateral line: choose which it reduces.",
        });
    return entries;
  };

  function move(draft: LineDraft, step: -1 | 1) {
    const level = levelOf(draft, groups);
    const siblings = drafts.filter((d) => levelOf(d, groups) === level);
    const neighbor = siblings[siblings.indexOf(draft) + step];
    if (!neighbor) return;
    const a = drafts.indexOf(draft);
    const b = drafts.indexOf(neighbor);
    const next = [...drafts];
    [next[a], next[b]] = [next[b]!, next[a]!];
    setDrafts(next);
  }

  // A line as applied from its drawer. A new code follows it into the
  // lines that point at it and the formulas that read it.
  function apply(next: LineDraft) {
    const old = drafts.find((d) => d.key === next.key);
    let list = old
      ? drafts.map((d) => (d.key === next.key ? next : d))
      : [...drafts, next];
    if (old?.code && old.code !== next.code) {
      const rename = (formula: string) =>
        formula &&
        SUFFIXES.reduce(
          (f, suffix) =>
            renameReferences(
              f,
              `${old.code}${suffix}`,
              `${next.code}${suffix}`,
            ),
          formula,
        );
      list = list.map((d) => ({
        ...d,
        group: d.group === old.code ? next.code : d.group,
        of: d.of === old.code ? next.code : d.of,
        formula: rename(d.formula),
        projection: rename(d.projection),
      }));
      setTests(
        tests.map((t) => {
          const suffix = SUFFIXES.find((x) => t.metric === `${old.code}${x}`);
          return suffix === undefined
            ? t
            : { ...t, metric: `${next.code}${suffix}` };
        }),
      );
    }
    setDrafts(list);
    setEditing(null);
  }

  function applyTest(next: TestDraft) {
    setTests(
      tests.some((t) => t.key === next.key)
        ? tests.map((t) => (t.key === next.key ? next : t))
        : [...tests, next],
    );
    setEditing(null);
  }

  // Removing a collateral line removes its ineligibles; a group's
  // collateral stays, in no group.
  function remove(draft: LineDraft) {
    setDrafts(
      drafts
        .filter(
          (d) =>
            d.key !== draft.key &&
            !(
              draft.kind === "collateral" &&
              d.kind === "ineligible" &&
              d.of === draft.code
            ),
        )
        .map((d) =>
          draft.kind === "group" && d.group === draft.code
            ? { ...d, group: "" }
            : d,
        ),
    );
    setEditing(null);
  }

  function discard() {
    setDrafts(initial.drafts);
    setOutstanding(initial.outstanding);
    setTests(initial.tests);
    setFailure(null);
  }

  function save() {
    setFailure(null);
    startSave(async () => {
      const result = await onSave(
        {
          ...payload(drafts, outstanding, tests),
          ...(definition.charts ? { charts: definition.charts } : {}),
        },
        renames,
      );
      if (!result.ok) return setFailure(result);
      onWarnings(result.value);
    });
  }

  const current =
    editing?.mode === "edit"
      ? drafts.find((d) => d.key === editing.key)
      : editing?.mode === "new"
        ? editing.draft
        : undefined;
  const summary = (d: LineDraft) => {
    const itemLabel = (code: string) =>
      items.find((i) => i.code === code)?.label ?? code;
    const parts: (string | false | null | undefined)[] =
      d.kind === "collateral"
        ? [
            typedTerm(d.rate),
            d.cap && `cap ${typedTerm(d.cap)}`,
            d.aging &&
              (d.aging.buckets[d.aging.ineligibleFrom]
                ? `aged, ${d.aging.buckets[d.aging.ineligibleFrom]} and over out`
                : "aged"),
            !d.aging && (d.formula ? `= ${d.formula}` : "entered"),
            d.currency && `in ${d.currency}`,
            d.reconcilesWith && `part of ${itemLabel(d.reconcilesWith)}`,
          ]
        : d.kind === "group"
          ? [COLLATERAL_TYPES[d.collateral], d.cap && `cap ${typedTerm(d.cap)}`]
          : d.kind === "reserve"
            ? [
                d.amount
                  ? `set at ${typedTerm(d.amount)}`
                  : d.formula
                    ? `= ${d.formula}`
                    : "entered",
              ]
            : d.kind === "assumption"
              ? [
                  d.byMonth ? "by calendar month" : d.value || "no value",
                  FORMATS[d.format].toLowerCase(),
                ]
              : d.kind === "calculation"
                ? [`= ${d.formula}`, FORMATS[d.format].toLowerCase()]
                : [
                    d.formula ? `= ${d.formula}` : "entered",
                    d.currency && `in ${d.currency}`,
                    d.kind === "usage" &&
                      d.reconcilesWith &&
                      `part of ${itemLabel(d.reconcilesWith)}`,
                    d.kind === "driver" && FORMATS[d.format].toLowerCase(),
                  ];
    return parts.filter(Boolean).join(" · ");
  };

  const row = (entry: Entry) => {
    const { draft: d, depth } = entry;
    const level = levelOf(d, groups);
    const siblings = drafts.filter((x) => levelOf(x, groups) === level);
    const at = siblings.indexOf(d);
    const issues = flagged.get(d.code) ?? [];
    return (
      <tr key={d.key} className="group/row hover:bg-surface-2/60">
        <td
          style={{ paddingLeft: 16 + depth * 18 }}
          className="border-b border-line/60 py-1.5 pr-3"
        >
          <button
            type="button"
            onClick={() => setEditing({ mode: "edit", key: d.key })}
            className="flex items-center gap-2 text-left font-medium whitespace-nowrap hover:text-accent"
          >
            {(issues.length > 0 || entry.orphan) && (
              <span
                className={`size-1.5 shrink-0 rounded-full ${issues.some((i) => i.severity === "error") || entry.orphan ? "bg-danger" : "bg-warning"}`}
                aria-label="has issues"
              />
            )}
            {d.label || <span className="text-muted italic">No label</span>}
          </button>
          {entry.orphan && (
            <span className="block text-xs text-danger">{entry.orphan}</span>
          )}
        </td>
        <td className="border-b border-line/60 px-3 py-1.5 font-mono text-xs whitespace-nowrap text-muted">
          {d.code}
        </td>
        <td className="border-b border-line/60 px-3 py-1.5 text-xs whitespace-nowrap text-muted">
          {LINE_KINDS[d.kind].label}
        </td>
        <td className="max-w-md truncate border-b border-line/60 px-3 py-1.5 text-xs tabular-nums">
          {summary(d)}
        </td>
        <td className="border-b border-line/60 px-2 py-1 text-right whitespace-nowrap">
          <button
            type="button"
            className={button.icon}
            disabled={at <= 0}
            onClick={() => move(d, -1)}
            aria-label={`Move ${d.label} up`}
          >
            <ArrowUp />
          </button>
          <button
            type="button"
            className={button.icon}
            disabled={at === -1 || at >= siblings.length - 1}
            onClick={() => move(d, 1)}
            aria-label={`Move ${d.label} down`}
          >
            <ArrowDown />
          </button>
        </td>
      </tr>
    );
  };

  return (
    <Card
      flush
      title="Borrowing base"
      description={description}
      actions={
        <>
          {actions?.(dirty)}
          <Menu
            label="Add a line"
            trigger={
              <button type="button" className={button.secondary}>
                <Icon name="plus" />
                Add line
              </button>
            }
          >
            {(Object.keys(LINE_KINDS) as BorrowingBaseLineKind[]).map(
              (kind) => (
                <MenuItem
                  key={kind}
                  onSelect={() =>
                    setEditing({
                      mode: "new",
                      draft: blankLine(kind, {
                        of:
                          drafts.find((d) => d.kind === "collateral")?.code ??
                          "",
                      }),
                    })
                  }
                >
                  {LINE_KINDS[kind].label}
                </MenuItem>
              ),
            )}
          </Menu>
          {dirty && (
            <button type="button" className={button.ghost} onClick={discard}>
              Discard
            </button>
          )}
          <button
            type="button"
            className={button.primary}
            disabled={!dirty || saving}
            onClick={save}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {dirty && !failure && (
        <p className="border-b border-line bg-accent-soft/40 px-4 py-2 text-xs text-accent">
          {unsaved}
        </p>
      )}
      {failure && (
        <div className="flex flex-col gap-2 border-b border-line bg-danger-soft/50 px-4 py-3">
          <p className="text-sm font-medium text-danger">{failure.message}</p>
          {failure.issues.length > 1 && <IssueList issues={failure.issues} />}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-surface-2/50 text-left text-xs text-muted">
              <th className="border-b border-line px-4 py-2 font-medium">
                Line
              </th>
              <th className="border-b border-line px-3 py-2 font-medium">
                Code
              </th>
              <th className="border-b border-line px-3 py-2 font-medium">
                Kind
              </th>
              <th className="w-full border-b border-line px-3 py-2 font-medium">
                Terms and amount
              </th>
              <th className="border-b border-line px-2 py-2">
                <span className="sr-only">Order</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map((section) => {
              const entries = entriesOf(section.kinds);
              const usage = section.kinds.includes("usage");
              return [
                <tr key={section.title}>
                  <td
                    colSpan={5}
                    className="border-b border-line/60 px-4 pt-4 pb-1 text-xs font-semibold tracking-wide text-muted uppercase"
                  >
                    {section.title}
                  </td>
                </tr>,
                usage && (
                  <tr key="outstanding" className="hover:bg-surface-2/60">
                    <td className="border-b border-line/60 py-1.5 pr-3 pl-4">
                      <button
                        type="button"
                        onClick={() => setEditing({ mode: "outstanding" })}
                        className="text-left font-medium hover:text-accent"
                      >
                        Line outstanding
                      </button>
                    </td>
                    <td className="border-b border-line/60 px-3 py-1.5 font-mono text-xs text-muted">
                      BB_OUTSTANDING
                    </td>
                    <td className="border-b border-line/60 px-3 py-1.5 text-xs text-muted">
                      Built in
                    </td>
                    <td className="border-b border-line/60 px-3 py-1.5 text-xs">
                      {[
                        "entered",
                        outstanding.reconcilesWith &&
                          `part of ${items.find((i) => i.code === outstanding.reconcilesWith)?.label ?? outstanding.reconcilesWith}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </td>
                    <td className="border-b border-line/60" />
                  </tr>
                ),
                ...entries.map(row),
                !usage && entries.length === 0 && (
                  <tr key={`${section.title}:none`}>
                    <td
                      colSpan={5}
                      className="border-b border-line/60 px-4 py-1.5 text-xs text-muted"
                    >
                      None.
                    </td>
                  </tr>
                ),
              ];
            })}
            <tr>
              <td
                colSpan={5}
                className="border-b border-line/60 px-4 pt-4 pb-1 text-xs font-semibold tracking-wide text-muted uppercase"
              >
                <span className="flex items-center justify-between gap-2">
                  Tests
                  <button
                    type="button"
                    className={`${button.ghost} px-2 py-0.5 text-xs font-normal tracking-normal normal-case`}
                    onClick={() =>
                      setEditing({
                        mode: "test",
                        draft: newTest(),
                        isNew: true,
                      })
                    }
                  >
                    <Icon name="plus" />
                    Test
                  </button>
                </span>
              </td>
            </tr>
            {BUILT_IN_TESTS.map((t) => (
              <tr key={t.name}>
                <td className="border-b border-line/60 py-1.5 pr-3 pl-4 font-medium whitespace-nowrap">
                  {t.name}
                </td>
                <td className="border-b border-line/60 px-3 py-1.5 font-mono text-xs text-muted">
                  {t.metric}
                </td>
                <td className="border-b border-line/60 px-3 py-1.5 text-xs text-muted">
                  Built in
                </td>
                <td className="border-b border-line/60 px-3 py-1.5 text-xs">
                  {t.rule}
                </td>
                <td className="border-b border-line/60" />
              </tr>
            ))}
            {tests.map((t) => (
              <tr key={t.key} className="hover:bg-surface-2/60">
                <td className="border-b border-line/60 py-1.5 pr-3 pl-4">
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({ mode: "test", draft: t, isNew: false })
                    }
                    className="flex items-center gap-2 text-left font-medium whitespace-nowrap hover:text-accent"
                  >
                    {failure?.issues.some((i) =>
                      i.message.startsWith(`${t.name}:`),
                    ) && (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-danger"
                        aria-label="has issues"
                      />
                    )}
                    {t.name || (
                      <span className="text-muted italic">No name</span>
                    )}
                  </button>
                </td>
                <td className="border-b border-line/60 px-3 py-1.5 font-mono text-xs text-muted">
                  {t.metric}
                </td>
                <td className="border-b border-line/60 px-3 py-1.5 text-xs text-muted">
                  Test
                </td>
                <td className="max-w-md truncate border-b border-line/60 px-3 py-1.5 text-xs tabular-nums">
                  {figures.find((f) => f.code === t.metric)?.label ?? t.metric}{" "}
                  {t.test === "min" ? "at least" : "at most"}{" "}
                  {typedTerm(t.threshold)}
                </td>
                <td className="border-b border-line/60" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        side
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing?.mode === "outstanding"
            ? "Line outstanding"
            : editing?.mode === "test"
              ? editing.isNew
                ? "New test"
                : "Edit test"
              : editing?.mode === "new"
                ? `New line: ${LINE_KINDS[editing.draft.kind].label.toLowerCase()}`
                : "Edit line"
        }
      >
        {editing?.mode === "test" ? (
          <TestForm
            key={editing.draft.key}
            initial={editing.draft}
            isNew={editing.isNew}
            figures={figures}
            others={tests.filter((t) => t.key !== editing.draft.key)}
            onApply={applyTest}
            onRemove={() => {
              setTests(tests.filter((t) => t.key !== editing.draft.key));
              setEditing(null);
            }}
            onClose={() => setEditing(null)}
          />
        ) : editing?.mode === "outstanding" ? (
          <OutstandingForm
            value={outstanding}
            items={items}
            known={knownCodes(drafts, currency)}
            onApply={(next) => {
              setOutstanding(next);
              setEditing(null);
            }}
            onClose={() => setEditing(null)}
          />
        ) : (
          current && (
            <LineDrawerForm
              key={current.key}
              initial={current}
              isNew={editing?.mode === "new"}
              drafts={drafts}
              items={items}
              currency={currency}
              issues={flagged.get(current.code) ?? []}
              onApply={apply}
              onRemove={() => remove(current)}
              onClose={() => setEditing(null)}
            />
          )
        )}
      </Modal>
    </Card>
  );
}

// The tests every borrowing base has (§6.3).
const BUILT_IN_TESTS = [
  {
    name: "Usage within the borrowing base",
    metric: "BB_SURPLUS",
    rule: "Margin surplus at least zero, each month with a certificate.",
  },
  {
    name: "Usage within the limit",
    metric: "BB_USAGE",
    rule: "Usage at most the authorized limit in force that month.",
  },
];

const THRESHOLD_HINTS: Record<BorrowingBaseFormat, string> = {
  amount: "An amount, such as 250,000.",
  percent: "A percent, such as 15%.",
  ratio: "A ratio, such as 1.25x.",
  count: "A number, such as 3.",
  flag: "",
};

const PLACEHOLDERS: Record<BorrowingBaseFormat, string> = {
  amount: "250,000",
  percent: "15%",
  ratio: "1.25x",
  count: "3",
  flag: "",
};

// A custom test: a figure at least or at most a threshold, which steps
// from a month or differs by season as other terms do.
function TestForm({
  initial,
  isNew,
  figures,
  others,
  onApply,
  onRemove,
  onClose,
}: {
  initial: TestDraft;
  isNew: boolean;
  figures: Figure[];
  others: TestDraft[];
  onApply: (draft: TestDraft) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [t, setT] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const figure = figures.find((f) => f.code === t.metric);
  const format = figure?.format ?? "amount";
  const sections = [...new Set(figures.map((f) => f.section))];

  function apply() {
    const name = t.name.trim();
    const problem = !name
      ? "Give the test a name."
      : others.some((o) => o.name.trim() === name)
        ? `Another test is named ${name}.`
        : !figure
          ? "Choose the figure it tests."
          : !t.threshold.value.trim()
            ? "Enter the threshold."
            : null;
    setProblem(problem);
    if (!problem) onApply({ ...t, name });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">
          Tested each month with a certificate, as the margin test is: the
          threshold, the actual figure, the room left and pass or fail.
          Examples: excess availability at least 250,000; receivables over 90
          days at most 15%.
        </p>
        <Field label="Name">
          <input
            value={t.name}
            onChange={(e) => setT({ ...t, name: e.target.value })}
            placeholder="Minimum excess availability"
            autoFocus={isNew}
            className={input}
          />
        </Field>
        <Field label="Figure">
          <select
            value={t.metric}
            onChange={(e) => setT({ ...t, metric: e.target.value })}
            className={input}
          >
            {!figure && (
              <option value={t.metric}>{t.metric || "Choose"}</option>
            )}
            {sections.map((section) => (
              <optgroup key={section} label={section}>
                {figures
                  .filter((f) => f.section === section && f.format !== "flag")
                  .map((f) => (
                    <option key={f.code} value={f.code}>
                      {f.label} ({f.code})
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Passes when it's" group>
          <Segmented
            name="test"
            options={{ min: "At least", max: "At most" }}
            value={t.test}
            onChange={(test) => setT({ ...t, test })}
          />
        </Field>
        <TermField
          label="Threshold"
          hint={`${THRESHOLD_HINTS[format]} A step changes it from a month on; a season, in some months every year.`}
          draft={t.threshold}
          name={`${t.name || "The test"}, threshold`}
          placeholder={PLACEHOLDERS[format]}
          onChange={(threshold) => setT({ ...t, threshold })}
        />
        {problem && <p className="text-sm text-danger">{problem}</p>}
      </div>
      <DrawerFooter
        onClose={onClose}
        onApply={apply}
        onRemove={
          isNew
            ? undefined
            : async () => {
                if (
                  await ask({
                    title: `Remove the test "${initial.name}"?`,
                    action: "Remove",
                    danger: true,
                  })
                )
                  onRemove();
              }
        }
      />
    </div>
  );
}

// Every name a formula can read: the lines, what the app computes for
// them, the totals and the exchange rates; by any case.
function knownCodes(drafts: LineDraft[], currency: string | null) {
  const options = [
    {
      label: "Lines",
      codes: drafts
        .filter((d) => d.code)
        .map((d) => ({ code: d.code, label: d.label })),
    },
    { label: "Computed for lines", codes: computedCodes(drafts) },
    {
      label: "Totals",
      codes: TOTALS.map((t) => ({ code: t.code, label: t.label })),
    },
    {
      label: "Exchange rates",
      codes: ratesOf(drafts, currency ?? "").map((code) => ({
        code,
        label: `${code.slice(3)} rate`,
      })),
    },
  ].filter((g) => g.codes.length);
  const map = new Map<string, string>();
  for (const group of options)
    for (const { code } of group.codes) map.set(code.toUpperCase(), code);
  return { map, options };
}

type Known = ReturnType<typeof knownCodes>;

// A formula box that checks as you type, with a picker that inserts codes
// at the cursor, as the model editor's.
function FormulaField({
  label,
  hint,
  value,
  onChange,
  known,
  disabled = false,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  known: Known;
  disabled?: boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const issues = useMemo(
    () => (value.trim() ? checkFormula(value, known.map).issues : []),
    [value, known],
  );

  function insert(code: string) {
    const el = area.current;
    const text = referenceText(code);
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        {!disabled && (
          <select
            value=""
            onChange={(e) => e.target.value && insert(e.target.value)}
            className="max-w-48 rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-muted"
            aria-label={`Insert a code into the ${label.toLowerCase()}`}
          >
            <option value="">Insert code…</option>
            {known.options.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.codes.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label} ({c.code})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </div>
      <textarea
        ref={area}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        disabled={disabled}
        spellCheck={false}
        className={`${input} font-mono text-xs leading-5 ${issues.length ? "border-danger/60" : ""}`}
      />
      {issues.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {issues.map((issue, i) => (
            <li key={i} className="text-xs text-danger">
              {issue.message}
            </li>
          ))}
        </ul>
      ) : (
        hint && <span className="text-xs text-muted">{hint}</span>
      )}
    </div>
  );
}

function ReconcilesField({
  value,
  items,
  onChange,
}: {
  value: string;
  items: { code: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Field
      label="Part of (in the spread)"
      hint="The balance sheet item it's part of. Months ending on a spread period's end are checked against it."
    >
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={input}
      >
        <option value="">Nothing: not checked against the spread</option>
        {value && !items.some((i) => i.code === value) && (
          <option value={value}>{value}</option>
        )}
        {items.map((i) => (
          <option key={i.code} value={i.code}>
            {i.label} ({i.code})
          </option>
        ))}
      </select>
    </Field>
  );
}

function OutstandingForm({
  value,
  items,
  known,
  onApply,
  onClose,
}: {
  value: Outstanding;
  items: { code: string; label: string }[];
  known: Known;
  onApply: (value: Outstanding) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">
          Built in: the line&apos;s balance at each month&apos;s end, entered
          from the certificate as{" "}
          <span className="font-mono">BB_OUTSTANDING</span>. Usage adds the
          other usage lines to it.
        </p>
        <ReconcilesField
          value={draft.reconcilesWith}
          items={items}
          onChange={(reconcilesWith) => setDraft({ ...draft, reconcilesWith })}
        />
        <FormulaField
          label="Projection formula (optional)"
          hint="How analyses project the balance. Blank: the balance a year earlier plus the growth in collateral since."
          value={draft.projection}
          onChange={(projection) => setDraft({ ...draft, projection })}
          known={known}
        />
      </div>
      <DrawerFooter onClose={onClose} onApply={() => onApply(draft)} />
    </div>
  );
}

function DrawerFooter({
  onClose,
  onApply,
  onRemove,
}: {
  onClose: () => void;
  onApply: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-line px-5 py-3">
      {onRemove && (
        <button type="button" className={button.danger} onClick={onRemove}>
          <Trash2 />
          Remove
        </button>
      )}
      <div className="ml-auto flex gap-2">
        <button type="button" className={button.ghost} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={button.primary} onClick={onApply}>
          Apply
        </button>
      </div>
    </div>
  );
}

function TermField({
  label,
  hint,
  draft,
  name,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: string;
  draft: TermDraft;
  name: string;
  placeholder: string;
  onChange: (draft: TermDraft) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Field label={label} hint={hint}>
        <input
          value={draft.value}
          onChange={(e) => onChange({ ...draft, value: e.target.value })}
          placeholder={placeholder}
          inputMode="decimal"
          className={`${box} w-36 text-right tabular-nums`}
        />
      </Field>
      <TermChanges draft={draft} name={name} onChange={onChange} />
    </div>
  );
}

// A line's fields, by its kind (borrowing-base-plan.md §5.2), edited apart
// from the others until applied.
function LineDrawerForm({
  initial,
  isNew,
  drafts,
  items,
  currency,
  issues,
  onApply,
  onRemove,
  onClose,
}: {
  initial: LineDraft;
  isNew: boolean;
  drafts: LineDraft[];
  items: { code: string; label: string }[];
  currency: string | null;
  issues: Issue[];
  onApply: (draft: LineDraft) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [d, setD] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [reserve, setReserve] = useState<"entered" | "amount" | "formula">(
    initial.amount ? "amount" : initial.formula ? "formula" : "entered",
  );
  const set = (patch: Partial<LineDraft>) => setD({ ...d, ...patch });
  const others = drafts.filter((x) => x.key !== d.key);
  const known = knownCodes([...others, d], currency);
  const name = d.label || d.code || "The line";
  const ineligibles = drafts.filter(
    (x) => x.kind === "ineligible" && x.of === initial.code,
  ).length;

  function apply() {
    const code = d.code.trim().toUpperCase();
    const problem = !d.label.trim()
      ? "Give it a label."
      : !LINE_CODE.test(code)
        ? "Its code is a letter, then letters, digits or underscores, up to 40 (e.g. AR_CAD)."
        : code.startsWith("BB_") || code === "FX"
          ? "Codes starting with BB_, and FX, are the app's."
          : others.some((x) => x.code === code)
            ? `Another line has the code ${code}.`
            : d.kind === "ineligible" && !d.of
              ? "Choose the collateral line it reduces."
              : d.kind === "calculation" && !d.formula.trim()
                ? "Give it a formula."
                : null;
    setProblem(problem);
    if (problem) return;
    onApply({
      ...d,
      code,
      currency: d.currency.trim().toUpperCase(),
      ...(d.kind === "reserve"
        ? {
            amount: reserve === "amount" ? (d.amount ?? BLANK_TERM) : null,
            formula: reserve === "formula" ? d.formula : "",
          }
        : {}),
    });
  }

  async function remove() {
    const extra =
      d.kind === "collateral" && ineligibles
        ? `Its ${ineligibles} ineligible ${ineligibles === 1 ? "line goes" : "lines go"} with it. `
        : d.kind === "group"
          ? "Its collateral lines stay, in no group. "
          : "";
    if (
      await ask({
        title: `Remove ${name}?`,
        body: `${extra}Its figures stay in the months entered, unused. Formulas that read it will show an error.`,
        action: "Remove",
        danger: true,
      })
    )
      onRemove();
  }

  const collateral = drafts.filter((x) => x.kind === "collateral" && x.code);
  const groups = drafts.filter((x) => x.kind === "group" && x.code);
  const currencyField = (
    <Field
      label="Currency"
      hint={`Blank for the line's own${currency ? `, ${currency}` : ""}. Another is entered in its own currency and converted at each month's rate (FX.USD).`}
    >
      <input
        value={d.currency}
        onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
        placeholder={currency ?? "Line's"}
        maxLength={3}
        className={`${box} w-24`}
      />
    </Field>
  );
  const formatField = (
    <Field label="Shown as">
      <select
        value={d.format}
        onChange={(e) => set({ format: e.target.value as BorrowingBaseFormat })}
        className={input}
      >
        {Object.entries(FORMATS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </Field>
  );
  const projectionField = (
    <FormulaField
      label="Projection formula (optional)"
      hint="How analyses project it month by month. Blank: the same month a year earlier, or its share of its line."
      value={d.projection}
      onChange={(projection) => set({ projection })}
      known={known}
    />
  );
  const collateralType = (
    <Field label="Collateral type">
      <select
        value={d.collateral}
        onChange={(e) => set({ collateral: e.target.value as CollateralType })}
        className={input}
      >
        {Object.entries(COLLATERAL_TYPES).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </Field>
  );
  const capField = (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={d.cap !== null}
          onChange={(e) =>
            set({ cap: e.target.checked ? { ...BLANK_TERM } : null })
          }
        />
        A cap, in {currency ?? "the line's currency"}
      </label>
      {d.cap && (
        <TermField
          label="Cap"
          draft={d.cap}
          name={`${name}, cap`}
          placeholder="1,000,000"
          onChange={(cap) => set({ cap })}
        />
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">
          {LINE_KINDS[d.kind].help}
        </p>
        {issues.length > 0 && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft/40 p-3">
            <IssueList issues={issues} />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
          <Field label="Label">
            <input
              value={d.label}
              onChange={(e) => set({ label: e.target.value })}
              autoFocus={isNew}
              className={input}
            />
          </Field>
          <Field label="Code">
            <input
              value={d.code}
              onChange={(e) => set({ code: e.target.value.toUpperCase() })}
              spellCheck={false}
              placeholder="AR_CAD"
              className={`${input} font-mono`}
            />
          </Field>
        </div>
        {!isNew && initial.code && d.code !== initial.code && (
          <p className="-mt-2 text-xs text-muted">
            Lines, formulas and tests that use {initial.code} follow the new
            code, and so do the figures entered under it.
          </p>
        )}

        {d.kind === "collateral" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {collateralType}
              <Field label="Group">
                <select
                  value={d.group}
                  onChange={(e) => set({ group: e.target.value })}
                  className={input}
                >
                  <option value="">No group</option>
                  {groups.map((g) => (
                    <option key={g.key} value={g.code}>
                      {g.label} ({g.code})
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {currencyField}
            <TermField
              label="Advance rate"
              hint="Seasons differ every year; a step changes the rate from a month on, for an amendment. Months before keep the rate that applied to them."
              draft={d.rate}
              name={`${name}, advance rate`}
              placeholder="75%"
              onChange={(rate) => set({ rate })}
            />
            {capField}
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={d.aging !== null}
                  onChange={(e) =>
                    set({
                      aging: e.target.checked
                        ? {
                            buckets: DEFAULT_BUCKETS,
                            ineligibleFrom: DEFAULT_INELIGIBLE_FROM,
                          }
                        : null,
                    })
                  }
                />
                Aged: its amount is its aging buckets added up
              </label>
              {d.aging && (
                <AgingField
                  aging={d.aging}
                  name={name}
                  onChange={(aging) => set({ aging })}
                />
              )}
            </div>
            <ReconcilesField
              value={d.reconcilesWith}
              items={items}
              onChange={(reconcilesWith) => set({ reconcilesWith })}
            />
            {!d.aging && (
              <FormulaField
                label="Formula (optional)"
                hint="Its amount, instead of entering it each month."
                value={d.formula}
                onChange={(formula) => set({ formula })}
                known={known}
              />
            )}
            {projectionField}
          </>
        )}

        {d.kind === "group" && (
          <>
            {collateralType}
            {capField}
          </>
        )}

        {d.kind === "ineligible" && (
          <>
            <Field label="Reduces">
              <select
                value={d.of}
                onChange={(e) => set({ of: e.target.value })}
                className={input}
              >
                <option value="">Choose a collateral line</option>
                {collateral.map((x) => (
                  <option key={x.key} value={x.code}>
                    {x.label} ({x.code})
                  </option>
                ))}
              </select>
            </Field>
            <FormulaField
              label="Formula (optional)"
              hint="Blank: entered each month. E.g. 5% of the line: 0.05 * AR."
              value={d.formula}
              onChange={(formula) => set({ formula })}
              known={known}
            />
            {projectionField}
          </>
        )}

        {d.kind === "prior_claim" && (
          <>
            {currencyField}
            <FormulaField
              label="Formula (optional)"
              hint="Blank: entered each month."
              value={d.formula}
              onChange={(formula) => set({ formula })}
              known={known}
            />
            {projectionField}
          </>
        )}

        {d.kind === "reserve" && (
          <>
            <Field label="Its amount" group>
              <Segmented
                name="reserve"
                options={{
                  entered: "Entered",
                  amount: "Set amount",
                  formula: "Formula",
                }}
                value={reserve}
                onChange={(mode) => {
                  setReserve(mode);
                  if (mode === "amount" && !d.amount)
                    set({ amount: { ...BLANK_TERM } });
                }}
              />
            </Field>
            {reserve === "amount" && (
              <TermField
                label="Amount"
                draft={d.amount ?? BLANK_TERM}
                name={`${name}, amount`}
                placeholder="250,000"
                onChange={(amount) => set({ amount })}
              />
            )}
            {reserve === "formula" && (
              <FormulaField
                label="Formula"
                value={d.formula}
                onChange={(formula) => set({ formula })}
                known={known}
              />
            )}
            {projectionField}
          </>
        )}

        {d.kind === "usage" && (
          <>
            {currencyField}
            <ReconcilesField
              value={d.reconcilesWith}
              items={items}
              onChange={(reconcilesWith) => set({ reconcilesWith })}
            />
            {projectionField}
          </>
        )}

        {d.kind === "driver" && (
          <>
            {formatField}
            {projectionField}
          </>
        )}

        {d.kind === "assumption" && (
          <>
            {formatField}
            <Field
              label="Value"
              hint={
                d.format === "percent"
                  ? "A percent, such as 5%."
                  : "Analyses can override it."
              }
            >
              <input
                value={d.value}
                onChange={(e) => set({ value: e.target.value })}
                className={`${box} w-36 text-right tabular-nums`}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={d.byMonth !== null}
                onChange={(e) =>
                  set({
                    byMonth: e.target.checked
                      ? Array.from({ length: 12 }, () => d.value)
                      : null,
                  })
                }
              />
              One value per calendar month, for a seasonal profile
            </label>
            {d.byMonth && (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {MONTHS.map((month, i) => (
                  <Field key={month} label={month}>
                    <input
                      value={d.byMonth![i] ?? ""}
                      onChange={(e) =>
                        set({
                          byMonth: d.byMonth!.map((v, j) =>
                            j === i ? e.target.value : v,
                          ),
                        })
                      }
                      className={`${input} text-right tabular-nums`}
                    />
                  </Field>
                ))}
              </div>
            )}
          </>
        )}

        {d.kind === "calculation" && (
          <>
            {formatField}
            <FormulaField
              label="Formula"
              hint="E.g. days sales outstanding: IFERROR(AR / SALES * 30, 0)."
              value={d.formula}
              onChange={(formula) => set({ formula })}
              known={known}
            />
            {projectionField}
          </>
        )}

        <Field label="Description">
          <textarea
            rows={2}
            value={d.description}
            onChange={(e) => set({ description: e.target.value })}
            className={input}
          />
        </Field>
        {problem && <p className="text-sm text-danger">{problem}</p>}
      </div>
      <DrawerFooter
        onClose={onClose}
        onApply={apply}
        onRemove={isNew ? undefined : remove}
      />
    </div>
  );
}

function AgingField({
  aging,
  name,
  onChange,
}: {
  aging: { buckets: string[]; ineligibleFrom: number };
  name: string;
  onChange: (aging: { buckets: string[]; ineligibleFrom: number }) => void;
}) {
  const { buckets, ineligibleFrom } = aging;
  return (
    <div className="flex flex-col gap-2 border-l-2 border-line pl-3">
      <span className="text-xs font-medium text-muted">Buckets</span>
      {buckets.map((bucket, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-6 text-right text-xs text-muted tabular-nums">
            {i + 1}
          </span>
          <input
            value={bucket}
            aria-label={`${name}, bucket ${i + 1}`}
            onChange={(e) =>
              onChange({
                ...aging,
                buckets: buckets.map((b, j) => (j === i ? e.target.value : b)),
              })
            }
            className={`${box} w-44`}
          />
          {i >= ineligibleFrom && (
            <span className="text-xs text-danger">Ineligible</span>
          )}
          <button
            type="button"
            className={`${button.icon} ml-auto`}
            disabled={buckets.length <= 2}
            aria-label={`Remove the bucket ${bucket}`}
            onClick={() =>
              onChange({
                buckets: buckets.filter((_, j) => j !== i),
                ineligibleFrom: Math.min(
                  ineligibleFrom > i ? ineligibleFrom - 1 : ineligibleFrom,
                  buckets.length - 1,
                ),
              })
            }
          >
            <Trash2 />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={`${button.ghost} px-2 py-1 text-xs`}
          disabled={buckets.length >= 12}
          onClick={() =>
            onChange({ ...aging, buckets: [...buckets, "Over 150 days"] })
          }
        >
          <Icon name="plus" />
          Bucket
        </button>
        <Field label="Ineligible from">
          <select
            value={ineligibleFrom}
            onChange={(e) =>
              onChange({ ...aging, ineligibleFrom: Number(e.target.value) })
            }
            className={`${box} w-52`}
          >
            {buckets.slice(1).map((bucket, i) => (
              <option key={i} value={i + 1}>
                {bucket} and over
              </option>
            ))}
            <option value={buckets.length}>No bucket is ineligible</option>
          </select>
        </Field>
      </div>
    </div>
  );
}
