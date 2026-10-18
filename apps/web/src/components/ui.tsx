"use client";

import { ArrowDown, ArrowUp, Plus, Upload, X } from "lucide-react";
import {
  startTransition,
  useEffect,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { button } from "./styles";

// React resets a form after its `action` prop runs, which would wipe what the
// user typed when the server rejects it. Submitting through onSubmit with the
// same action keeps the fields.
export function keepFields(dispatch: (form: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const form = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(form));
  };
}

// A native <dialog>, opened as a modal while `open` is true. Escape and the
// close button call onClose. `side` turns it into a full-height panel; `wide`
// gives a centered one more room.
export function Modal({
  open,
  onClose,
  title,
  side = false,
  wide = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  side?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={
        side
          ? "fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[min(460px,100vw)] max-w-none border-l border-line bg-surface p-0 text-foreground shadow-2xl"
          : `m-auto ${wide ? "w-[min(1040px,calc(100vw-2rem))]" : "w-[min(720px,calc(100vw-2rem))]"} max-w-none rounded-xl border border-line bg-surface p-0 text-foreground shadow-2xl`
      }
    >
      {open && (
        <div
          className={
            side ? "flex h-full flex-col" : "flex max-h-[85dvh] flex-col"
          }
        >
          <div className="flex items-center gap-3 border-b border-line px-5 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className={`${button.icon} ml-auto`}
              aria-label="Close"
            >
              <Icon name="close" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

// A labeled field. `group` is for controls with labels of their own, such as
// Segmented, which can't sit inside another label.
export function Field({
  label,
  hint,
  group = false,
  children,
}: {
  label: string;
  hint?: ReactNode;
  group?: boolean;
  children: ReactNode;
}) {
  const content = (
    <>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </>
  );
  return group ? (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      {content}
    </div>
  ) : (
    <label className="flex flex-col gap-1.5">{content}</label>
  );
}

// Radio buttons styled as a segmented control; the value is submitted as `name`.
export function Segmented<T extends string>({
  name,
  options,
  value,
  onChange,
  disabled,
}: {
  name: string;
  options: Record<T, string>;
  value: T;
  onChange?: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex rounded-md border border-line bg-surface-2 p-0.5">
      {(Object.entries(options) as [T, string][]).map(([option, label]) => (
        <label
          key={option}
          className="flex-1 cursor-pointer rounded px-2 py-1 text-center text-sm whitespace-nowrap text-muted has-checked:bg-surface has-checked:font-medium has-checked:text-foreground has-checked:shadow-xs has-disabled:cursor-default"
        >
          <input
            type="radio"
            name={name}
            value={option}
            defaultChecked={onChange ? undefined : option === value}
            checked={onChange ? option === value : undefined}
            onChange={() => onChange?.(option)}
            disabled={disabled}
            className="sr-only"
          />
          {label}
        </label>
      ))}
    </div>
  );
}

const icons = {
  close: X,
  up: ArrowUp,
  down: ArrowDown,
  plus: Plus,
  upload: Upload,
};

export function Icon({ name }: { name: keyof typeof icons }) {
  const Glyph = icons[name];
  return <Glyph className="size-4" aria-hidden />;
}
