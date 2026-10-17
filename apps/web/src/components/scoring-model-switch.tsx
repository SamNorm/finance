"use client";

import { startTransition, useOptimistic, useState } from "react";
import { setScoringModelSourceAction } from "@/app/scoring-models/actions";

// On: the model mirrors an institution's scoring system. Off: it's the
// organization's own input sheet. Items are kept either way.
export function ScoringModelSwitch({
  modelId,
  source,
  labelledBy,
}: {
  modelId: string;
  source: "mirrored" | "native";
  labelledBy: string;
}) {
  const [optimistic, setOptimistic] = useOptimistic(source);
  const [failure, setFailure] = useState<string | null>(null);
  const on = optimistic === "mirrored";

  function toggle() {
    const next = on ? "native" : "mirrored";
    setFailure(null);
    startTransition(async () => {
      setOptimistic(next);
      const result = await setScoringModelSourceAction(modelId, next);
      if (!result.ok) setFailure(result.message);
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelledBy}
        onClick={toggle}
        className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-line-strong transition-colors aria-checked:bg-accent focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
      >
        <span
          className={`inline-block size-5 rounded-full bg-surface shadow transition-transform ${
            on ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
      {failure && <p className="text-xs text-danger">{failure}</p>}
    </div>
  );
}
