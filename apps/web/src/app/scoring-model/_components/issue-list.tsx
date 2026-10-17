import type { Issue } from "@finance/domain";

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
