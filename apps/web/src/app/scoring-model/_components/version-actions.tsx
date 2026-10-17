"use client";

import type { ScoringModelVersion } from "@finance/domain";
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  createDraftAction,
  discardDraftAction,
  publishAction,
} from "../actions";
import type { ActionResult } from "../types";
import { IssueList } from "./issue-list";
import { button, Field, input, Modal } from "./ui";

type Version = Pick<ScoringModelVersion, "id" | "number" | "status">;

export function VersionActions({
  version,
  draftNumber,
  nextNumber,
  publishBlocker,
}: {
  version: Version | undefined;
  draftNumber: number | null;
  nextNumber: number;
  // Why the draft can't be published yet, if it can't.
  publishBlocker: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<Extract<
    ActionResult,
    { ok: false }
  > | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [notes, setNotes] = useState("");

  // Runs an action; the ones that change version navigate from the server.
  function act(action: () => Promise<ActionResult>, then?: () => void) {
    setFailure(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setFailure(result);
      if (then) startTransition(then);
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
              onClick={() => {
                if (
                  confirm(
                    `Discard draft v${version.number} and all its changes?`,
                  )
                ) {
                  act(() => discardDraftAction(version.id));
                }
              }}
            >
              Discard draft
            </button>
            <button
              type="button"
              disabled={pending || publishBlocker !== null}
              title={publishBlocker ?? undefined}
              className={button.primary}
              onClick={() => setPublishing(true)}
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
      {failure && !publishing && (
        <p className="text-xs text-danger">{failure.message}</p>
      )}

      {version?.status === "draft" && (
        <Modal
          open={publishing}
          onClose={() => setPublishing(false)}
          title={`Publish v${version.number}`}
        >
          <div className="flex flex-col gap-4 px-5 py-4">
            <p className="text-sm text-muted">
              A published version is frozen. Financial models and analyses that
              use it keep working exactly as they do today. Later changes go
              into a new draft.
            </p>
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
              onClick={() =>
                act(
                  () => publishAction(version.id, notes),
                  () => setPublishing(false),
                )
              }
            >
              {pending ? "Publishing…" : `Publish v${version.number}`}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
