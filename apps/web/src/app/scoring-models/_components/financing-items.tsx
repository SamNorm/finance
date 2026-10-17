"use client";

import { useState, useTransition } from "react";
import { button, input } from "@/components/styles";
import { setFinancingItemsAction } from "../actions";

type Key = "longTermDebt" | "currentDebt" | "cash";

const FIELDS: { key: Key; label: string; side: "assets" | "claims" }[] = [
  { key: "longTermDebt", label: "Long-term portion", side: "claims" },
  { key: "currentDebt", label: "Current portion", side: "claims" },
  { key: "cash", label: "Repayments out of", side: "assets" },
];

// Where the new loans of a scenario's project post on the balance sheet:
// set once per scoring model, so each project only picks what it funds.
export function FinancingItems({
  modelId,
  values,
  items,
}: {
  modelId: string;
  values: Record<Key, string | null>;
  // Balance sheet amounts of the latest published version, by side.
  items: { code: string; label: string; side: "assets" | "claims" }[];
}) {
  const [chosen, setChosen] = useState<Record<Key, string>>({
    longTermDebt: values.longTermDebt ?? "",
    currentDebt: values.currentDebt ?? "",
    cash: values.cash ?? "",
  });
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  function save() {
    setFeedback(null);
    startTransition(async () => {
      const result = await setFinancingItemsAction(modelId, chosen);
      startTransition(() =>
        setFeedback(
          result.ok
            ? { ok: true, message: "Saved." }
            : { ok: false, message: result.message },
        ),
      );
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold">New loans post to</h2>
        <p className="text-xs text-muted">
          Post-project balance sheets put a project&apos;s new loans here, split
          between the portion due within a year and the rest, and take their
          repayments out of cash in projected years.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {FIELDS.map((field) => (
          <label key={field.key} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">
              {field.label}
            </span>
            <select
              value={chosen[field.key]}
              onChange={(e) =>
                setChosen((c) => ({ ...c, [field.key]: e.target.value }))
              }
              className={input}
            >
              <option value="">Not set</option>
              {items
                .filter((item) => item.side === field.side)
                .map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label} ({item.code})
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={button.secondary}
          onClick={save}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save"}
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
