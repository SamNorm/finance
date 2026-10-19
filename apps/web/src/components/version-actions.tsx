"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ask } from "@/components/confirm";
import { IssueList } from "@/components/issue-list";
import { button, input } from "@/components/styles";
import { Field, Modal } from "@/components/ui";
import type { ActionResult } from "@/lib/action-result";

interface Version {
  id: string;
  number: number;
  status: "draft" | "published" | "retired";
}

// Publish, discard or open a draft: the version lifecycle shared by scoring
// models and financial models. The actions are server actions passed in,
// already bound to their model; the ones that change version navigate from
// the server.
export function VersionActions({
  version,
  draftNumber,
  nextNumber,
  publishBlocker,
  publishNote,
  publishAction,
  createDraftAction,
  discardDraftAction,
}: {
  version: Version | undefined;
  draftNumber: number | null;
  nextNumber: number;
  // Why the draft can't be published yet, if it can't.
  publishBlocker: string | null;
  // What publishing freezes, shown in the confirmation.
  publishNote: string;
  publishAction: (versionId: string, notes: string) => Promise<ActionResult>;
  createDraftAction: () => Promise<ActionResult>;
  discardDraftAction: (versionId: string) => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<Extract<
    ActionResult,
    { ok: false }
  > | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [notes, setNotes] = useState("");

  // Starting or discarding a draft; publishing shows its failure in its
  // dialog instead, with the issues to fix.
  function act(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.message);
    });
  }

  function publish(draft: Version) {
    setFailure(null);
    startTransition(async () => {
      const result = await publishAction(draft.id, notes);
      if (!result.ok) return setFailure(result);
      toast.success(`v${draft.number} published.`);
      startTransition(() => setPublishing(false));
    });
  }

  const newDraft = () => act(createDraftAction);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {version?.status === "draft" ? (
          <>
            <button
              type="button"
              disabled={pending}
              className={button.danger}
              onClick={async () => {
                if (
                  await ask({
                    title: `Discard draft v${version.number}?`,
                    body: "All its changes are lost.",
                    action: "Discard draft",
                    danger: true,
                  })
                )
                  act(() => discardDraftAction(version.id));
              }}
            >
              Discard draft
            </button>
            <button
              type="button"
              disabled={pending || publishBlocker !== null}
              title={publishBlocker ?? undefined}
              className={button.primary}
              onClick={() => {
                setFailure(null);
                setPublishing(true);
              }}
            >
              Publish v{version.number}
            </button>
          </>
        ) : draftNumber !== null ? (
          <Link href={`?v=${draftNumber}`} className={button.secondary}>
            Go to draft v{draftNumber}
          </Link>
        ) : (
          <button
            type="button"
            disabled={pending}
            className={button.primary}
            onClick={newDraft}
          >
            {pending ? "Creating…" : `New draft (v${nextNumber})`}
          </button>
        )}
      </div>

      {version?.status === "draft" && (
        <Modal
          open={publishing}
          onClose={() => setPublishing(false)}
          title={`Publish v${version.number}`}
        >
          <div className="flex flex-col gap-4 px-5 py-4">
            <p className="text-sm text-muted">{publishNote}</p>
            <Field
              label="Notes (optional)"
              hint="What changed, e.g. the template update this follows."
            >
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={input}
              />
            </Field>
            {failure && (
              <div className="flex flex-col gap-2 rounded-md bg-danger-soft p-3">
                <p className="text-sm font-medium text-danger">
                  {failure.message}
                </p>
                {failure.issues.length > 0 && (
                  <IssueList issues={failure.issues} limit={8} />
                )}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button
              type="button"
              className={button.ghost}
              onClick={() => setPublishing(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              className={button.primary}
              onClick={() => publish(version)}
            >
              {pending ? "Publishing…" : `Publish v${version.number}`}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
