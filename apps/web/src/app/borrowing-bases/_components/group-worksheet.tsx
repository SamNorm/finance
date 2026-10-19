"use client";

import type { GroupMonth } from "@finance/domain";
import {
  GROUP_TOTALS,
  OVERRIDE_TOTALS,
  type GroupSummed,
  type GroupTotal,
} from "@finance/domain/borrowing-bases";
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { IssueList } from "@/components/issue-list";
import { Badge, Card } from "@/components/page";
import { button, input } from "@/components/styles";
import { Field, Icon } from "@/components/ui";
import {
  describeMonth,
  GROUP_FIGURES,
  memberFigures,
  type GroupFigureKey,
} from "@/lib/borrowing-bases";
import { formatFigure } from "@/lib/format";
import { setGroupAdjustmentsAction, setGroupOverrideAction } from "../actions";
import { sourceOf, type GroupMember } from "./group-results";

// A consolidated client's month side by side, as the consolidation
// worksheet lays out a period: each member line's totals, their sum, the
// adjustments, a certificate for the group when the client sends one, and
// the consolidated figures. The sum stays beside the certificate, so a gap
// shows.

const grouped = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });

// The input style without its full width, so fields keep their own.
const box = input.replace("w-full ", "");

const show = (value: number | string | null | undefined, format: string) =>
  value === null || value === undefined || value === ""
    ? ""
    : formatFigure(String(value), format as "amount" | "percent");

