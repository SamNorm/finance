import { Badge } from "@/components/page";

// Where a template stands: a draft never published, published (perhaps
// with changes in its draft), or archived, no longer offered to lines.
export function TemplateStatus({
  published,
  changed,
  archived,
}: {
  published: boolean;
  changed: boolean;
  archived: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {archived ? (
        <Badge>Archived</Badge>
      ) : published ? (
        <Badge tone="success">Published</Badge>
      ) : (
        <Badge tone="accent">Draft</Badge>
      )}
      {changed && <Badge tone="warning">Unpublished changes</Badge>}
    </span>
  );
}
