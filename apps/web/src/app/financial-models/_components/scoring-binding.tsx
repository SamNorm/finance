"use client";

import { useState, useTransition } from "react";
import { setScoringVersionAction } from "../actions";

// Which scoring model version the formulas read. A draft can move to another
// published version; the checks then show which references broke.
export function ScoringBinding({
  versionId,
  editable,
  label,
  bound,
  options,
}: {
  versionId: string;
  editable: boolean;
  label: string;
  bound: { id: string; number: number };
  options: { id: string; number: number }[];
}) {
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  if (!editable) {
    return (
      <p className="text-sm text-muted">
        Built on {label} v{bound.number}
      </p>
    );
  }
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      Built on {label}
      <select
        value={bound.id}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          setFailure(null);
          startTransition(async () => {
            const result = await setScoringVersionAction(versionId, next);
            if (!result.ok) setFailure(result.message);
          });
        }}
        className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground"
      >
        {!options.some((o) => o.id === bound.id) && (
          <option value={bound.id}>v{bound.number}</option>
        )}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            v{o.number}
          </option>
        ))}
      </select>
      {failure && <span className="text-danger">{failure}</span>}
    </label>
  );
}
