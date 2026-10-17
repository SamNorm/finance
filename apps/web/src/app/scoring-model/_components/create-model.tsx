"use client";

import { useActionState, useState } from "react";
import { createModelAction } from "../actions";
import type { ActionResult } from "../types";
import { button, Field, input, keepFields } from "./ui";

const SOURCES = {
  mirrored: {
    title: "Mirror an existing system",
    body: "Copy the inputs of the institution's spreading system, such as CreditLens or an in-house rating model, so spreads paste in as is.",
  },
  native: {
    title: "Define your own input sheet",
    body: "For organizations without a scoring system. The sheet plays the same role: figures are entered once and every financial model reads them.",
  },
};

export function CreateModel() {
  const [source, setSource] = useState<keyof typeof SOURCES>("mirrored");
  const [state, formAction, pending] = useActionState(
    async (_: ActionResult | null, form: FormData) => createModelAction(form),
    null,
  );

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Set up the scoring model
        </h1>
        <p className="text-sm text-muted">
          The scoring model lists the inputs analysts enter for each borrower.
          Every financial model is built on it. You can import the item list or
          build it by hand next.
        </p>
      </div>
      <form onSubmit={keepFields(formAction)} className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(SOURCES) as (keyof typeof SOURCES)[]).map((key) => (
            <label
              key={key}
              className="flex cursor-pointer flex-col gap-1 rounded-lg border border-line bg-surface p-4 has-checked:border-accent has-checked:ring-2 has-checked:ring-accent/20"
            >
              <input
                type="radio"
                name="source"
                value={key}
                checked={source === key}
                onChange={() => setSource(key)}
                className="sr-only"
              />
              <span className="text-sm font-medium">{SOURCES[key].title}</span>
              <span className="text-xs text-muted">{SOURCES[key].body}</span>
            </label>
          ))}
        </div>
        <Field label="Name">
          <input
            name="name"
            required
            className={input}
            placeholder="Commercial spreading template"
          />
        </Field>
        {source === "mirrored" && (
          <Field label="Source system" hint="The system this model mirrors.">
            <input
              name="sourceSystem"
              className={input}
              placeholder="CreditLens"
            />
          </Field>
        )}
        <Field label="Description (optional)">
          <textarea name="description" rows={2} className={input} />
        </Field>
        {state && !state.ok && (
          <p className="text-sm text-danger">{state.message}</p>
        )}
        <div>
          <button type="submit" disabled={pending} className={button.primary}>
            {pending ? "Creating…" : "Create scoring model"}
          </button>
        </div>
      </form>
    </div>
  );
}
