"use client";

import type { Comment } from "@finance/domain";
import { MessageSquare, Pencil, Trash2 } from "lucide-react";
import { useState, useTransition, type KeyboardEvent } from "react";
import { toast } from "sonner";
import {
  addCommentAction,
  removeCommentAction,
  updateCommentAction,
} from "@/app/comments/actions";
import { formatDay } from "@/lib/format";
import { ask } from "./confirm";
import { Badge, Card } from "./page";
import { button, input } from "./styles";

// Comments on a borrower or an analysis, newest first: added at the top,
// each editable and deletable in place. Ctrl or ⌘ + Enter saves.
export function Comments({
  owner,
  comments,
  title = "Comments",
  description,
  placeholder = "Add a comment",
}: {
  owner: { entityId: string } | { analysisId: string };
  comments: Comment[];
  title?: string;
  description?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  function add() {
    if (!draft.trim()) return;
    setFailure(null);
    startTransition(async () => {
      const result = await addCommentAction(owner, draft);
      if (!result.ok) return setFailure(result.message);
      setDraft("");
      toast.success("Comment added.");
    });
  }

  return (
    <Card
      flush
      title={
        <span className="flex items-center gap-2">
          {title}
          {comments.length > 0 && <Badge>{comments.length}</Badge>}
        </span>
      }
      description={description}
    >
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={saveOnModEnter(add)}
          placeholder={placeholder}
          aria-label={placeholder}
          rows={draft.includes("\n") ? 4 : 2}
          className={`${input} resize-y`}
        />
        {(draft.trim() || failure) && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={button.primary}
              onClick={add}
              disabled={pending || !draft.trim()}
            >
              {pending ? "Adding…" : "Add comment"}
            </button>
            {failure && <span className="text-sm text-danger">{failure}</span>}
          </div>
        )}
      </div>
      {comments.length > 0 ? (
        <ul className="divide-y divide-line/70">
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} />
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted">
          <MessageSquare className="size-4" aria-hidden />
          No comments yet.
        </p>
      )}
    </Card>
  );
}

function CommentItem({ comment }: { comment: Comment }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  // Edited more than a minute after it was written.
  const edited =
    comment.updatedAt.getTime() - comment.createdAt.getTime() > 60_000;

  function save() {
    setFailure(null);
    startTransition(async () => {
      const result = await updateCommentAction(comment.id, draft);
      if (!result.ok) return setFailure(result.message);
      setEditing(false);
      toast.success("Comment saved.");
    });
  }

  async function remove() {
    if (
      !(await ask({
        title: "Delete this comment?",
        action: "Delete",
        danger: true,
      }))
    )
      return;
    setFailure(null);
    startTransition(async () => {
      const result = await removeCommentAction(comment.id);
      if (result.ok) toast.success("Comment deleted.");
      else setFailure(result.message);
    });
  }

  return (
    <li className="group flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>{formatDay(comment.createdAt)}</span>
        {edited && (
          <span title={`Edited ${formatDay(comment.updatedAt)}`}>· edited</span>
        )}
        {!editing && (
          <span className="ml-auto flex gap-0.5 opacity-60 group-focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              className={button.icon}
              onClick={() => {
                setDraft(comment.body);
                setEditing(true);
              }}
              aria-label="Edit comment"
              title="Edit"
            >
              <Pencil />
            </button>
            <button
              type="button"
              className={button.icon}
              onClick={remove}
              disabled={pending}
              aria-label="Delete comment"
              title="Delete"
            >
              <Trash2 />
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={saveOnModEnter(save)}
            aria-label="Comment"
            rows={Math.min(12, Math.max(3, draft.split("\n").length + 1))}
            className={`${input} resize-y`}
            autoFocus
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={button.primary}
              onClick={save}
              disabled={pending || !draft.trim()}
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className={button.ghost}
              onClick={() => {
                setEditing(false);
                setFailure(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
      )}
      {failure && <p className="text-sm text-danger">{failure}</p>}
    </li>
  );
}

const saveOnModEnter =
  (save: () => void) => (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      save();
    }
  };
