"use client";

import { CircleQuestionMark, TriangleAlert } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { button } from "./styles";

type Question = {
  // The question itself, such as "Delete Acme Inc.?"
  title: string;
  // What follows from going ahead, when the title doesn't say it all.
  body?: ReactNode;
  // The button that goes ahead, such as "Delete".
  action: string;
  // In red, for what can't be undone.
  danger?: boolean;
};

type Asked = Question & { answer: (yes: boolean) => void };

let asked: Asked | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function show(next: Asked | null) {
  asked = next;
  listeners.forEach((listener) => listener());
}

// The app's confirm(): asks in a dialog and resolves to true when the viewer
// goes ahead, false on Cancel or Escape. Asking again while a question is
// open answers that one no.
export function ask(question: Question): Promise<boolean> {
  asked?.answer(false);
  return new Promise((resolve) => {
    const current: Asked = {
      ...question,
      answer(yes) {
        if (asked === current) show(null);
        resolve(yes);
      },
    };
    show(current);
  });
}

// Where ask() puts its questions, mounted once by the root layout. A native
// <dialog> opened as a modal, so it goes over a Modal already open, such as
// the drawer whose Delete button asked.
export function ConfirmDialog() {
  const question = useSyncExternalStore(
    subscribe,
    () => asked,
    () => null,
  );
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const proceed = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (question) {
      if (!dialog?.open) dialog?.showModal();
      // Enter shouldn't delete: a dangerous question starts on Cancel.
      (question.danger ? cancel : proceed).current?.focus();
    } else if (dialog?.open) dialog.close();
  }, [question]);

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={question?.body ? `${id}-body` : undefined}
      // Escape closes it; a dialog closed while still asking answers no.
      onClose={() => {
        if (!ref.current?.open) asked?.answer(false);
      }}
      className="m-auto w-[min(440px,calc(100vw-2rem))] max-w-none rounded-xl border border-line bg-surface p-0 text-left text-foreground shadow-2xl"
    >
      {question && (
        <div className="flex animate-pop flex-col">
          <div className="flex gap-3.5 px-5 pt-5 pb-4">
            <span
              className={`grid size-9 shrink-0 place-items-center rounded-full ${question.danger ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"}`}
            >
              {question.danger ? (
                <TriangleAlert className="size-[18px]" aria-hidden />
              ) : (
                <CircleQuestionMark className="size-[18px]" aria-hidden />
              )}
            </span>
            <div className="flex min-w-0 flex-col gap-1.5 pt-1.5">
              <h2 id={`${id}-title`} className="text-base font-semibold">
                {question.title}
              </h2>
              {question.body && (
                <div id={`${id}-body`} className="text-sm text-muted">
                  {question.body}
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-line bg-surface-2/50 px-5 py-3">
            <button
              ref={cancel}
              type="button"
              className={button.secondary}
              onClick={() => question.answer(false)}
            >
              Cancel
            </button>
            <button
              ref={proceed}
              type="button"
              className={question.danger ? button.dangerSolid : button.primary}
              onClick={() => question.answer(true)}
            >
              {question.action}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
