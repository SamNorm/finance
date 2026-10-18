import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

// Something to do elsewhere before this page can be used, with the link that
// does it.
export function Notice({
  children,
  action,
}: {
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
      <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}
