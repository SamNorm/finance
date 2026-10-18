"use client";

import { MERGE_FIELDS } from "@finance/documents/templates";
import type { RefObject } from "react";
import { input } from "@/components/styles";

// Inserts a merge field where the cursor is in a text box. A plain select,
// so it works inside a dialog, where menus can't open.
export function FieldPicker({
  target,
  value,
  onChange,
  lines,
}: {
  target: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  // The model's lines, when the document reads one.
  lines: { code: string; label: string }[];
}) {
  function insert(field: string) {
    if (!field) return;
    const token = `{{${field}}}`;
    const box = target.current;
    const start = box?.selectionStart ?? value.length;
    const end = box?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(start + token.length, start + token.length);
    });
  }
  return (
    <select
      value=""
      onChange={(e) => insert(e.target.value)}
      className={`${input} w-auto max-w-56 text-muted`}
      aria-label="Insert a merge field"
    >
      <option value="">Insert a field…</option>
      <optgroup label="Fields">
        {Object.entries(MERGE_FIELDS).map(([field, label]) => (
          <option key={field} value={field}>
            {label}
          </option>
        ))}
      </optgroup>
      {lines.length > 0 && (
        <optgroup label="A line, latest fiscal year">
          {lines.map((l) => (
            <option key={l.code} value={`line.${l.code}`}>
              {l.label}
            </option>
          ))}
        </optgroup>
      )}
      {lines.length > 0 && (
        <optgroup label="A line, latest year post-project">
          {lines.map((l) => (
            <option key={l.code} value={`line.${l.code}.post`}>
              {l.label}, post-project
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
