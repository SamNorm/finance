"use client";

import { Gauge } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useState, useTransition } from "react";
import { ask } from "@/components/confirm";
import { button } from "@/components/styles";
import { Modal } from "@/components/ui";
import { startBorrowingBaseAction } from "../actions";

// What a line's borrowing base can start from: a built-in, one of the
// organization's published templates, or another margined line's. The
// copy is the line's own from then on (borrowing-base-plan.md §5.1).
export interface MarginSources {
  builtIns: { id: string; name: string; description: string }[];
  templates: { id: string; name: string; description: string | null }[];
  lines: { lineId: string; name: string; entityName: string }[];
}

type Choice = `builtin:${string}` | `template:${string}` | `line:${string}`;

const fromChoice = (choice: Choice) => {
  const [kind, id] = choice.split(/:(.*)/) as [string, string];
  return kind === "builtin"
    ? { builtIn: id }
    : kind === "template"
      ? { templateId: id }
      : { lineId: id };
};

// The button that margins a line, or starts its borrowing base over.
export function MarginLine({
  lineId,
  lineName,
  sources,
  variant = "ghost",
}: {
  lineId: string;
  lineName: string;
  sources: MarginSources;
  variant?: "primary" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={
          variant === "primary"
            ? button.primary
            : `${button.ghost} px-2 py-1 text-xs text-accent`
        }
        onClick={() => setOpen(true)}
      >
        <Gauge />
        Margin this line
      </button>
      <MarginDialog
        open={open}
        onClose={() => setOpen(false)}
        lineId={lineId}
        lineName={lineName}
        sources={sources}
      />
    </>
  );
}

export function MarginDialog({
  open,
  onClose,
  lineId,
  lineName,
  sources,
  replacing = false,
}: {
  open: boolean;
  onClose: () => void;
  lineId: string;
  lineName: string;
  sources: MarginSources;
  // Starting over: the line's borrowing base is replaced.
  replacing?: boolean;
}) {
  const router = useRouter();
  const first = sources.builtIns[0];
  const [choice, setChoice] = useState<Choice | null>(
    first ? `builtin:${first.id}` : null,
  );
  const [pending, startStart] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  const nameOf = (c: Choice) => {
    const {
      builtIn,
      templateId,
      lineId: id,
    } = fromChoice(c) as Record<string, string | undefined>;
    return (
      sources.builtIns.find((b) => b.id === builtIn)?.name ??
      sources.templates.find((t) => t.id === templateId)?.name ??
      sources.lines.find((l) => l.lineId === id)?.name ??
      ""
    );
  };

  async function start() {
    if (!choice) return;
    if (
      replacing &&
      !(await ask({
        title: `Replace ${lineName}'s borrowing base?`,
        body: `Its lines and terms are replaced with ${nameOf(choice)}'s; its months of certificates are kept.`,
        action: "Replace",
        danger: true,
      }))
    )
      return;
    setFailure(null);
    startStart(async () => {
      const result = await startBorrowingBaseAction(lineId, fromChoice(choice));
      if (!result.ok) return setFailure(result.message);
      // Closed before leaving: a page kept hidden for the back button would
      // otherwise keep its modal open over the next one.
      onClose();
      startTransition(() =>
        router.push(`/borrowing-bases/${lineId}?tab=terms`),
      );
    });
  }

  const option = (value: Choice, name: string, description: string | null) => (
    <label
      key={value}
      className="flex cursor-pointer items-start gap-3 rounded-md border border-line px-3 py-2 hover:bg-surface-2/60 has-checked:border-accent has-checked:bg-accent-soft/40"
    >
      <input
        type="radio"
        name="from"
        checked={choice === value}
        onChange={() => setChoice(value)}
        className="mt-1"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{name}</span>
        {description && (
          <span className="text-xs text-muted">{description}</span>
        )}
      </span>
    </label>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={replacing ? `Start ${lineName} over` : `Margin ${lineName}`}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <p className="text-sm text-muted">
          {replacing
            ? "Its lines and terms are replaced by those of the one you choose. Its months of certificates are kept; figures of lines it no longer has stop counting."
            : "Start from a standard structure, then set its advance rates and caps to the credit agreement. It's the line's own from then on."}
        </p>
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1.5 text-xs font-medium text-muted">
            Built in
          </legend>
          {sources.builtIns.map((b) =>
            option(`builtin:${b.id}`, b.name, b.description),
          )}
        </fieldset>
        {sources.templates.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="pb-1.5 text-xs font-medium text-muted">
              Your organization&apos;s templates
            </legend>
            {sources.templates.map((t) =>
              option(`template:${t.id}`, t.name, t.description),
            )}
          </fieldset>
        )}
        {sources.lines.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="pb-1.5 text-xs font-medium text-muted">
              Copy another line&apos;s
            </legend>
            {sources.lines.map((l) =>
              option(`line:${l.lineId}`, `${l.name} · ${l.entityName}`, null),
            )}
          </fieldset>
        )}
        {failure && <p className="text-sm text-danger">{failure}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button type="button" className={button.ghost} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={button.primary}
          disabled={!choice || pending}
          onClick={start}
        >
          {pending
            ? "Starting…"
            : replacing
              ? "Replace the borrowing base"
              : "Margin the line"}
        </button>
      </div>
    </Modal>
  );
}
