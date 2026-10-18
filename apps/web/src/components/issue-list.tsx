import type { Issue } from "@finance/domain";
import { ChevronDown, CircleAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

// Errors first, then warnings, each pointing at its item code or file row.
export function IssueList({
  issues,
  limit,
}: {
  issues: Issue[];
  limit?: number;
}) {
  const sorted = [...issues].sort(
    (a, b) =>
      Number(a.severity === "warning") - Number(b.severity === "warning"),
  );
  const shown = limit ? sorted.slice(0, limit) : sorted;
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {shown.map((issue, i) => (
        <li key={i} className="flex items-baseline gap-2">
          <span
            className={`size-2 shrink-0 translate-y-[-1px] rounded-full ${
              issue.severity === "error" ? "bg-danger" : "bg-warning"
            }`}
            aria-label={issue.severity}
          />
          {issue.row !== undefined ? (
            <span className="shrink-0 font-mono text-xs text-muted">
              row {issue.row}
            </span>
          ) : issue.itemCode ? (
            <span className="shrink-0 font-mono text-xs text-muted">
              {issue.itemCode}
            </span>
          ) : null}
          <span>{issue.message}</span>
        </li>
      ))}
      {shown.length < sorted.length && (
        <li className="text-xs text-muted">
          and {sorted.length - shown.length} more
        </li>
      )}
    </ul>
  );
}

// Error and warning counts with a note, opening onto the issues. `children`
// replaces the plain list, for issues grouped some other way.
export function IssuesSummary({
  issues,
  note,
  children,
}: {
  issues: Issue[];
  note: string;
  children?: ReactNode;
}) {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  return (
    <details
      className={`group rounded-xl border bg-surface shadow-xs ${errors ? "border-danger/30" : "border-warning/30"}`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
        {errors > 0 ? (
          <CircleAlert className="size-4 text-danger" aria-hidden />
        ) : (
          <TriangleAlert className="size-4 text-warning" aria-hidden />
        )}
        {errors > 0 && (
          <span className="font-medium text-danger">
            {errors} {errors === 1 ? "error" : "errors"}
          </span>
        )}
        {errors > 0 && warnings > 0 && <span className="text-muted">·</span>}
        {warnings > 0 && (
          <span className="font-medium text-warning">
            {warnings} {warnings === 1 ? "warning" : "warnings"}
          </span>
        )}
        <span className="text-muted">{note}</span>
        <ChevronDown
          className="ml-auto size-4 text-muted transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="border-t border-line px-4 py-3">
        {children ?? <IssueList issues={issues} />}
      </div>
    </details>
  );
}
