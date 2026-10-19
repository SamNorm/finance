"use client";

import {
  ADJUSTMENTS,
  amortize,
  describeTerms,
  monthIndex,
  monthOf,
  PAYMENTS_PER_YEAR,
  type Adjustment,
  type Amortizing,
  type Payment,
} from "@finance/domain/amortization";
import { Dec } from "@finance/engine";
import { useId, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";
import { formatDate } from "@/lib/format";
import { button, input } from "./styles";
import { Field, Icon, Modal, Segmented } from "./ui";

// A loan's payment schedule, worked out in the browser when it opens, from
// the loan as saved: each payment, or each year of the loan, with what's paid
// and what's still owed. Picking a payment adjusts the schedule from it with
// an extra payment, a payment change or skipped payments, previewed as typed
// and saved with the loan.

type Amount = InstanceType<typeof Dec>;

const cents = new Intl.NumberFormat("en-CA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (value: Amount) => cents.format(Number(value.toFixed(2)));
const grouped = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });
const monthFormat = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const monthLabel = (index: number) =>
  monthFormat.format(new Date(`${monthOf(index)}-01T00:00:00Z`));

// An adjustment as typed; fields its kind doesn't use stay blank.
interface Draft {
  key: string;
  id?: string;
  kind: Adjustment["kind"];
  date: string;
  amount: string;
  until: string;
  payments: string;
  suspends: "principal" | "full";
  keep: "payment" | "end";
}

let counter = 0;
const newKey = () => `adjustment-${++counter}`;

const toDraft = (a: Adjustment): Draft => ({
  key: a.id,
  id: a.id,
  kind: a.kind,
  date: a.date,
  amount: a.kind === "skip" ? "" : grouped.format(Number(a.amount)),
  until: a.kind === "payment" ? (a.until ?? "") : "",
  payments: a.kind === "skip" ? String(a.payments) : "",
  suspends: a.kind === "skip" ? a.suspends : "principal",
  keep: a.kind === "payment" ? "payment" : a.keep,
});

// The fields the server reads.
const toInput = (d: Draft) => ({
  id: d.id,
  kind: d.kind,
  date: d.date,
  ...(d.kind === "extra"
    ? { amount: d.amount, keep: d.keep }
    : d.kind === "payment"
      ? { amount: d.amount, until: d.until }
      : { payments: d.payments, suspends: d.suspends, keep: d.keep }),
});

export type AdjustmentInput = ReturnType<typeof toInput>;

// "10,000" → 10000.
const typed = (raw: string) => Number(raw.replace(/[^\d.-]/g, ""));

// The adjustment a draft stands for, to preview it; null while incomplete.
function previewOf(d: Draft, start: string): Adjustment | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || d.date <= start) return null;
  const base = { id: d.key, date: d.date };
  if (d.kind === "skip") {
    const payments = Number(d.payments);
    if (!Number.isInteger(payments) || payments < 1) return null;
    return {
      ...base,
      kind: "skip",
      payments,
      suspends: d.suspends,
      keep: d.keep,
    };
  }
  const amount = typed(d.amount);
  if (!(amount > 0)) return null;
  if (d.kind === "extra")
    return { ...base, kind: "extra", amount: String(amount), keep: d.keep };
  if (d.until && d.until < d.date) return null;
  return {
    ...base,
    kind: "payment",
    amount: String(amount),
    until: d.until || null,
  };
}

const KEEP_EXTRA = {
  payment: "Same payment, finish sooner",
  end: "Same end, lower payment",
};
const KEEP_SKIP = {
  payment: "Same payment, end later",
  end: "Same end, higher payment",
};
const SUSPENDS = {
  principal: "Principal only",
  full: "Principal and interest",
};

