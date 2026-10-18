import type { TemplateStatus as Status } from "@finance/documents";
import { Badge } from "@/components/page";

// Where a document stands: never published, published (perhaps with
// changes in its draft), or archived.
export function TemplateStatus({
  status,
  changed,
}: {
  status: Status;
  changed: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {status === "draft" ? (
        <Badge tone="accent">Draft</Badge>
      ) : status === "published" ? (
        <Badge tone="success">Published</Badge>
      ) : (
        <Badge>Archived</Badge>
      )}
      {changed && <Badge tone="warning">Unpublished changes</Badge>}
    </span>
  );
}
