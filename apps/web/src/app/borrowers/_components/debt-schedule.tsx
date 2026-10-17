"use client";

import type { DebtSchedule } from "@finance/domain";
import { Dec } from "@finance/engine";
import { useState, useTransition } from "react";
import { button, input } from "@/components/styles";
import { Icon } from "@/components/ui";
import { formatDate, formatFigure } from "@/lib/format";
import { REPAYMENTS } from "@/lib/labels";
import { saveDebtScheduleAction } from "../actions";

interface Draft {
  key: string;
  id?: string;
  name: string;
  balance: string;
  rate: string;
  repayment: keyof typeof REPAYMENTS;
  years: string;
}

const grouped = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });

const toDraft = (loan: DebtSchedule["loans"][number]): Draft => ({
  key: loan.id,
  id: loan.id,
  name: loan.name,
  balance: grouped.format(Number(loan.balance)),
  rate: `${new Dec(loan.rate).times(100).toString()}%`,
  repayment: loan.repayment,
  years: loan.months ? String(Math.round((loan.months / 12) * 100) / 100) : "",
});

// The borrower's existing loans as of a date. Analyses read their actual
// future debt service in projected years and post-project columns.
export function DebtScheduleEditor({
  entityId,
  schedule,
  nextYear,
}: {
  entityId: string;
  schedule: DebtSchedule;
  // Each saved loan's debt service over the next twelve months, by id.
  nextYear: Record<string, { interest: string; principal: string }>;
}) {
  const [asOf, setAsOf] = useState(schedule.asOf ?? "");
  const [loans, setLoans] = useState<Draft[]>(() =>
    schedule.loans.map(toDraft),
  );
  // Once saved, show the schedule as the server made it canonical.
  const serialized = JSON.stringify(schedule);
  const [synced, setSynced] = useState(serialized);
  if (synced !== serialized) {
    setSynced(serialized);
    setAsOf(schedule.asOf ?? "");
    setLoans(schedule.loans.map(toDraft));
  }
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const update = (key: string, patch: Partial<Draft>) =>
    setLoans((list) =>
      list.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );

  function save() {
    setFeedback(null);
    startTransition(async () => {
      const result = await saveDebtScheduleAction(entityId, {
        asOf,
        loans: loans.map((loan) => ({
          id: loan.id,
          name: loan.name,
          balance: loan.balance,
          rate: loan.rate,
          repayment: loan.repayment,
          years: loan.years,
        })),
      });
      startTransition(() =>
        setFeedback(
          result.ok
            ? { ok: true, message: "Saved." }
            : { ok: false, message: result.message },
        ),
      );
    });
  }

  const totals = schedule.loans.reduce(
    (sum, loan) => {
      const year = nextYear[loan.id];
      return {
        balance: sum.balance + Number(loan.balance),
        service:
          sum.service +
          Number(year?.interest ?? 0) +
          Number(year?.principal ?? 0),
      };
    },
    { balance: 0, service: 0 },
  );
  const caption = "text-xs font-medium text-muted";

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Existing debt</h2>
          <p className="text-xs text-muted">
            The borrower&apos;s loans today. Analyses use their scheduled
            payments for projected years and post-project debt service, as{" "}
            <span className="font-mono">DEBT_SCHEDULE_</span> inputs.
          </p>
        </div>
        {schedule.asOf && schedule.loans.length > 0 && (
          <p className="text-xs text-muted">
            {formatFigure(String(totals.balance), "amount")} owed on{" "}
            {formatDate(schedule.asOf)} · debt service over the next 12 months{" "}
            <span className="font-medium text-foreground">
              {formatFigure(String(totals.service), "amount")}
            </span>
          </p>
        )}
      </div>

      <label className="flex w-48 flex-col gap-1">
        <span className={caption}>Balances as of</span>
        <input
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          className={input}
        />
      </label>

      {loans.length > 0 && (
        <div className="flex flex-col gap-2">
          {loans.map((loan) => {
            const year = loan.id ? nextYear[loan.id] : undefined;
            return (
              <fieldset
                key={loan.key}
                className="grid grid-cols-2 gap-3 rounded-md border border-line p-3 sm:grid-cols-3 lg:grid-cols-[minmax(10rem,1.5fr)_repeat(4,minmax(6rem,1fr))_minmax(8rem,1fr)_auto]"
              >
                <legend className="sr-only">{loan.name || "Loan"}</legend>
                <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                  <span className={caption}>Loan</span>
                  <input
                    value={loan.name}
                    placeholder="Term loan, mortgage, lease…"
                    onChange={(e) => update(loan.key, { name: e.target.value })}
                    className={input}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={caption}>Balance</span>
                  <input
                    value={loan.balance}
                    inputMode="decimal"
                    onChange={(e) =>
                      update(loan.key, { balance: e.target.value })
                    }
                    className={`${input} text-right tabular-nums`}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={caption}>Rate</span>
                  <input
                    value={loan.rate}
                    placeholder="6.5%"
                    onChange={(e) => update(loan.key, { rate: e.target.value })}
                    className={`${input} text-right tabular-nums`}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={caption}>Repayment</span>
                  <select
                    value={loan.repayment}
                    onChange={(e) =>
                      update(loan.key, {
                        repayment: e.target.value as Draft["repayment"],
                      })
                    }
                    className={input}
                  >
                    {Object.entries(REPAYMENTS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={caption}>Years left</span>
                  <input
                    value={loan.repayment === "interest_only" ? "" : loan.years}
                    disabled={loan.repayment === "interest_only"}
                    inputMode="decimal"
                    onChange={(e) =>
                      update(loan.key, { years: e.target.value })
                    }
                    className={`${input} text-right tabular-nums`}
                  />
                </label>
                <div className="flex flex-col justify-end gap-0.5 text-xs text-muted">
                  {year ? (
                    <>
                      <span>Next 12 months</span>
                      <span className="text-sm text-foreground tabular-nums">
                        {formatFigure(
                          String(
                            Number(year.interest) + Number(year.principal),
                          ),
                          "amount",
                        )}
                      </span>
                    </>
                  ) : (
                    <span>Save to see its debt service</span>
                  )}
                </div>
                <div className="flex items-end justify-end">
                  <button
                    type="button"
                    className={button.icon}
                    title="Remove"
                    aria-label={`Remove ${loan.name || "the loan"}`}
                    onClick={() =>
                      setLoans((list) => list.filter((l) => l.key !== loan.key))
                    }
                  >
                    <Icon name="close" />
                  </button>
                </div>
              </fieldset>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={button.secondary}
          onClick={() =>
            setLoans((list) => [
              ...list,
              {
                key: `new-${list.length}-${Date.now()}`,
                name: "",
                balance: "",
                rate: "",
                repayment: "blended",
                years: "",
              },
            ])
          }
        >
          <Icon name="plus" />
          Loan
        </button>
        <button
          type="button"
          className={button.primary}
          onClick={save}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save existing debt"}
        </button>
        {feedback && (
          <span
            className={`text-sm ${feedback.ok ? "text-success" : "text-danger"}`}
          >
            {feedback.message}
          </span>
        )}
      </div>
    </section>
  );
}
