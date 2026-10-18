"use client";

import {
  amortize,
  monthIndex,
  monthOf,
  PAYMENTS_PER_YEAR,
  type Amortizing,
} from "@finance/domain/amortization";
import { Dec } from "@finance/engine";
import { useId, useMemo, useState, type ReactNode } from "react";
import { formatDate } from "@/lib/format";
import { describeTerms } from "./loan-terms";
import { Modal, Segmented } from "./ui";

// A loan's payment schedule, worked out in the browser when it opens, from
// the loan as saved: each payment, or each year of the loan, with what's paid
// and what's still owed.

type Amount = InstanceType<typeof Dec>;

const cents = new Intl.NumberFormat("en-CA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (value: Amount) => cents.format(Number(value.toFixed(2)));
const monthFormat = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const monthLabel = (index: number) =>
  monthFormat.format(new Date(`${monthOf(index)}-01T00:00:00Z`));
interface Row {
  key: string;
  label: ReactNode;
  interest: Amount;
  principal: Amount;
  capitalized: Amount;
  balance: Amount;
  moratorium: boolean;
}

// A button that opens the loan's schedule from `start`, the date its balance
// is known at (an existing loan's date, a new loan's closing).
export function LoanSchedule({
  name,
  loan,
  start,
  className,
  children,
}: {
  name: string;
  loan: Amortizing;
  start: string;
  className: string;
  children: ReactNode;
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
      >
        {open && <ScheduleTable loan={loan} start={start} />}
      </Modal>
    </>
  );
}

const INTEREST_ONLY_YEARS = 10;

function ScheduleTable({ loan, start }: { loan: Amortizing; start: string }) {
  const id = useId();
  const [view, setView] = useState<"payments" | "years">("payments");
  const from = monthIndex(start);
  const payments = useMemo(
    () => amortize(loan, start).payments(INTEREST_ONLY_YEARS * 12),
    [loan, start],
  );
  // Paid more than once a month: payments show their dates.
  const dated = PAYMENTS_PER_YEAR[loan.frequency ?? "monthly"] > 12;
  const annual = loan.frequency === "annual";
  const capitalizes = loan.moratorium?.kind === "full";
  const opening = new Dec(loan.balance);

  const rows: Row[] =
    view === "payments" || annual
      ? payments.map((p, i) => ({
          key: String(p.month),
          label: (
            <>
              <span className="inline-block w-12 text-muted">{i + 1}</span>
              {dated ? formatDate(p.date) : monthLabel(p.month)}
            </>
          ),
          interest: p.interest,
          principal: p.principal,
          capitalized: p.capitalized,
          balance: p.after,
          moratorium: p.moratorium,
        }))
      : Array.from(
          { length: Math.ceil((payments.at(-1)!.month - from) / 12) },
          (_, y): Row => {
            const first = from + y * 12 + 1;
            const last = from + (y + 1) * 12;
            const inYear = payments.filter(
              (p) => p.month >= first && p.month <= last,
            );
            const sum = (pick: (p: (typeof payments)[number]) => Amount) =>
              inYear.reduce((total, p) => total.plus(pick(p)), new Dec(0));
            return {
              key: String(y),
              label: (
                <>
                  <span className="inline-block w-14">Year {y + 1}</span>
                  <span className="text-muted">
                    {monthLabel(first)} – {monthLabel(last)}
                  </span>
                </>
              ),
              interest: sum((p) => p.interest),
              principal: sum((p) => p.principal),
              capitalized: sum((p) => p.capitalized),
              balance: inYear.at(-1)?.after ?? opening,
              moratorium: inYear.some((p) => p.moratorium),
            };
          },
        );
  const total = (pick: (row: Row) => Amount) =>
    rows.reduce((sum, row) => sum.plus(pick(row)), new Dec(0));
  const cell = "px-3 py-1.5 text-right";

  return (
    <div className="flex min-h-0 flex-col gap-3 px-5 py-4">
      <p className="text-sm text-muted">
        {money(opening)} at{" "}
        {new Dec(loan.rate).times(100).toDecimalPlaces(3).toString()}% from{" "}
        {formatDate(start)} · {describeTerms(loan)}
        {loan.repayment === "interest_only" &&
          `. No maturity: the first ${INTEREST_ONLY_YEARS} years.`}
      </p>
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
      <div className="min-h-0 overflow-auto rounded-md border border-line">
        <table className="w-full text-sm tabular-nums">
          <thead className="sticky top-0 bg-surface-2 text-xs text-muted">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">
                {view === "payments" || annual ? "Payment" : "Year"}
              </th>
              <th className={`${cell} font-medium`}>Principal</th>
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
              <td colSpan={capitalizes ? 4 : 3} />
              <td className={cell}>{money(opening)}</td>
            </tr>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-line/60">
                <td className="px-3 py-1.5 whitespace-nowrap">
                  {row.label}
                  {row.moratorium && (
                    <span className="ml-2 rounded bg-warning-soft px-1.5 py-0.5 text-xs text-warning">
                      Moratorium
                    </span>
                  )}
                </td>
                <td className={cell}>{money(row.principal)}</td>
                <td className={cell}>{money(row.interest)}</td>
                <td className={`${cell} font-medium`}>
                  {money(row.principal.plus(row.interest))}
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
              <td className={cell}>{money(total((r) => r.principal))}</td>
              <td className={cell}>{money(total((r) => r.interest))}</td>
              <td className={cell}>
                {money(total((r) => r.principal.plus(r.interest)))}
              </td>
              {capitalizes && (
                <td className={cell}>{money(total((r) => r.capitalized))}</td>
              )}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
