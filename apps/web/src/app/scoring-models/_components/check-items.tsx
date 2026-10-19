"use client";

import type { Statement as AnyStatement } from "@finance/domain";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card } from "@/components/page";
import { button, input } from "@/components/styles";
import { STATEMENTS } from "@/lib/labels";
import { setCheckItemsAction } from "../actions";

type Key = "netIncome" | "retainedEarnings" | "lineAuthorized";
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
// compared with the figure printed on them, retained earnings, rolled
// forward from one period to the next, and the authorized line of credit,
// compared with the borrower's lines. Unset, a check is off.
export function CheckItems({
  modelId,
  values,
  items,
  inputs,
}: {
  modelId: string;
  values: Record<Exclude<Key, "lineAuthorized">, string | null> & {
    lineAuthorized?: string | null;
  };
  // Amounts of the latest published version, by statement.
  items: { code: string; label: string; statement: Statement }[];
  // Its amounts entered in the spread, on any statement, for the
  // authorized line, often a supplementary item.
  inputs: { code: string; label: string; statement: AnyStatement }[];
}) {
  const [chosen, setChosen] = useState<Record<Key, string>>({
    netIncome: values.netIncome ?? "",
    retainedEarnings: values.retainedEarnings ?? "",
    lineAuthorized: values.lineAuthorized ?? "",
  });
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  function save() {
    setFailure(null);
    startTransition(async () => {
      const result = await setCheckItemsAction(modelId, chosen);
      if (result.ok) toast.success("Saved.");
      else startTransition(() => setFailure(result.message));
    });
  }

  return (
    <Card
      title="Checks against the statements"
      description="Net income must match the one printed on each period's statements, when the analyst enters it; a period that doesn't can't be analyzed. Retained earnings should roll forward from the period before with net income and the period's reconciliation. The borrower's lines of credit, added up at the latest fiscal year end, should match the authorized line."
    >
      <div className="flex flex-col gap-4">
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
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">
              Authorized line of credit
            </span>
            <select
              value={chosen.lineAuthorized}
              onChange={(e) =>
                setChosen((c) => ({ ...c, lineAuthorized: e.target.value }))
              }
              className={input}
            >
              <option value="">Not checked</option>
              {STATEMENTS.map((statement) => {
                const options = inputs.filter(
                  (item) => item.statement === statement.value,
                );
                return (
                  options.length > 0 && (
                    <optgroup key={statement.value} label={statement.label}>
                      {options.map((item) => (
                        <option key={item.code} value={item.code}>
                          {item.label} ({item.code})
                        </option>
                      ))}
                    </optgroup>
                  )
                );
              })}
            </select>
          </label>
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
          {failure && <span className="text-sm text-danger">{failure}</span>}
        </div>
      </div>
    </Card>
  );
}
