"use client";

import type {
  Consolidation,
  Issue,
  ScoringItem,
  Statement,
} from "@finance/domain";
import { ListPlus, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  startTransition,
  useActionState,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { IssueList } from "@/components/issue-list";
import { Popover } from "@/components/menu";
import { Card } from "@/components/page";
import { button, input, table } from "@/components/styles";
import { Field, Icon, keepFields, Modal } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";
import { formatDate, formatFigure } from "@/lib/format";
import { QUALITY_SHORT, STATEMENTS } from "@/lib/labels";
import {
  addConsolidationMemberAction,
  createConsolidatedClientAction,
  deletePeriodAction,
  removeConsolidationMemberAction,
  saveConsolidatedPeriodAction,
  setItemEliminationsAction,
} from "../actions";
import type { ScoringModelOption } from "./new-borrower";
import type { Checked } from "./period-dialog";
import { SpreadGrid, type GridPeriod } from "./spread-grid";

// A consolidated client's screens: it adds up other borrowers' statements on
// its scoring model, period by period, less eliminations of what they owe,
// sell or pay each other. Its figures are computed from the members', so
// nothing here is typed into the spread itself.

type Member = Consolidation["members"][number];
type MemberPeriod = Member["periods"][number];

// An input amount an elimination can change, and its balance sheet side.
export interface EliminableItem {
  code: string;
  label: string;
  statement: Statement;
  side: "assets" | "claims" | null;
}

// A member's statements as a choice: "Mar 31, 2025 · 12 mo · Review".
const periodLabel = (p: MemberPeriod) =>
  `${formatDate(p.periodEnd)} · ${p.months} mo · ${QUALITY_SHORT[p.quality]}${p.consolidated ? " · consolidated" : ""}`;

const months = (iso: string) => {
  const [year, month] = iso.split("-").map(Number) as [number, number];
  return year * 12 + month;
};

// The member's statements closest to a period: the same length, ending
// within six months of it, nearest first.
function closest(periods: MemberPeriod[], end: string, length: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const target = months(end);
  return (
    periods
      .filter(
        (p) =>
          p.months === length && Math.abs(months(p.periodEnd) - target) <= 6,
      )
      .sort(
        (a, b) =>
          Math.abs(months(a.periodEnd) - target) -
          Math.abs(months(b.periodEnd) - target),
      )[0] ?? null
  );
}

// "(1,250)" or "-1,250" as a number, for the balance shown while typing.
function typed(raw: string) {
  const text = raw.replace(/[\s,$]/g, "");
  const negative = /^\(.*\)$/.test(text);
  const n = Number(negative ? text.slice(1, -1) : text);
  return Number.isFinite(n) ? (negative ? -n : n) : 0;
}

export function NewConsolidatedClient({
  scoringModels,
  borrowers,
}: {
  scoringModels: ScoringModelOption[];
  borrowers: { id: string; name: string; scoringModelId: string }[];
}) {
  const [open, setOpen] = useState(false);
  const published = scoringModels.filter((m) => m.published);
  const [modelId, setModelId] = useState(published[0]?.id ?? "");
  const [state, formAction, pending] = useActionState(
    async (_: ActionResult | null, form: FormData) =>
      createConsolidatedClientAction(form),
    null,
  );
  const candidates = borrowers.filter((b) => b.scoringModelId === modelId);
  return (
    <>
      <button
        type="button"
        className={button.secondary}
        onClick={() => setOpen(true)}
        disabled={borrowers.length < 2}
        title={
          borrowers.length < 2
            ? "Add the borrowers it adds up first."
            : "Add up several borrowers' statements, when there are no consolidated statements from the accountant."
        }
      >
        <Icon name="plus" />
        Consolidated client
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New consolidated client"
      >
        <form
          onSubmit={keepFields(formAction)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            <p className="text-sm text-muted">
              Adds up other borrowers&apos; statements period by period, less
              what they owe, sell or pay each other. Use it when there are no
              consolidated statements from the accountant. Its figures follow
              the members&apos; as they change.
            </p>
            <Field label="Name">
              <input
                name="name"
                required
                autoFocus
                placeholder="Northwind group"
                className={input}
              />
            </Field>
            <Field
              label="Scoring model"
              hint="Its members follow the same one."
            >
              <select
                name="scoringModelId"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className={input}
              >
                {published.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Members" group>
              {candidates.length ? (
                <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto rounded-md border border-line p-2.5">
                  {candidates.map((b) => (
                    <label
                      key={b.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input type="checkbox" name="memberIds" value={b.id} />
                      {b.name}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">
                  No borrowers on this scoring model yet.
                </p>
              )}
            </Field>
            <Field label="Industry (optional)">
              <input name="industry" className={input} />
            </Field>
            <Field label="Notes (optional)">
              <textarea name="notes" rows={2} className={input} />
            </Field>
            {state && !state.ok && (
              <p className="text-sm text-danger">{state.message}</p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button
              type="button"
              className={button.ghost}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" disabled={pending} className={button.primary}>
              {pending ? "Creating…" : "Create consolidated client"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

// The consolidated spread, read only, with a dialog per period for what it
// adds up and eliminates.
export function ConsolidatedSpread({
  entityId,
  items,
  periods,
  values,
  computed,
  checks,
  checked,
  statement,
  consolidation,
  eliminable,
}: {
  entityId: string;
  items: ScoringItem[];
  periods: GridPeriod[];
  values: Record<string, Record<string, string>>;
  computed: Record<string, Record<string, string>>;
  checks: Record<string, Issue[]>;
  checked: Checked;
  statement: Statement;
  consolidation: Consolidation;
  eliminable: EliminableItem[];
}) {
  // Undefined when closed, null for a new period.
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const period = open ? periods.find((p) => p.id === open) : undefined;
  return (
    <>
      <SpreadGrid
        entityId={entityId}
        items={items}
        periods={periods}
        values={values}
        computed={computed}
        checks={checks}
        checked={checked}
        statement={statement}
        consolidated={{ onPeriod: setOpen }}
      />
      <Modal
        open={open !== undefined}
        onClose={() => setOpen(undefined)}
        wide
        title={
          period
            ? `Period ending ${formatDate(period.periodEnd)}`
            : "Add consolidated period"
        }
      >
        {open !== undefined && (
          <PeriodForm
            key={open ?? "new"}
            entityId={entityId}
            period={period ?? null}
            detail={open ? (consolidation.periods[open] ?? null) : null}
            members={consolidation.members}
            eliminable={eliminable}
            checked={checked}
            checks={open ? (checks[open] ?? []) : []}
            onClose={() => setOpen(undefined)}
          />
        )}
      </Modal>
    </>
  );
}

let counter = 0;
const newKey = () => `entry-${++counter}`;

function PeriodForm({
  entityId,
  period,
  detail,
  members,
  eliminable,
  checked,
  checks,
  onClose,
}: {
  entityId: string;
  period: GridPeriod | null;
  detail: Consolidation["periods"][string] | null;
  members: Member[];
  eliminable: EliminableItem[];
  checked: Checked;
  checks: Issue[];
  onClose: () => void;
}) {
  const [end, setEnd] = useState(period?.periodEnd ?? "");
  const [length, setLength] = useState(String(period?.months ?? 12));
  // Statements chosen by hand; the others follow the period's end.
  const [chosen, setChosen] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(
      (detail?.statements ?? []).map((s) => [s.memberId, s.periodId]),
    ),
  );
  const [eliminations, setEliminations] = useState(() =>
    (detail?.eliminations ?? []).map((e) => ({
      key: e.id,
      id: e.id as string | undefined,
      name: e.name,
      item: e.item,
      amount: formatFigure(e.amount, "amount"),
    })),
  );
  const [lines, setLines] = useState(() =>
    (period?.reconciliation ?? []).map((l) => ({
      key: l.id,
      id: l.id as string | undefined,
      label: l.label,
      amount: formatFigure(l.amount, "amount"),
    })),
  );
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  const statementOf = (member: Member) =>
    member.id in chosen
      ? (chosen[member.id] ?? null)
      : period
        ? null
        : (closest(member.periods, end, Number(length))?.id ?? null);
  const sides = new Map(eliminable.map((i) => [i.code, i.side]));
  const change = { assets: 0, claims: 0 };
  for (const e of eliminations) {
    const side = sides.get(e.item);
    if (side) change[side] += typed(e.amount);
  }
  const balanced = Math.abs(change.assets - change.claims) < 1;

  function save() {
    setFailure(null);
    startSave(async () => {
      const result = await saveConsolidatedPeriodAction(
        entityId,
        period?.id ?? null,
        {
          periodEnd: end,
          months: length,
          statements: members.map((m) => ({
            memberId: m.id,
            periodId: statementOf(m),
          })),
          eliminations: eliminations.map(({ id, name, item, amount }) => ({
            id,
            name,
            item,
            amount,
          })),
          reconciliation: lines.map(({ id, label, amount }) => ({
            id,
            label,
            amount,
          })),
        },
      );
      if (result.ok) startTransition(onClose);
      else setFailure(result.message);
    });
  }

  function remove() {
    if (
      !period ||
      !confirm(
        `Delete the period ending ${formatDate(period.periodEnd)}? The members' statements stay.`,
      )
    )
      return;
    startDelete(async () => {
      const result = await deletePeriodAction(period.id);
      if (result.ok) startTransition(onClose);
      else setFailure(result.message);
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Period end">
            <input
              type="date"
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className={input}
            />
          </Field>
          <Field label="Months covered">
            <input
              type="number"
              min={1}
              max={24}
              required
              value={length}
              onChange={(e) => setLength(e.target.value)}
              className={input}
            />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">
            Statements it adds up
            <span className="ml-2 text-xs font-normal text-muted">
              One set per member, on the same scoring model version. They can
              end on other dates; more than six months from the period is
              flagged. Its quality is the weakest statements&apos;.
            </span>
          </legend>
          {members.map((member) => (
            <label
              key={member.id}
              className="grid items-center gap-2 text-sm sm:grid-cols-[minmax(0,14rem)_1fr]"
            >
              <span className="truncate font-medium">{member.name}</span>
              <select
                value={statementOf(member) ?? ""}
                onChange={(e) =>
                  setChosen((c) => ({
                    ...c,
                    [member.id]: e.target.value || null,
                  }))
                }
                className={input}
              >
                <option value="">None</option>
                {member.periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {periodLabel(p)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">
            Eliminations
            <span className="ml-2 text-xs font-normal text-muted">
              What the members owe, sell or pay each other, taken out of both
              sides: negative amounts reduce an item. Balance sheet ones must
              balance.
            </span>
          </legend>
          {eliminations.map((e) => {
            const set = (patch: Partial<typeof e>) =>
              setEliminations((list) =>
                list.map((x) => (x.key === e.key ? { ...x, ...patch } : x)),
              );
            return (
              <div key={e.key} className="flex flex-wrap items-center gap-2">
                <input
                  aria-label="Name"
                  placeholder="Intercompany rent"
                  value={e.name}
                  onChange={(ev) => set({ name: ev.target.value })}
                  className={`${input} min-w-40 flex-1`}
                />
                <select
                  aria-label="Item"
                  value={e.item}
                  onChange={(ev) => set({ item: ev.target.value })}
                  className={`${input} min-w-48 flex-1`}
                >
                  <option value="">Choose the item…</option>
                  {STATEMENTS.map(({ value, label }) => {
                    const options = eliminable.filter(
                      (i) => i.statement === value,
                    );
                    return options.length ? (
                      <optgroup key={value} label={label}>
                        {options.map((i) => (
                          <option key={i.code} value={i.code}>
                            {i.label}
                          </option>
                        ))}
                      </optgroup>
                    ) : null;
                  })}
                </select>
                <input
                  aria-label="Amount"
                  placeholder="(120,000)"
                  inputMode="decimal"
                  value={e.amount}
                  onChange={(ev) => set({ amount: ev.target.value })}
                  className={`${input} w-36 shrink-0 text-right tabular-nums`}
                />
                <button
                  type="button"
                  className={button.icon}
                  aria-label={`Remove ${e.name || "the elimination"}`}
                  onClick={() =>
                    setEliminations((list) =>
                      list.filter((x) => x.key !== e.key),
                    )
                  }
                >
                  <Trash2 />
                </button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={button.ghost}
              onClick={() =>
                setEliminations((list) => [
                  ...list,
                  {
                    key: newKey(),
                    id: undefined,
                    name: "",
                    item: "",
                    amount: "",
                  },
                ])
              }
            >
              <Icon name="plus" />
              Elimination
            </button>
            {(change.assets !== 0 || change.claims !== 0) && (
              <span
                className={`text-xs ${balanced ? "text-muted" : "text-danger"}`}
              >
                {balanced
                  ? "Balance sheet eliminations balance."
                  : `Assets change by ${formatFigure(String(change.assets), "amount")}, liabilities and equity by ${formatFigure(String(change.claims), "amount")}.`}
              </span>
            )}
          </div>
        </fieldset>

        {checked.retainedEarnings && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">
              Retained earnings reconciliation
              <span className="ml-2 text-xs font-normal text-muted">
                The members&apos; lines count, then the group&apos;s own, such
                as an intercompany dividend taken out of income.
              </span>
            </legend>
            {detail?.memberReconciliation.map((line, i) => (
              <p
                key={i}
                className="flex justify-between gap-2 text-sm text-muted"
              >
                <span>{line.label}</span>
                <span className="tabular-nums">
                  {formatFigure(line.amount, "amount")}
                </span>
              </p>
            ))}
            {lines.map((line) => (
              <div key={line.key} className="flex items-center gap-2">
                <input
                  aria-label="Label"
                  placeholder="Intercompany dividend"
                  value={line.label}
                  onChange={(e) =>
                    setLines((list) =>
                      list.map((l) =>
                        l.key === line.key
                          ? { ...l, label: e.target.value }
                          : l,
                      ),
                    )
                  }
                  className={input}
                />
                <input
                  aria-label="Amount"
                  inputMode="decimal"
                  value={line.amount}
                  onChange={(e) =>
                    setLines((list) =>
                      list.map((l) =>
                        l.key === line.key
                          ? { ...l, amount: e.target.value }
                          : l,
                      ),
                    )
                  }
                  className={`${input} w-36 shrink-0 text-right tabular-nums`}
                />
                <button
                  type="button"
                  className={button.icon}
                  aria-label={`Remove ${line.label || "the line"}`}
                  onClick={() =>
                    setLines((list) => list.filter((l) => l.key !== line.key))
                  }
                >
                  <Trash2 />
                </button>
              </div>
            ))}
            <div>
              <button
                type="button"
                className={button.ghost}
                onClick={() =>
                  setLines((list) => [
                    ...list,
                    { key: newKey(), id: undefined, label: "", amount: "" },
                  ])
                }
              >
                <Icon name="plus" />
                Line
              </button>
            </div>
          </fieldset>
        )}

        {checks.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <p className="text-sm font-medium">Checks</p>
            <IssueList issues={checks} />
          </div>
        )}
        {failure && <p className="text-sm text-danger">{failure}</p>}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        {period && (
          <button
            type="button"
            className={button.danger}
            onClick={remove}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete period"}
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" className={button.ghost} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={button.primary}
            onClick={save}
            disabled={saving || !end}
          >
            {saving ? "Saving…" : period ? "Save" : "Add period"}
          </button>
        </div>
      </div>
    </div>
  );
}

// The borrowers the client adds up, and those it could.
export function Members({
  entityId,
  members,
  candidates,
}: {
  entityId: string;
  members: {
    id: string;
    name: string;
    periods: number;
    latest: string | null;
  }[];
  candidates: { id: string; name: string }[];
}) {
  const [adding, setAdding] = useState(candidates[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const act = (work: () => Promise<ActionResult>) => {
    setFailure(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) setFailure(result.message);
    });
  };
  return (
    <Card
      flush
      title="Members"
      description="Borrowers on the same scoring model. Each stays a borrower in its own right; its figures and existing loans are entered on its page."
      actions={
        candidates.length > 0 && (
          <>
            <select
              aria-label="Borrower to add"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              className={`${input} w-56`}
            >
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={button.secondary}
              disabled={pending || !adding}
              onClick={() =>
                act(() => addConsolidationMemberAction(entityId, adding))
              }
            >
              <Icon name="plus" />
              Add member
            </button>
          </>
        )
      }
    >
      {failure && (
        <p className="border-b border-line px-4 py-2 text-sm text-danger">
          {failure}
        </p>
      )}
      {members.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">No members yet.</p>
      ) : (
        <table className={table.table}>
          <thead>
            <tr className={table.head}>
              <th className={table.th}>Member</th>
              <th className={`${table.th} text-right`}>Periods</th>
              <th className={`${table.th} text-right`}>Latest period</th>
              <th className={table.th} />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr
                key={m.id}
                className="border-b border-line/70 last:border-b-0"
              >
                <td className={table.td}>
                  <Link
                    href={`/borrowers/${m.id}`}
                    className="font-medium hover:text-accent"
                  >
                    {m.name}
                  </Link>
                </td>
                <td className={`${table.td} text-right tabular-nums`}>
                  {m.periods}
                </td>
                <td
                  className={`${table.td} text-right text-muted tabular-nums`}
                >
                  {m.latest ? formatDate(m.latest) : "None"}
                </td>
                <td className={`${table.td} w-10`}>
                  <button
                    type="button"
                    className={button.icon}
                    aria-label={`Remove ${m.name}`}
                    disabled={pending}
                    onClick={() => {
                      if (
                        confirm(
                          `Remove ${m.name} and its statements from every period? It stays a borrower.`,
                        )
                      )
                        act(() =>
                          removeConsolidationMemberAction(entityId, m.id),
                        );
                    }}
                  >
                    <Trash2 />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// One period item by item: each member's figure, what's eliminated, and the
// consolidated figure. Eliminations are typed in their column, an item at a
// time; members' figures are changed on their own spreads.
export function Worksheet({
  entityId,
  items,
  periods,
  values,
  computed,
  checks,
  checked,
  consolidation,
  eliminable,
}: {
  entityId: string;
  items: ScoringItem[];
  periods: GridPeriod[];
  values: Record<string, Record<string, string>>;
  computed: Record<string, Record<string, string>>;
  checks: Record<string, Issue[]>;
  checked: Checked;
  consolidation: Consolidation;
  eliminable: EliminableItem[];
}) {
  const [periodId, setPeriodId] = useState(periods.at(-1)?.id ?? null);
  const [statement, setStatement] = useState<Statement>("balance_sheet");
  const [editing, setEditing] = useState(false);
  const names = useMemo(
    () => new Map(consolidation.members.map((m) => [m.id, m.name])),
    [consolidation.members],
  );
  const sides = useMemo(
    () => new Map(eliminable.map((i) => [i.code, i.side])),
    [eliminable],
  );
  const detail = periodId ? consolidation.periods[periodId] : undefined;
  const period = periods.find((p) => p.id === periodId);
  if (!periodId || !detail || !period)
    return (
      <p className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center text-sm text-muted">
        Add a period to see what it adds up.
      </p>
    );
  const rows = items.filter(
    (i) => i.statement === statement && i.kind !== "header",
  );
  const total = (code: string) =>
    values[periodId]?.[code] ?? computed[periodId]?.[code];
  const change = { assets: 0, claims: 0 };
  for (const e of detail.eliminations) {
    const side = sides.get(e.item);
    if (side) change[side] += Number(e.amount);
  }
  const balanced = Math.abs(change.assets - change.claims) < 1;
  const issues = checks[periodId] ?? [];
  return (
    <Card flush>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <select
          aria-label="Period"
          value={periodId}
          onChange={(e) => setPeriodId(e.target.value)}
          className={`${input} w-56`}
        >
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {formatDate(p.periodEnd)} · {p.months} mo
            </option>
          ))}
        </select>
        <button
          type="button"
          className={button.secondary}
          onClick={() => setEditing(true)}
          title="Its end, the members' statements it adds up, and every elimination by name"
        >
          <Pencil />
          Edit period
        </button>
        <nav className="ml-auto flex overflow-x-auto" aria-label="Statements">
          {STATEMENTS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={value === statement}
              onClick={() => setStatement(value)}
              className="rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted hover:text-foreground aria-pressed:bg-surface-2 aria-pressed:font-medium aria-pressed:text-foreground"
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      <div className="flex flex-col gap-2 border-b border-line px-4 py-2.5 text-sm">
        <p className="text-muted">
          Type an elimination in its column, negative to reduce the item, and
          the consolidated figure follows.{" "}
          {change.assets !== 0 || change.claims !== 0 ? (
            <span className={balanced ? "" : "font-medium text-danger"}>
              {balanced
                ? "Balance sheet eliminations balance."
                : `Balance sheet eliminations change assets by ${formatFigure(String(change.assets), "amount")} but liabilities and equity by ${formatFigure(String(change.claims), "amount")}.`}
            </span>
          ) : null}
        </p>
        {issues.length > 0 && <IssueList issues={issues} limit={4} />}
      </div>
      <div className="max-h-[min(78vh,64rem)] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="sticky top-0 left-0 z-20 min-w-56 border-b border-line bg-surface px-4 py-2 text-left font-medium">
                Line
              </th>
              {detail.statements.map((s) => (
                <th
                  key={s.memberId}
                  className="sticky top-0 z-10 min-w-36 border-b border-l border-line bg-surface px-3 py-2 text-right font-normal"
                >
                  <span className="block font-medium text-foreground">
                    {names.get(s.memberId)}
                  </span>
                  {formatDate(s.periodEnd)} · {s.months} mo
                </th>
              ))}
              <th className="sticky top-0 z-10 min-w-32 border-b border-l border-line bg-surface px-3 py-2 text-right font-medium">
                Eliminations
              </th>
              <th className="sticky top-0 z-10 min-w-36 border-b border-l border-line bg-surface px-3 py-2 text-right font-medium text-foreground">
                Consolidated
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const consolidated = total(item.code);
              const figures = detail.statements.map(
                (s) => s.figures[item.code],
              );
              if (consolidated === undefined && figures.every((f) => !f))
                return null;
              const additive =
                item.dataType === "amount" || item.dataType === "count";
              const eliminated =
                additive && consolidated !== undefined
                  ? figures.reduce(
                      (rest, f) => rest - (f ? Number(f) : 0),
                      Number(consolidated),
                    )
                  : 0;
              const subtotal = item.kind === "subtotal";
              return (
                <tr
                  key={item.code}
                  className={subtotal ? "bg-surface-2/60 font-medium" : ""}
                >
                  <td
                    title={item.code}
                    className={`sticky left-0 z-10 border-b border-line/60 px-4 py-1.5 ${subtotal ? "bg-surface-2" : "bg-surface"}`}
                  >
                    {item.label}
                  </td>
                  {figures.map((f, i) => (
                    <td
                      key={i}
                      className="border-b border-l border-line/60 px-3 py-1.5 text-right tabular-nums"
                    >
                      {f ? formatFigure(f, item.dataType) : ""}
                    </td>
                  ))}
                  {sides.has(item.code) ? (
                    <EliminationCell
                      key={`${periodId}:${item.code}`}
                      periodId={periodId}
                      item={item}
                      eliminations={detail.eliminations.filter(
                        (e) => e.item === item.code,
                      )}
                    />
                  ) : (
                    <td className="border-b border-l border-line/60 px-3 py-1.5 text-right text-muted tabular-nums">
                      {Math.abs(eliminated) >= 0.005
                        ? formatFigure(String(eliminated), item.dataType)
                        : ""}
                    </td>
                  )}
                  <td className="border-b border-l border-line/60 px-3 py-1.5 text-right font-medium tabular-nums">
                    {consolidated === undefined
                      ? ""
                      : formatFigure(consolidated, item.dataType)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        wide
        title={`Period ending ${formatDate(period.periodEnd)}`}
      >
        {editing && (
          <PeriodForm
            entityId={entityId}
            period={period}
            detail={detail}
            members={consolidation.members}
            eliminable={eliminable}
            checked={checked}
            checks={issues}
            onClose={() => setEditing(false)}
          />
        )}
      </Modal>
    </Card>
  );
}

type Elimination = Consolidation["periods"][string]["eliminations"][number];

// An item's eliminations in the worksheet. With none or one, the amount is
// typed in place, as in the spread: Enter moves down, Escape cancels, and a
// blank removes it. The list opens beside it, for names and for several on
// one item, such as rent and management fees both out of revenue.
function EliminationCell({
  periodId,
  item,
  eliminations,
}: {
  periodId: string;
  item: ScoringItem;
  eliminations: Elimination[];
}) {
  const single = eliminations.length <= 1;
  const current = eliminations[0];
  const total = eliminations.reduce((sum, e) => sum + Number(e.amount), 0);
  const [draft, setDraft] = useState<string | null>(null);
  const [shown, setShown] = useOptimistic(
    eliminations.length ? String(total) : "",
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const cancelled = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  // The raw amount replaces the formatted one on focus, which drops the
  // selection: select it again once it's in, and keep the mouseup that
  // follows a click from collapsing it, so typing replaces the amount.
  const selectOnEdit = useRef(false);
  const keepSelection = useRef(false);
  useLayoutEffect(() => {
    if (draft !== null && selectOnEdit.current) {
      selectOnEdit.current = false;
      keepSelection.current = true;
      field.current?.select();
    }
  }, [draft]);

  function save(entries: { id?: string; name?: string; amount: string }[]) {
    startTransition(async () => {
      const amount = entries.reduce((sum, e) => sum + typed(e.amount), 0);
      setShown(entries.some((e) => e.amount.trim()) ? String(amount) : "");
      const result = await setItemEliminationsAction(
        periodId,
        item.code,
        entries,
      );
      setFailure(result.ok ? null : result.message);
    });
  }

  function commit() {
    const raw = (draft ?? "").trim();
    setDraft(null);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (raw === (current?.amount ?? "")) return;
    save([{ id: current?.id, name: current?.name, amount: raw }]);
  }

  function move(from: HTMLInputElement, step: number) {
    const cells = [
      ...document.querySelectorAll<HTMLInputElement>("input[data-elimination]"),
    ];
    cells[cells.indexOf(from) + step]?.focus();
  }

  return (
    <td
      className={`border-b border-l border-line/60 p-0 ${failure ? "ring-2 ring-danger/60 ring-inset" : ""}`}
    >
      <div className="group flex items-center">
        <Popover
          align="end"
          width="w-[26rem]"
          trigger={
            <button
              type="button"
              aria-label={`${item.label}: eliminations by name`}
              title={
                eliminations.map((e) => e.name).join(", ") ||
                "Name it, or add several"
              }
              className={`${button.icon} ml-1 shrink-0 ${single ? "opacity-0 group-hover:opacity-100 focus:opacity-100" : ""}`}
            >
              <ListPlus />
            </button>
          }
        >
          <ItemEliminations
            key={eliminations.map((e) => `${e.id}${e.name}${e.amount}`).join()}
            item={item}
            eliminations={eliminations}
            onSave={save}
          />
        </Popover>
        {single ? (
          <input
            data-elimination
            value={draft ?? (shown === "" ? "" : formatFigure(shown, "amount"))}
            title={failure ?? current?.name ?? "Type an amount to eliminate"}
            aria-label={`${item.label}, elimination`}
            ref={field}
            onFocus={() => {
              selectOnEdit.current = true;
              setDraft(current?.amount ?? "");
            }}
            onMouseUp={(e) => {
              if (keepSelection.current) e.preventDefault();
              keepSelection.current = false;
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              keepSelection.current = false;
              if (e.key === "Enter") {
                e.preventDefault();
                move(e.currentTarget, e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                cancelled.current = true;
                e.currentTarget.blur();
              }
            }}
            className="h-8 w-full min-w-0 bg-transparent px-3 text-right text-muted tabular-nums outline-none focus:bg-accent-soft/60 focus:text-foreground"
          />
        ) : (
          <span
            title={failure ?? eliminations.map((e) => e.name).join(", ")}
            className="h-8 w-full px-3 text-right leading-8 text-muted tabular-nums"
          >
            {formatFigure(shown, "amount")}
          </span>
        )}
      </div>
    </td>
  );
}

// An item's eliminations by name, saved together.
function ItemEliminations({
  item,
  eliminations,
  onSave,
}: {
  item: ScoringItem;
  eliminations: Elimination[];
  onSave: (entries: { id?: string; name: string; amount: string }[]) => void;
}) {
  const [rows, setRows] = useState(() =>
    eliminations.length
      ? eliminations.map((e) => ({
          key: e.id,
          id: e.id as string | undefined,
          name: e.name,
          amount: formatFigure(e.amount, "amount"),
        }))
      : [{ key: newKey(), id: undefined, name: "", amount: "" }],
  );
  const set = (key: string, patch: Partial<(typeof rows)[number]>) =>
    setRows((list) =>
      list.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium">{item.label}</p>
        <p className="text-xs text-muted">
          Eliminations on this line, negative to reduce it. A blank amount
          removes one.
        </p>
      </div>
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-2">
          <input
            aria-label="Name"
            placeholder={`Intercompany ${item.label.toLowerCase()}`}
            value={row.name}
            onChange={(e) => set(row.key, { name: e.target.value })}
            className={`${input} min-w-0 flex-1`}
          />
          <input
            aria-label="Amount"
            placeholder="(120,000)"
            inputMode="decimal"
            value={row.amount}
            onChange={(e) => set(row.key, { amount: e.target.value })}
            className={`${input} w-32 shrink-0 text-right tabular-nums`}
          />
          <button
            type="button"
            className={button.icon}
            aria-label={`Remove ${row.name || "the elimination"}`}
            onClick={() =>
              setRows((list) => list.filter((r) => r.key !== row.key))
            }
          >
            <Trash2 />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={button.ghost}
          onClick={() =>
            setRows((list) => [
              ...list,
              { key: newKey(), id: undefined, name: "", amount: "" },
            ])
          }
        >
          <Icon name="plus" />
          Elimination
        </button>
        <button
          type="button"
          className={`${button.primary} ml-auto`}
          onClick={() =>
            onSave(rows.map(({ id, name, amount }) => ({ id, name, amount })))
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}
