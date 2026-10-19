"use client";

import type { Covenant } from "@finance/domain";
import { Scale } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  blankCovenant,
  CovenantEditor,
  covenantDrafts,
  covenantInput,
  type MetricOption,
} from "@/components/covenant-editor";
import { Card, EmptyState } from "@/components/page";
import { button } from "@/components/styles";
import { saveCovenantsAction } from "../actions";

// The covenants of the borrower's credit agreement in force: every analysis
// of it tests them, on its model's line of the same code. A deal's scenario
// can propose others.
export function BorrowerCovenants({
  entityId,
  covenants,
  metrics,
}: {
  entityId: string;
  covenants: Covenant[];
  metrics: MetricOption[];
}) {
  const saved = covenantDrafts(covenants, metrics);
  const [drafts, setDrafts] = useState(saved);
  // Back to what's saved when it changes elsewhere, such as from MCP.
  const [synced, setSynced] = useState(covenants);
  if (synced !== covenants) {
    setSynced(covenants);
    setDrafts(saved);
  }
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const dirty =
    JSON.stringify(covenantInput(drafts)) !==
    JSON.stringify(covenantInput(saved));

  function save() {
    setFailure(null);
    startTransition(async () => {
      const result = await saveCovenantsAction(entityId, covenantInput(drafts));
      if (result.ok) toast.success("Saved. Analyses test them now.");
      else startTransition(() => setFailure(result.message));
    });
  }

  if (!drafts.length && !covenants.length)
    return (
      <EmptyState
        icon={<Scale />}
        title="No covenants yet."
        actions={
          <button
            type="button"
            className={button.primary}
            onClick={() => setDrafts([blankCovenant()])}
          >
            Add a covenant
          </button>
        }
      >
        Enter the covenants of the credit agreement in force, such as a minimum
        debt service coverage. Every analysis of this borrower tests them, year
        by year.
      </EmptyState>
    );

  return (
    <Card
      title="Covenants in force"
      description="Each tests a line of the borrower's financial models by its code, in each fiscal year and interim period; a threshold can step from a fiscal year, and an interim period takes its fiscal year's. A deal's scenario can propose others."
    >
      <div className="flex flex-col gap-4">
        <CovenantEditor
          drafts={drafts}
          metrics={metrics}
          onChange={setDrafts}
        />
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <button
            type="button"
            className={button.primary}
            onClick={save}
            disabled={pending || !dirty}
          >
            {pending ? "Saving…" : "Save covenants"}
          </button>
          {failure ? (
            <span className="text-sm text-danger">{failure}</span>
          ) : (
            dirty && (
              <span className="flex items-center gap-2 text-sm text-muted">
                <span className="size-2 rounded-full bg-warning" />
                Unsaved changes
              </span>
            )
          )}
        </div>
      </div>
    </Card>
  );
}
