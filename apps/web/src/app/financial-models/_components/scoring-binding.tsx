"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { setScoringVersionAction } from "../actions";

// Which scoring model version the formulas read. A draft can move to another
// published version; the checks then show which references broke.
export function ScoringBinding({
  versionId,
  editable,
  scoringModelId,
  label,
  bound,
  options,
}: {
  versionId: string;
  editable: boolean;
  scoringModelId: string;
  label: string;
  bound: { id: string; number: number };
  options: { id: string; number: number }[];
}) {
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const name = (
    <Link
      href={`/scoring-models/${scoringModelId}`}
      className="text-accent hover:underline"
    >
      {label}
    </Link>
  );
  if (!editable) {
    return (
      <span>
        Built on {name} v{bound.number}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      Built on {name}
      <select
        value={bound.id}
        disabled={pending}
        aria-label={`${label} version`}
        onChange={(e) => {
          const next = e.target.value;
          setFailure(null);
          startTransition(async () => {
            const result = await setScoringVersionAction(versionId, next);
            if (!result.ok) setFailure(result.message);
          });
        }}
        className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-sm text-foreground"
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
    </span>
  );
}