// A button that opens the loan's schedule from `start`, the date its balance
// is known at (an existing loan's date, a new loan's closing). With `save`,
// the schedule can be adjusted; `blocked` says why saving has to wait.
export function LoanSchedule({
  name,
  loan,
  start,
  className,
  children,
  save,
  blocked,
}: {
  name: string;
  loan: Amortizing;
  start: string;
  className: string;
  children: ReactNode;
  save?: (adjustments: AdjustmentInput[]) => Promise<ActionResult>;
  blocked?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${name}: payment schedule`}
        wide
      >
        {open && (
          <ScheduleBuilder
            loan={loan}
            start={start}
            save={save}
            blocked={blocked}
          />
        )}
      </Modal>
    </>
  );
}

const INTEREST_ONLY_YEARS = 10;

interface Row {
  key: string;
  // The payment it stands for, in the each-payment view.
  payment: Payment | null;
  label: ReactNode;
  interest: Amount;
  principal: Amount;
  extra: Amount;
  capitalized: Amount;
  balance: Amount;
  tags: { label: string; tone: string }[];
}

const tagsOf = (payments: Payment[]) => {
  const tags: Row["tags"] = [];
  if (payments.some((p) => p.moratorium))
    tags.push({ label: "Moratorium", tone: "bg-warning-soft text-warning" });
  if (payments.some((p) => p.skipped))
    tags.push({ label: "Skipped", tone: "bg-warning-soft text-warning" });
  if (payments.some((p) => p.changed))
    tags.push({ label: "Changed", tone: "bg-accent-soft text-accent" });
  if (payments.some((p) => !p.extra.isZero()))
    tags.push({ label: "Extra", tone: "bg-success-soft text-success" });
  return tags;
};

function ScheduleBuilder({
  loan,
  start,
  save,
  blocked,
}: {
  loan: Amortizing;
  start: string;
  save?: (adjustments: AdjustmentInput[]) => Promise<ActionResult>;
  blocked?: string;
}) {
  const id = useId();
  const saved = loan.adjustments ?? [];
  // Once saved, show the adjustments as the server made them canonical.
  const serialized = JSON.stringify(saved);
  const [synced, setSynced] = useState(serialized);
  const [drafts, setDrafts] = useState<Draft[]>(() => saved.map(toDraft));
  if (synced !== serialized) {
    setSynced(serialized);
    setDrafts(saved.map(toDraft));
  }
  const [view, setView] = useState<"payments" | "years">("payments");
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  const previews = drafts.map((d) => previewOf(d, start));
  const adjusted = (adjustments: Adjustment[]) =>
    amortize({ ...loan, adjustments }, start).payments(
      INTEREST_ONLY_YEARS * 12,
    );
  const payments = adjusted(previews.filter((a) => a !== null));
  const unadjusted = drafts.length ? adjusted([]) : payments;
  const dirty =
    JSON.stringify(drafts.map(toInput)) !==
    JSON.stringify(saved.map(toDraft).map(toInput));
  const update = (key: string, patch: Partial<Draft>) =>
    setDrafts((list) =>
      list.map((d) => (d.key === key ? { ...d, ...patch } : d)),
    );

  // Paid more than once a month: payments show their dates.
  const dated = PAYMENTS_PER_YEAR[loan.frequency ?? "monthly"] > 12;
  const annual = loan.frequency === "annual";
  const byPayment = view === "payments" || annual;
  const from = monthIndex(start);
  const opening = new Dec(loan.balance);
  const sum = (list: Payment[], pick: (p: Payment) => Amount) =>
    list.reduce((total, p) => total.plus(pick(p)), new Dec(0));

  const rows: Row[] = byPayment
    ? payments.map((p, i) => ({
        key: p.date,
        payment: p,
        label: (
          <>
            <span className="inline-block w-12 text-muted">{i + 1}</span>
            {dated ? formatDate(p.date) : monthLabel(p.month)}
          </>
        ),
        interest: p.interest,
        principal: p.principal,
        extra: p.extra,
        capitalized: p.capitalized,
        balance: p.after,
        tags: tagsOf([p]),
      }))
    : Array.from(
        { length: Math.ceil((payments.at(-1)!.month - from) / 12) },
        (_, y): Row => {
          const first = from + y * 12 + 1;
          const last = from + (y + 1) * 12;
          const inYear = payments.filter(
            (p) => p.month >= first && p.month <= last,
          );
          return {
            key: String(y),
            payment: null,
            label: (
              <>
                <span className="inline-block w-14">Year {y + 1}</span>
                <span className="text-muted">
                  {monthLabel(first)} – {monthLabel(last)}
                </span>
              </>
            ),
            interest: sum(inYear, (p) => p.interest),
            principal: sum(inYear, (p) => p.principal),
            extra: sum(inYear, (p) => p.extra),
            capitalized: sum(inYear, (p) => p.capitalized),
            balance: inYear.at(-1)?.after ?? opening,
            tags: tagsOf(inYear),
          };
        },
      );
  const total = (pick: (p: Payment) => Amount) => sum(payments, pick);
  const extras = payments.some((p) => !p.extra.isZero());
  const capitalizes = payments.some((p) => !p.capitalized.isZero());
  const picked = payments.find((p) => p.date === selected) ?? null;
  const saving = !!save && !blocked;

  function add(kind: Adjustment["kind"], payment: Payment) {
    const regular =
      loan.repayment === "blended"
        ? payment.principal.plus(payment.interest)
        : payment.principal;
    setDrafts((list) => [
      ...list,
      {
        key: newKey(),
        kind,
        date: payment.date,
        amount:
          kind === "payment" ? grouped.format(Number(regular.toFixed(2))) : "",
        until: "",
        payments: kind === "skip" ? "1" : "",
        suspends: "principal",
        keep: "payment",
      },
    ]);
    setSelected(null);
  }

  function onSave() {
    if (!save) return;
    setFailure(null);
    startTransition(async () => {
      const result = await save(drafts.map(toInput));
      if (result.ok) toast.success("Saved.");
      else startTransition(() => setFailure(result.message));
    });
  }

  const cell = "px-3 py-1.5 text-right";
  const interestSaved = sum(unadjusted, (p) => p.interest).minus(
    total((p) => p.interest),
  );
  const last = payments.at(-1);
  const lastBefore = unadjusted.at(-1);

  return (
    <div className="flex min-h-0 flex-col gap-3 px-5 py-4">
      <p className="text-sm text-muted">
        {money(opening)} at{" "}
        {new Dec(loan.rate).times(100).toDecimalPlaces(3).toString()}% from{" "}
        {formatDate(start)} · {describeTerms(loan)}
        {loan.repayment === "interest_only" &&
          `. No maturity: the first ${INTEREST_ONLY_YEARS} years.`}
      </p>

      {save && (
        <section className="flex flex-col gap-2 rounded-md border border-line p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">Adjustments</h3>
            {drafts.length > 0 && last && lastBefore && (
              <p className="text-xs text-muted">
                {interestSaved.isNegative()
                  ? "Interest added"
                  : "Interest saved"}{" "}
                <span className="font-medium text-foreground">
                  {money(interestSaved.abs())}
                </span>{" "}
                · last payment{" "}
                {dated ? formatDate(last.date) : monthLabel(last.month)}
                {last.date !== lastBefore.date &&
                  `, instead of ${dated ? formatDate(lastBefore.date) : monthLabel(lastBefore.month)}`}
              </p>
            )}
          </div>
          {drafts.length === 0 && (
            <p className="text-xs text-muted">
              Pick a payment in the table to add an extra payment, change the
              payment or skip payments from it.
            </p>
          )}
          {drafts.length > 0 && (
            <div className="flex max-h-56 flex-col gap-2 overflow-auto">
              {drafts.map((d, i) => (
                <div
                  key={d.key}
                  className="flex flex-wrap items-end gap-2 rounded-md bg-surface-2 p-2"
                >
                  <span className="w-32 self-center text-sm font-medium">
                    {ADJUSTMENTS[d.kind]}
                  </span>
                  <Field label={d.kind === "extra" ? "Date" : "From"}>
                    <input
                      type="date"
                      value={d.date}
                      onChange={(e) => update(d.key, { date: e.target.value })}
                      className={input}
                    />
                  </Field>
                  {d.kind === "extra" && (
                    <>
                      <Field label="Amount">
                        <input
                          value={d.amount}
                          inputMode="decimal"
                          onChange={(e) =>
                            update(d.key, { amount: e.target.value })
                          }
                          className={`${input} w-32 text-right tabular-nums`}
                        />
                      </Field>
                      <Field label="Then">
                        <Choice
                          value={d.keep}
                          options={KEEP_EXTRA}
                          onChange={(keep) => update(d.key, { keep })}
                        />
                      </Field>
                    </>
                  )}
                  {d.kind === "payment" && (
                    <>
                      <Field label="Until (blank: to the end)">
                        <input
                          type="date"
                          value={d.until}
                          onChange={(e) =>
                            update(d.key, { until: e.target.value })
                          }
                          className={input}
                        />
                      </Field>
                      <Field
                        label={
                          loan.repayment === "blended"
                            ? "Payment"
                            : "Principal per payment"
                        }
                      >
                        <input
                          value={d.amount}
                          inputMode="decimal"
                          onChange={(e) =>
                            update(d.key, { amount: e.target.value })
                          }
                          className={`${input} w-32 text-right tabular-nums`}
                        />
                      </Field>
                    </>
                  )}
                  {d.kind === "skip" && (
                    <>
                      <Field label="Payments">
                        <input
                          value={d.payments}
                          inputMode="numeric"
                          onChange={(e) =>
                            update(d.key, { payments: e.target.value })
                          }
                          className={`${input} w-20 text-right tabular-nums`}
                        />
                      </Field>
                      <Field label="Skip">
                        <Choice
                          value={d.suspends}
                          options={SUSPENDS}
                          onChange={(suspends) => update(d.key, { suspends })}
                        />
                      </Field>
                      <Field label="Then">
                        <Choice
                          value={d.keep}
                          options={KEEP_SKIP}
                          onChange={(keep) => update(d.key, { keep })}
                        />
                      </Field>
                    </>
                  )}
                  <button
                    type="button"
                    className={`${button.icon} mb-1`}
                    title="Remove"
                    aria-label={`Remove ${ADJUSTMENTS[d.kind].toLowerCase()} ${i + 1}`}
                    onClick={() =>
                      setDrafts((list) => list.filter((x) => x.key !== d.key))
                    }
                  >
                    <Icon name="close" />
                  </button>
                  {!previews[i] && (
                    <span className="basis-full text-xs text-danger">
                      Not in the schedule until it&apos;s complete, dated after{" "}
                      {formatDate(start)}.
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {(dirty || failure) && (
            <div className="flex flex-wrap items-center gap-2">
              {dirty && (
                <>
                  <button
                    type="button"
                    className={button.primary}
                    onClick={onSave}
                    disabled={pending || !saving}
                  >
                    {pending ? "Saving…" : "Save adjustments"}
                  </button>
                  <button
                    type="button"
                    className={button.ghost}
                    onClick={() => setDrafts(saved.map(toDraft))}
                    disabled={pending}
                  >
                    Discard
                  </button>
                </>
              )}
              {blocked && dirty && (
                <span className="text-sm text-muted">{blocked}</span>
              )}
              {failure && (
                <span className="text-sm text-danger">{failure}</span>
              )}
            </div>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {!annual && (
          <div className="w-64">
            <Segmented
              name={`${id}-view`}
              options={{ payments: "Each payment", years: "By year" }}
              value={view}
              onChange={setView}
            />
          </div>
        )}
        {picked && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-accent-soft px-3 py-1.5 text-sm">
            <span>
              From payment {payments.indexOf(picked) + 1},{" "}
              {formatDate(picked.date)}:
            </span>
            <button
              type="button"
              className={button.secondary}
              onClick={() => add("extra", picked)}
            >
              Extra payment
            </button>
            <button
              type="button"
              className={button.secondary}
              onClick={() => add("payment", picked)}
            >
              Change the payment
            </button>
            <button
              type="button"
              className={button.secondary}
              onClick={() => add("skip", picked)}
            >
              Skip payments
            </button>
            <button
              type="button"
              className={button.ghost}
              onClick={() => setSelected(null)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 overflow-auto rounded-md border border-line">
        <table className="w-full text-sm tabular-nums">
          <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">
                {byPayment ? "Payment" : "Year"}
              </th>
              <th className={`${cell} font-medium`}>Principal</th>
              {extras && (
                <th className={`${cell} font-medium`}>Extra payment</th>
              )}
              <th className={`${cell} font-medium`}>Interest</th>
              <th className={`${cell} font-medium`}>Total paid</th>
              {capitalizes && (
                <th className={`${cell} font-medium`}>Interest capitalized</th>
              )}
              <th className={`${cell} font-medium`}>Balance owed</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line/60 text-muted">
              <td className="px-3 py-1.5">{formatDate(start)}</td>
              <td colSpan={3 + Number(extras) + Number(capitalizes)} />
              <td className={cell}>{money(opening)}</td>
            </tr>
            {rows.map((row) => (
              <tr
                key={row.key}
                className={`border-b border-line/60 ${
                  row.payment && row.payment.date === selected
                    ? "bg-accent-soft"
                    : ""
                }`}
              >
                <td className="px-3 py-1.5 whitespace-nowrap">
                  {save && row.payment ? (
                    <button
                      type="button"
                      className="text-left hover:text-accent"
                      title="Adjust the schedule from this payment"
                      onClick={() => setSelected(row.payment!.date)}
                    >
                      {row.label}
                    </button>
                  ) : (
                    row.label
                  )}
                  {row.tags.map((tag) => (
                    <span
                      key={tag.label}
                      className={`ml-2 rounded px-1.5 py-0.5 text-xs ${tag.tone}`}
                    >
                      {tag.label}
                    </span>
                  ))}
                </td>
                <td className={cell}>{money(row.principal)}</td>
                {extras && <td className={cell}>{money(row.extra)}</td>}
                <td className={cell}>{money(row.interest)}</td>
                <td className={`${cell} font-medium`}>
                  {money(row.principal.plus(row.extra).plus(row.interest))}
                </td>
                {capitalizes && (
                  <td className={cell}>{money(row.capitalized)}</td>
                )}
                <td className={cell}>{money(row.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 bg-surface-2 font-medium">
            <tr>
              <td className="px-3 py-1.5">Total</td>
              <td className={cell}>{money(total((p) => p.principal))}</td>
              {extras && (
                <td className={cell}>{money(total((p) => p.extra))}</td>
              )}
              <td className={cell}>{money(total((p) => p.interest))}</td>
              <td className={cell}>
                {money(
                  total((p) => p.principal.plus(p.extra).plus(p.interest)),
                )}
              </td>
              {capitalizes && (
                <td className={cell}>{money(total((p) => p.capitalized))}</td>
              )}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={input}
    >
      {(Object.entries(options) as [T, string][]).map(([option, label]) => (
        <option key={option} value={option}>
          {label}
        </option>
      ))}
    </select>
  );
}
