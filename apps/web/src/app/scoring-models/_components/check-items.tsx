"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/page";
import { button, input } from "@/components/styles";
import { setCheckItemsAction } from "../actions";

type Key = "netIncome" | "retainedEarnings";
type Statement = "income_statement" | "balance_sheet";

const FIELDS: { key: Key; label: string; statement: Statement }[] = [
  { key: "netIncome", label: "Net income", statement: "income_statement" },
  {
    key: "retainedEarnings",
    label: "Retained earnings",
    statement: "balance_sheet",
  },
];

// The items the spread's checks against the statements read: net income,
// compared with the figure printed on them, and retained earnings, rolled
// forward from one period to the next. Unset, a check is off.
export function CheckItems({
  modelId,
  values,
  items,
}: {
  modelId: string;
  values: Record<Key, string | null>;
  // Amounts of the latest published version, by statement.
  items: { code: string; label: string; statement: Statement }[];
}) {
  const [chosen, setChosen] = useState<Record<Key, string>>({
    netIncome: values.netIncome ?? "",
    retainedEarnings: values.retainedEarnings ?? "",
  });
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  function save() {
    setFeedback(null);
    startTransition(async () => {
      const result = await setCheckItemsAction(modelId, chosen);
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
    <Card
      title="Checks against the statements"
      description="Net income must match the one printed on each period's statements, when the analyst enters it; a period that doesn't can't be analyzed. Retained earnings should roll forward from the period before with net income and the period's reconciliation."
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
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
                <option value="">Not checked</option>
                {items
                  .filter((item) => item.statement === field.statement)
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
      </div>
    </Card>
  );
}
