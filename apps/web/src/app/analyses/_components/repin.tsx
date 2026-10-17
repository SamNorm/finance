"use client";

import { useState, useTransition } from "react";
import { button } from "@/components/styles";
import { repinAnalysisAction } from "../actions";

// Tells the analyst a newer model version exists, without changing the
// analysis: re-running makes a copy on the new version to compare.
export function Repin({
  analysisId,
  pinned,
  newer,
}: {
  analysisId: string;
  pinned: number;
  newer: number;
}) {
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-accent-soft px-4 py-3 text-sm">
      <span>
        Version {newer} of the model is published. This analysis stays on v
        {pinned}, so its results don&apos;t change.
      </span>
      <div className="flex items-center gap-2">
        {failure && <span className="text-danger">{failure}</span>}
        <button
          type="button"
          className={button.secondary}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await repinAnalysisAction(analysisId);
              if (!result.ok) setFailure(result.message);
            })
          }
        >
          {pending ? "Copying…" : `Re-run a copy on v${newer}`}
        </button>
      </div>
    </div>
  );
}
