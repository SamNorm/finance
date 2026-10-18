"use client";

import { ImageUp, X } from "lucide-react";
import { useState, useTransition } from "react";
import { Card } from "@/components/page";
import { button, input } from "@/components/styles";
import { Field } from "@/components/ui";
import { saveBrandingAction } from "../actions";

// How the organization's documents look: a colour for headings and rules,
// a logo in each document's corner, and the notice at the foot of every
// page. Saved together.
export function BrandingForm({
  organization,
  branding,
}: {
  organization: string;
  branding: { color?: string; logo?: string; notice?: string };
}) {
  const [color, setColor] = useState(branding.color ?? "");
  const [logo, setLogo] = useState(branding.logo ?? "");
  const [notice, setNotice] = useState(branding.notice ?? "");
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  function pick(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.readAsDataURL(file);
  }

  function save() {
    setFeedback(null);
    startTransition(async () => {
      const result = await saveBrandingAction({ color, logo, notice });
      setFeedback(
        result.ok
          ? {
              ok: true,
              message: "Saved. Documents printed from now on use it.",
            }
          : { ok: false, message: result.message },
      );
    });
  }

  return (
    <Card
      title="Branding"
      description="Every document printed from now on carries it; those already printed stay as they were."
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="flex flex-col gap-4">
          <Field
            label="Colour"
            hint="For titles, headings and rules, as #RRGGBB. Blank for the default navy."
          >
            <span className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Pick a colour"
                value={color || "#1e3a8a"}
                onChange={(e) => setColor(e.target.value)}
                className="h-8 w-10 shrink-0 cursor-pointer rounded border border-line bg-surface p-0.5"
              />
              <input
                value={color}
                placeholder="#1e3a8a"
                onChange={(e) => setColor(e.target.value)}
                className={`${input} font-mono`}
              />
            </span>
          </Field>
          <Field
            label="Notice"
            hint={`At the foot of every page. Blank for "${organization} · Confidential".`}
          >
            <textarea
              rows={2}
              value={notice}
              maxLength={300}
              placeholder="Confidential: for the credit file only."
              onChange={(e) => setNotice(e.target.value)}
              className={input}
            />
          </Field>
          <Field
            label="Logo"
            group
            hint="PNG, JPEG, SVG or WebP, under about 200 KB. In each document's top corner, in place of the organization's name."
          >
            <span className="flex flex-wrap items-center gap-2">
              <label className={`${button.secondary} cursor-pointer`}>
                <ImageUp />
                {logo ? "Replace" : "Choose an image"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="sr-only"
                  onChange={(e) => pick(e.target.files?.[0])}
                />
              </label>
              {logo && (
                <button
                  type="button"
                  className={button.ghost}
                  onClick={() => setLogo("")}
                >
                  <X />
                  Remove
                </button>
              )}
            </span>
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={button.primary}
              onClick={save}
              disabled={pending}
            >
              {pending ? "Saving…" : "Save branding"}
            </button>
            {feedback && (
              <span
                className={`text-sm ${feedback.ok ? "text-success" : "text-danger"}`}
              >
                {feedback.message}
              </span>
            )}
          </div>
        </div>
        {/* How a document's top reads with it. */}
        <div
          aria-label="Preview"
          className="flex flex-col gap-2 self-start rounded-lg border border-line bg-white p-4 text-slate-900"
        >
          <div
            className="flex items-start justify-between gap-3 border-b-2 pb-2"
            style={{
              borderColor: /^#[0-9a-f]{6}$/i.test(color) ? color : "#1e3a8a",
            }}
          >
            <span className="text-sm font-semibold">
              Borrower: deal summary
            </span>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="max-h-8 max-w-24" />
            ) : (
              <span
                className="text-xs font-semibold"
                style={{
                  color: /^#[0-9a-f]{6}$/i.test(color) ? color : "#1e3a8a",
                }}
              >
                {organization}
              </span>
            )}
          </div>
          <span className="mt-6 text-[10px] text-slate-500">
            {notice.trim() || `${organization} · Confidential`} · Page 1 of 3
          </span>
        </div>
      </div>
    </Card>
  );
}