export function GroupWorksheet({
  entityId,
  months,
  members,
  initialMonth,
}: {
  entityId: string;
  months: GroupMonth[];
  members: GroupMember[];
  // From the URL, when a month was opened from the results.
  initialMonth?: string;
}) {
  const valid = (month: string | undefined) =>
    months.some((m) => m.month === month) ? month! : months.at(-1)?.month;
  const [month, setMonth] = useState(() => valid(initialMonth));
  // A link to another month moves to it.
  const [seen, setSeen] = useState(initialMonth);
  if (seen !== initialMonth) {
    setSeen(initialMonth);
    if (initialMonth && months.some((m) => m.month === initialMonth))
      setMonth(initialMonth);
  }
  const index = months.findIndex((m) => m.month === month);
  const current = months[index];
  if (!current)
    return (
      <p className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center text-sm text-muted">
        No months yet: the worksheet shows once members&apos; certificates are
        in.
      </p>
    );

  const sum = (key: GroupFigureKey) => current.sum[key] ?? null;
  const adjusted = (key: GroupFigureKey) => current.adjusted[key] ?? null;
  const override = current.override;
  // A certificate is compared with the sum as adjusted.
  const against = current.adjustments.length ? "adjusted sum" : "sum";
  const head =
    "sticky top-0 z-10 min-w-32 border-b border-l border-line bg-surface px-3 py-2 text-right align-bottom font-normal";

  return (
    <div className="flex flex-col gap-4">
      <Card flush>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <button
            type="button"
            className={button.icon}
            disabled={index <= 0}
            onClick={() => setMonth(months[index - 1]!.month)}
            aria-label="The month before"
          >
            <ChevronLeft />
          </button>
          <select
            aria-label="Month"
            value={current.month}
            onChange={(e) => setMonth(e.target.value)}
            className={`${box} w-44`}
          >
            {months.map((m) => (
              <option key={m.month} value={m.month}>
                {describeMonth(m.month)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={button.icon}
            disabled={index >= months.length - 1}
            onClick={() => setMonth(months[index + 1]!.month)}
            aria-label="The month after"
          >
            <ChevronRight />
          </button>
          <Badge tone={override ? "accent" : "muted"}>
            {sourceOf(current)}
          </Badge>
          {current.note && (
            <span className="text-sm text-muted">{current.note}</span>
          )}
        </div>
        {current.issues.length > 0 && (
          <div className="border-b border-line px-4 py-2.5">
            <IssueList issues={current.issues} />
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="sticky top-0 left-0 z-20 min-w-52 border-b border-line bg-surface px-4 py-2 text-left align-bottom font-medium">
                  Figure
                </th>
                {members.map((member) => {
                  const reported = current.members[member.key] !== undefined;
                  const totals = current.members[member.key];
                  return (
                    <th key={member.key} className={head}>
                      <Link
                        href={`/borrowing-bases/${member.lineId}`}
                        className="block font-medium text-foreground hover:text-accent hover:underline"
                      >
                        {member.name}
                      </Link>
                      {!reported
                        ? "Closed"
                        : totals
                          ? "Certificate"
                          : "No certificate"}
                    </th>
                  );
                })}
                <th className={head}>
                  <span className="block font-medium text-foreground">Sum</span>
                  Of the members
                </th>
                <th className={head}>
                  <span className="block font-medium text-foreground">
                    Adjustments
                  </span>
                  {current.adjustments.length || "None"}
                </th>
                {override && (
                  <th className={`${head} min-w-44 bg-accent-soft/40`}>
                    <span className="block font-medium text-foreground">
                      Group certificate
                    </span>
                    Gap with the {against} below
                  </th>
                )}
                <th className={`${head} bg-surface-2`}>
                  <span className="block font-medium text-foreground">
                    Consolidated
                  </span>
                  {sourceOf(current)}
                </th>
                <th className="sticky top-0 w-full border-b border-line bg-surface" />
              </tr>
            </thead>
            <tbody>
              {GROUP_FIGURES.map((row) => {
                const band =
                  row.kind === "total"
                    ? "font-semibold"
                    : row.kind === "subtotal"
                      ? "font-medium"
                      : "";
                const change =
                  row.format === "amount" &&
                  adjusted(row.key) !== null &&
                  sum(row.key) !== null
                    ? Number(adjusted(row.key)) - Number(sum(row.key))
                    : 0;
                const given = override?.[row.key as GroupSummed];
                const gap =
                  given !== undefined && adjusted(row.key) !== null
                    ? Number(given) - Number(adjusted(row.key))
                    : 0;
                const cell = "border-b border-l border-line/60 px-3 py-1";
                return (
                  <tr
                    key={row.key}
                    className={`${band} ${row.kind !== "line" ? "bg-surface-2/40" : ""}`}
                  >
                    <td className="sticky left-0 z-10 border-b border-line/60 bg-surface px-4 py-1 whitespace-nowrap">
                      {row.label}
                    </td>
                    {members.map((member) => {
                      const totals = current.members[member.key];
                      return (
                        <td
                          key={member.key}
                          className={`${cell} text-right tabular-nums ${totals ? "" : "bg-surface-2/50"}`}
                        >
                          {totals &&
                            show(memberFigures(totals)[row.key], row.format)}
                        </td>
                      );
                    })}
                    <td className={`${cell} text-right tabular-nums`}>
                      {show(sum(row.key), row.format)}
                    </td>
                    <td
                      className={`${cell} text-right tabular-nums ${change ? "" : "text-muted"}`}
                    >
                      {change ? show(change, "amount") : ""}
                    </td>
                    {override && (
                      <td
                        className={`${cell} bg-accent-soft/40 text-right tabular-nums`}
                      >
                        {given !== undefined && (
                          <>
                            {show(given, row.format)}
                            {gap !== 0 && (
                              <span className="block text-[11px] font-normal whitespace-nowrap text-muted">
                                {show(gap, "amount")} vs {against}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                    )}
                    <td
                      className={`${cell} bg-surface-2 text-right font-medium tabular-nums ${(row.key === "surplus" || row.key === "excess") && Number(current.consolidated[row.key]) < 0 ? "text-danger" : ""}`}
                    >
                      {show(current.consolidated[row.key], row.format)}
                    </td>
                    <td className="border-b border-line/60" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Adjustments
          key={`${current.month}:${JSON.stringify(current.adjustments)}`}
          entityId={entityId}
          month={current}
        />
        <Certificate
          key={`${current.month}:${JSON.stringify(current.override)}:${current.note}`}
          entityId={entityId}
          month={current}
        />
      </div>
    </div>
  );
}

interface AdjustmentDraft {
  key: string;
  id?: string;
  name: string;
  total: GroupTotal;
  amount: string;
}

let counter = 0;
const newKey = () => `adjustment-${++counter}`;

// A month's adjustments, as eliminations adjust a consolidated spread:
// named amounts on one of the group's totals, negative to reduce. They're
// saved together.
function Adjustments({
  entityId,
  month,
}: {
  entityId: string;
  month: GroupMonth;
}) {
  const initial = month.adjustments.map((a): AdjustmentDraft => ({
    key: a.id,
    id: a.id,
    name: a.name,
    total: a.total,
    amount: grouped.format(Number(a.amount)),
  }));
  const [drafts, setDrafts] = useState(initial);
  const [pending, startSave] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const dirty = JSON.stringify(drafts) !== JSON.stringify(initial);
  const update = (key: string, patch: Partial<AdjustmentDraft>) =>
    setDrafts(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  function save() {
    setFailure(null);
    startSave(async () => {
      const result = await setGroupAdjustmentsAction(
        entityId,
        month.month,
        drafts.map(({ id, name, total, amount }) => ({
          ...(id ? { id } : {}),
          name,
          total,
          amount,
        })),
      );
      if (!result.ok) setFailure(result.message);
    });
  }

  return (
    <Card
      title={`Adjustments, ${describeMonth(month.month)}`}
      description="Named amounts on one of the group's totals, negative to reduce, such as intercompany receivables. Collateral carries to the borrowing base; prior claims and reserves come off it."
    >
      <div className="flex flex-col gap-2">
        {drafts.length === 0 && (
          <p className="text-sm text-muted">No adjustments this month.</p>
        )}
        {drafts.map((d) => (
          <div key={d.key} className="flex flex-wrap items-center gap-2">
            <input
              value={d.name}
              onChange={(e) => update(d.key, { name: e.target.value })}
              placeholder="Due from an affiliate"
              aria-label="Adjustment"
              className={`${box} min-w-40 flex-1`}
            />
            <select
              value={d.total}
              onChange={(e) =>
                update(d.key, { total: e.target.value as GroupTotal })
              }
              aria-label={`${d.name || "Adjustment"}, total`}
              className={`${box} w-48`}
            >
              {GROUP_TOTALS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              value={d.amount}
              onChange={(e) => update(d.key, { amount: e.target.value })}
              placeholder="-45,000"
              inputMode="decimal"
              aria-label={`${d.name || "Adjustment"}, amount`}
              className={`${box} w-32 text-right tabular-nums`}
            />
            <button
              type="button"
              className={button.icon}
              aria-label={`Remove ${d.name || "the adjustment"}`}
              onClick={() => setDrafts(drafts.filter((x) => x.key !== d.key))}
            >
              <Trash2 />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            className={`${button.ghost} px-2 py-1 text-xs`}
            onClick={() =>
              setDrafts([
                ...drafts,
                {
                  key: newKey(),
                  name: "",
                  total: "receivables",
                  amount: "",
                },
              ])
            }
          >
            <Icon name="plus" />
            Adjustment
          </button>
          {dirty && (
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                className={button.ghost}
                onClick={() => setDrafts(initial)}
              >
                Discard
              </button>
              <button
                type="button"
                className={button.primary}
                disabled={pending}
                onClick={save}
              >
                {pending ? "Saving…" : "Save adjustments"}
              </button>
            </div>
          )}
        </div>
        {failure && <p className="text-sm text-danger">{failure}</p>}
      </div>
    </Card>
  );
}

// A certificate the client sends for the group, which is rarer: its totals
// replace the sum's that month; those left blank stay the sum's.
function Certificate({
  entityId,
  month,
}: {
  entityId: string;
  month: GroupMonth;
}) {
  const override = month.override;
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(override ?? {}).map(([key, value]) => [
        key,
        grouped.format(Number(value)),
      ]),
    ),
  );
  const [note, setNote] = useState(month.note ?? "");
  const [pending, startSave] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  function save(totals: Record<string, string> | null, text: string | null) {
    setFailure(null);
    startSave(async () => {
      const result = await setGroupOverrideAction(
        entityId,
        month.month,
        totals,
        text,
      );
      if (!result.ok) setFailure(result.message);
    });
  }

  function remove() {
    if (
      !confirm(
        `Remove the group certificate for ${describeMonth(month.month)}? The month goes back to the members' figures added up.`,
      )
    )
      return;
    save(null, null);
  }

  const given = Object.fromEntries(
    Object.entries(values).filter(([, v]) => v.trim()),
  );

  return (
    <Card
      title={`Group certificate, ${describeMonth(month.month)}`}
      description="When the client sends a certificate for the group: its totals replace the members' sum; the sum still shows beside them."
      actions={
        override &&
        !editing && (
          <>
            <button
              type="button"
              className={button.secondary}
              onClick={() => setEditing(true)}
            >
              <Pencil />
              Edit
            </button>
            <button
              type="button"
              className={button.danger}
              disabled={pending}
              onClick={remove}
            >
              <Trash2 />
              Remove
            </button>
          </>
        )
      }
    >
      {!override && !editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted">
            None this month: the group&apos;s figures are its members&apos;
            added up.
          </p>
          <button
            type="button"
            className={button.secondary}
            onClick={() => setEditing(true)}
          >
            <Icon name="plus" />
            Enter the group&apos;s certificate
          </button>
        </div>
      ) : !editing ? (
        <dl className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="text-xs text-muted">Total</dt>
          <dd className="text-right text-xs text-muted">Certificate</dd>
          <dd className="text-right text-xs text-muted">
            {month.adjustments.length ? "Adjusted sum" : "Sum"}
          </dd>
          {OVERRIDE_TOTALS.filter((t) => override?.[t.key] !== undefined).map(
            (t) => (
              <div key={t.key} className="contents">
                <dt>{t.label}</dt>
                <dd className="text-right font-medium tabular-nums">
                  {show(override![t.key], "amount")}
                </dd>
                <dd className="text-right text-muted tabular-nums">
                  {show(month.adjusted[t.key], "amount")}
                </dd>
              </div>
            ),
          )}
          {month.note && (
            <p className="col-span-3 pt-2 text-sm text-muted">{month.note}</p>
          )}
        </dl>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">
            Leave a total blank to keep the members&apos; sum, shown in grey.
            Without a borrowing base, it follows from the collateral less prior
            claims and reserves.
          </p>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {OVERRIDE_TOTALS.map((t) => (
              <label key={t.key} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{t.label}</span>
                <input
                  value={values[t.key] ?? ""}
                  onChange={(e) =>
                    setValues({ ...values, [t.key]: e.target.value })
                  }
                  placeholder={show(month.adjusted[t.key], "amount")}
                  inputMode="decimal"
                  className={`${box} w-36 text-right tabular-nums`}
                />
              </label>
            ))}
          </div>
          <Field label="Note">
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Received from the client's controller"
              className={input}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={button.ghost}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={button.primary}
              disabled={pending || !Object.keys(given).length}
              onClick={() => save(given, note)}
            >
              {pending ? "Saving…" : "Save certificate"}
            </button>
          </div>
        </div>
      )}
      {failure && <p className="mt-2 text-sm text-danger">{failure}</p>}
    </Card>
  );
}
