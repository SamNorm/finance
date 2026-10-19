"use client";

import { TOTALS } from "@finance/domain/borrowing-bases";
import {
  CONDITIONS,
  LANGUAGES,
  SECTIONS,
  type Block,
  type BlockType,
  type Condition,
  type Definition,
  type Orientation,
  type Source,
} from "@finance/documents/templates";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { IssueList } from "@/components/issue-list";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/menu";
import { Card } from "@/components/page";
import { button, input } from "@/components/styles";
import { Field, Icon, Modal, Segmented } from "@/components/ui";
import type { ActionFailure } from "@/lib/action-result";
import { saveTemplateAction } from "../actions";
import { FieldPicker } from "./field-picker";

// A document's draft: its title and orientation, and its sections in order,
// those that fit what it prints from: an analysis, or a margined line and
// a month. Every change saves straight away; the page comes back with the
// draft's issues and a fresh preview.

export interface ModelChoices {
  name: string;
  // Lines that hold figures, with the section each falls under.
  lines: { code: string; label: string; section: string | null }[];
  charts: { id: string; title: string }[];
}

const GROUPS: { label: string; types: BlockType[] }[] = [
  { label: "Figures", types: ["facts", "lines", "covenants", "charts"] },
  { label: "Deal and debt", types: ["sourcesUses", "debt", "amortization"] },
  {
    label: "Borrowing base",
    types: [
      "bbWaterfall",
      "bbHistory",
      "bbTests",
      "bbCycle",
      "bbProjection",
      "bbSignature",
    ],
  },
  { label: "Text", types: ["heading", "text"] },
  { label: "Layout", types: ["pageBreak"] },
];

// Sections with settings open their dialog when added; the rest go straight
// in.
const SETTINGS = new Set<BlockType>([
  "heading",
  "text",
  "lines",
  "charts",
  "bbHistory",
  "bbTests",
  "bbProjection",
  "bbSignature",
]);

// The months a line's sections cover, up to the month printed.
const MAX_MONTHS = 24;

const totalLabel = (code: string) =>
  TOTALS.find((t) => t.code === code)?.label ?? code;

const ORIENTATIONS: Record<Orientation, string> = {
  portrait: "Portrait",
  landscape: "Landscape",
};

// What a block is set to, the way the section list sums it up.
function summary(
  block: Block,
  model: ModelChoices | null,
  source: Source,
): string {
  const named = <T,>(
    ids: string[],
    find: (id: string) => T | undefined,
    label: (t: T) => string,
  ) => {
    const names = ids.map((id) => {
      const found = find(id);
      return found ? label(found) : id;
    });
    return names.length > 3
      ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`
      : names.join(", ");
  };
  switch (block.type) {
    case "heading":
      return block.text || "No text yet";
    case "text":
      return block.text.replace(/\s+/g, " ").trim() || "No text yet";
    case "lines":
      return [
        block.title,
        block.lines
          ? named(
              block.lines,
              (code) => model?.lines.find((l) => l.code === code),
              (l) => l.label,
            )
          : "Every line, by section",
        block.periods === "recent" ? "from the latest year" : "every period",
      ]
        .filter(Boolean)
        .join(" · ");
    case "charts":
      if (source === "line")
        return `Every chart of the borrowing base, ${block.months ?? 12} months`;
      return block.charts
        ? named(
            block.charts,
            (id) => model?.charts.find((c) => c.id === id),
            (c) => c.title,
          )
        : "Every chart, the model's and the analysis's";
    case "bbHistory":
      return [
        block.lines
          ? named(block.lines, (code) => code, totalLabel)
          : "The main totals",
        `${block.months ?? 12} months`,
      ].join(" · ");
    case "bbTests":
      return block.months === 1
        ? "The month's tests"
        : `Each test, ${block.months ?? 12} months`;
    case "bbProjection":
      return block.lines
        ? named(block.lines, (code) => code, totalLabel)
        : "The main totals";
    case "bbSignature":
      return (
        block.text?.replace(/\s+/g, " ").trim() ||
        "The app's statement, then signature lines"
      );
    default:
      return SECTIONS[block.type].description;
  }
}

export function TemplateEditor({
  templateId,
  draft,
  source,
  model,
}: {
  templateId: string;
  draft: Definition;
  // What it prints from; its sections are those that fit.
  source: Source;
  // The model it reads; null for none.
  model: ModelChoices | null;
}) {
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  // The section open in the dialog, and where it goes: null adds it last.
  const [editing, setEditing] = useState<{
    index: number | null;
    block: Block;
  } | null>(null);

  function save(change: Partial<Definition>, then?: () => void) {
    setFailure(null);
    startTransition(async () => {
      const result = await saveTemplateAction(templateId, change);
      if (!result.ok) setFailure(result);
      else then?.();
    });
  }

  const { blocks } = draft;
  const saveBlocks = (next: Block[], then?: () => void) =>
    save({ blocks: next }, then);
  const move = (index: number, by: -1 | 1) => {
    const next = [...blocks];
    [next[index], next[index + by]] = [next[index + by]!, next[index]!];
    saveBlocks(next);
  };
  const add = (type: BlockType) => {
    const block = {
      type,
      ...(type === "heading" || type === "text" ? { text: "" } : {}),
    } as Block;
    if (SETTINGS.has(type)) setEditing({ index: null, block });
    else saveBlocks([...blocks, block]);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card title="Title and layout">
        <div className="flex flex-col gap-4">
          <TitleField
            key={draft.title}
            initial={draft.title}
            source={source}
            lines={model?.lines ?? []}
            disabled={pending}
            onSave={(title) => save({ title })}
          />
          <Field
            label="Orientation"
            hint={
              source === "line"
                ? "Landscape fits a year of months."
                : "Landscape fits every period of an analysis."
            }
            group
          >
            <Segmented
              name="orientation"
              options={ORIENTATIONS}
              value={draft.orientation}
              disabled={pending}
              onChange={(orientation) => save({ orientation })}
            />
          </Field>
          <Field
            label="Language"
            hint="Of the document's own wording, figures and dates. Line labels and your text print as written."
            group
          >
            <Segmented
              name="language"
              options={LANGUAGES}
              value={draft.language ?? "en"}
              disabled={pending}
              onChange={(language) => save({ language })}
            />
          </Field>
        </div>
      </Card>

      <Card
        title="Sections"
        description={
          source === "line"
            ? "In the order they print. Each reads the line and month printed."
            : "In the order they print. Each reads the analysis and scenario printed."
        }
        flush
        actions={
          <Menu
            label="Add a section"
            trigger={
              <button
                type="button"
                className={button.secondary}
                disabled={pending}
              >
                <Plus />
                Add a section
              </button>
            }
          >
            {GROUPS.map((group) => ({
              ...group,
              types: group.types.filter((t) =>
                SECTIONS[t].sources.includes(source),
              ),
            }))
              .filter((group) => group.types.length)
              .map((group, i) => (
                <div key={group.label}>
                  {i > 0 && <MenuSeparator />}
                  <MenuLabel>{group.label}</MenuLabel>
                  {group.types.map((type) => (
                    <MenuItem key={type} onSelect={() => add(type)}>
                      <span className="flex flex-col">
                        <span>{SECTIONS[type].label}</span>
                        <span className="text-xs text-muted">
                          {SECTIONS[type].description}
                        </span>
                      </span>
                    </MenuItem>
                  ))}
                </div>
              ))}
          </Menu>
        }
      >
        {blocks.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">
            No sections yet. Add the first: facts about the borrower are a good
            start.
          </p>
        ) : (
          <ol className="divide-y divide-line">
            {blocks.map((block, index) => (
              <li key={index} className="flex items-start gap-3 px-4 py-2.5">
                <span className="w-5 shrink-0 pt-0.5 text-right text-xs text-muted tabular-nums">
                  {index + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {SECTIONS[block.type].label}
                    {block.when && (
                      <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs font-normal text-accent">
                        Only when: {CONDITIONS[block.when].toLowerCase()}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {summary(block, model, source)}
                  </span>
                </div>
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    className={button.icon}
                    aria-label="Move up"
                    disabled={pending || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <Icon name="up" />
                  </button>
                  <button
                    type="button"
                    className={button.icon}
                    aria-label="Move down"
                    disabled={pending || index === blocks.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <Icon name="down" />
                  </button>
                  <button
                    type="button"
                    className={button.icon}
                    aria-label={`Edit section ${index + 1}`}
                    disabled={pending}
                    onClick={() => setEditing({ index, block })}
                  >
                    <Pencil />
                  </button>
                  <button
                    type="button"
                    className={button.icon}
                    aria-label={`Remove section ${index + 1}`}
                    disabled={pending}
                    onClick={() =>
                      saveBlocks(blocks.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
        {failure && !editing && (
          <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
            <p className="text-sm text-danger">{failure.message}</p>
            {failure.issues.length > 0 && <IssueList issues={failure.issues} />}
          </div>
        )}
      </Card>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing
            ? `${editing.index === null ? "Add" : "Edit"} ${SECTIONS[editing.block.type].label.toLowerCase()}`
            : ""
        }
      >
        {editing && (
          <SectionForm
            key={`${editing.index}`}
            initial={editing.block}
            source={source}
            model={model}
            pending={pending}
            failure={failure}
            adding={editing.index === null}
            onCancel={() => setEditing(null)}
            onSave={(block) => {
              const next =
                editing.index === null
                  ? [...blocks, block]
                  : blocks.map((b, i) => (i === editing.index ? block : b));
              saveBlocks(next, () => {
                toast.success("Section saved.");
                setEditing(null);
              });
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function TitleField({
  initial,
  source,
  lines,
  disabled,
  onSave,
}: {
  initial: string;
  source: Source;
  lines: { code: string; label: string }[];
  disabled: boolean;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const commit = () => {
    if (title.trim() !== initial) onSave(title);
  };
  return (
    <Field
      label="Title"
      hint="On the first page and at the foot of every page."
      group
    >
      <div className="flex gap-2">
        <input
          ref={ref}
          value={title}
          aria-label="Title"
          disabled={disabled}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") ref.current?.blur();
          }}
          className={input}
        />
        <FieldPicker
          target={ref}
          value={title}
          onChange={(value) => {
            setTitle(value);
            if (value.trim() !== initial) onSave(value);
          }}
          lines={lines}
          source={source}
        />
      </div>
    </Field>
  );
}

// One section's settings, and when it shows.
function SectionForm({
  initial,
  source,
  model,
  pending,
  failure,
  adding,
  onCancel,
  onSave,
}: {
  initial: Block;
  source: Source;
  model: ModelChoices | null;
  pending: boolean;
  failure: ActionFailure | null;
  adding: boolean;
  onCancel: () => void;
  onSave: (block: Block) => void;
}) {
  const { type } = initial;
  const [text, setText] = useState(
    initial.type === "heading" ||
      initial.type === "text" ||
      initial.type === "bbSignature"
      ? (initial.text ?? "")
      : "",
  );
  // A line's sections: the months they cover, and the figures they show.
  const [months, setMonths] = useState(
    "months" in initial && initial.months ? String(initial.months) : "",
  );
  const [codes, setCodes] = useState<string[] | null>(
    initial.type === "bbHistory" || initial.type === "bbProjection"
      ? (initial.lines ?? null)
      : null,
  );
  const [title, setTitle] = useState(
    initial.type === "lines" ? (initial.title ?? "") : "",
  );
  const [picked, setPicked] = useState<string[] | null>(
    initial.type === "lines"
      ? (initial.lines ?? null)
      : initial.type === "charts"
        ? (initial.charts ?? null)
        : null,
  );
  const [periods, setPeriods] = useState<"all" | "recent">(
    initial.type === "lines" ? (initial.periods ?? "all") : "all",
  );
  const [when, setWhen] = useState<Condition | "">(initial.when ?? "");
  const textRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const lines = model?.lines ?? [];

  function block(): Block {
    const condition = when ? { when } : {};
    const covering = Number(months) ? { months: Number(months) } : {};
    switch (type) {
      case "heading":
      case "text":
        return { type, text, ...condition };
      case "bbSignature":
        return { type, ...(text.trim() ? { text } : {}), ...condition };
      case "bbHistory":
        return {
          type,
          ...(codes?.length ? { lines: codes } : {}),
          ...covering,
          ...condition,
        };
      case "bbTests":
        return { type, ...covering, ...condition };
      case "bbProjection":
        return {
          type,
          ...(codes?.length ? { lines: codes } : {}),
          ...condition,
        };
      case "lines":
        return {
          type,
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(picked ? { lines: picked } : {}),
          periods,
          ...condition,
        };
      case "charts":
        return source === "line"
          ? { type, ...covering }
          : { type, ...(picked ? { charts: picked } : {}), ...condition };
      default:
        return { type, ...condition } as Block;
    }
  }

  const toggle = (id: string) =>
    setPicked((list) =>
      list?.includes(id) ? list.filter((x) => x !== id) : [...(list ?? []), id],
    );
  const noModel = (
    <span>
      To pick, choose the financial model it reads under{" "}
      <strong>Edit details</strong>.
    </span>
  );
  // The model's lines under their sections, to pick from.
  const sections = lines.reduce<
    { section: string | null; lines: typeof lines }[]
  >((groups, line) => {
    const last = groups.at(-1);
    if (last && last.section === line.section) last.lines.push(line);
    else groups.push({ section: line.section, lines: [line] });
    return groups;
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(block());
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
        <p className="text-sm text-muted">{SECTIONS[type].description}</p>
        {type === "heading" && (
          <Field label="Heading" group>
            <div className="flex gap-2">
              <input
                ref={headingRef}
                value={text}
                aria-label="Heading"
                autoFocus
                onChange={(e) => setText(e.target.value)}
                className={input}
                placeholder="Recommendation for {{borrower.name}}"
              />
              <FieldPicker
                target={headingRef}
                value={text}
                onChange={setText}
                lines={lines}
                source={source}
              />
            </div>
          </Field>
        )}
        {type === "text" && (
          <Field
            label="Text"
            hint="A blank line starts a paragraph. Lines starting with - are bullets; **bold** and *italics* work too. Figures come from merge fields, never typed."
            group
          >
            <div className="flex flex-col gap-2">
              <FieldPicker
                target={textRef}
                value={text}
                onChange={setText}
                lines={lines}
                source={source}
              />
              <textarea
                ref={textRef}
                value={text}
                aria-label="Text"
                autoFocus
                rows={10}
                onChange={(e) => setText(e.target.value)}
                className={`${input} font-mono text-[13px]`}
              />
            </div>
          </Field>
        )}
        {type === "lines" && (
          <>
            <Field label="Title (optional)" hint="Shown above the table." group>
              <div className="flex gap-2">
                <input
                  ref={titleRef}
                  value={title}
                  aria-label="Title"
                  onChange={(e) => setTitle(e.target.value)}
                  className={input}
                  placeholder="Coverage and leverage"
                />
                <FieldPicker
                  target={titleRef}
                  value={title}
                  onChange={setTitle}
                  lines={lines}
                />
              </div>
            </Field>
            <Field label="Periods" group>
              <Segmented
                name="periods"
                options={{
                  all: "Every period",
                  recent: "From the latest year",
                }}
                value={periods}
                onChange={setPeriods}
              />
            </Field>
          </>
        )}
        {type === "bbSignature" && (
          <Field
            label="Statement (optional)"
            hint="Printed above the signature lines. Blank for the app's: that the information above is true and complete."
            group
          >
            <div className="flex flex-col gap-2">
              <FieldPicker
                target={textRef}
                value={text}
                onChange={setText}
                lines={[]}
                source={source}
              />
              <textarea
                ref={textRef}
                value={text}
                aria-label="Statement"
                autoFocus
                rows={4}
                onChange={(e) => setText(e.target.value)}
                className={input}
              />
            </div>
          </Field>
        )}
        {(type === "bbHistory" || type === "bbProjection") && (
          <Field
            label="Figures"
            hint="Month by month, in this order. Any borrowing base's line codes work too, such as AR.MARGINED."
            group
          >
            <Segmented
              name="figures"
              options={{ all: "The main totals", picked: "Those I pick" }}
              value={codes ? "picked" : "all"}
              onChange={(v) => setCodes(v === "all" ? null : (codes ?? []))}
            />
            {codes && (
              <>
                <div className="max-h-56 overflow-y-auto rounded-md border border-line">
                  {TOTALS.map((t) => (
                    <Check
                      key={t.code}
                      checked={codes.includes(t.code)}
                      onChange={() =>
                        setCodes(
                          codes.includes(t.code)
                            ? codes.filter((c) => c !== t.code)
                            : [...codes, t.code],
                        )
                      }
                      label={t.label}
                      code={t.code}
                    />
                  ))}
                </div>
                <input
                  value={codes
                    .filter((c) => !TOTALS.some((t) => t.code === c))
                    .join(", ")}
                  onChange={(e) =>
                    setCodes([
                      ...codes.filter((c) => TOTALS.some((t) => t.code === c)),
                      ...e.target.value
                        .split(",")
                        .map((c) => c.trim().toUpperCase())
                        .filter(Boolean),
                    ])
                  }
                  aria-label="Other codes"
                  placeholder="Other codes, such as AR.MARGINED, INVENTORY.MARGINED"
                  className={`${input} font-mono text-xs`}
                />
              </>
            )}
          </Field>
        )}
        {(type === "bbHistory" ||
          type === "bbTests" ||
          (type === "charts" && source === "line")) && (
          <Field
            label="Months"
            hint={
              type === "bbTests"
                ? `Up to the month printed, 1 to ${MAX_MONTHS}; 1 for the month's tests alone. 12 when blank.`
                : `Up to the month printed, 1 to ${MAX_MONTHS}. 12 when blank.`
            }
          >
            <input
              value={months}
              onChange={(e) => setMonths(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="12"
              className={`${input.replace("w-full ", "")} w-24 text-right tabular-nums`}
            />
          </Field>
        )}
        {(type === "lines" || (type === "charts" && source === "analysis")) && (
          <Field
            label={type === "lines" ? "Lines" : "Charts"}
            hint={!model ? noModel : undefined}
            group
          >
            <Segmented
              name="pick"
              options={
                type === "lines"
                  ? { all: "Every line, by section", picked: "Those I pick" }
                  : { all: "Every chart", picked: "Those I pick" }
              }
              value={picked ? "picked" : "all"}
              disabled={!model && !picked}
              onChange={(v) => setPicked(v === "all" ? null : (picked ?? []))}
            />
            {picked && model && (
              <div className="max-h-72 overflow-y-auto rounded-md border border-line">
                {type === "lines" ? (
                  sections.map((group, i) => (
                    <div key={i}>
                      {group.section && (
                        <p className="bg-surface-2/60 px-3 py-1.5 text-xs font-medium text-muted">
                          {group.section}
                        </p>
                      )}
                      {group.lines.map((line) => (
                        <Check
                          key={line.code}
                          checked={picked.includes(line.code)}
                          onChange={() => toggle(line.code)}
                          label={line.label}
                          code={line.code}
                        />
                      ))}
                    </div>
                  ))
                ) : model.charts.length ? (
                  model.charts.map((chart) => (
                    <Check
                      key={chart.id}
                      checked={picked.includes(chart.id)}
                      onChange={() => toggle(chart.id)}
                      label={chart.title}
                    />
                  ))
                ) : (
                  <p className="px-3 py-2 text-sm text-muted">
                    {model.name} has no charts. The analysis&apos;s own show
                    with every chart.
                  </p>
                )}
              </div>
            )}
          </Field>
        )}
        {/* Conditions are about an analysis; a line's sections always show. */}
        {source === "analysis" && (
          <Field label="Show">
            <select
              value={when}
              onChange={(e) => setWhen(e.target.value as Condition | "")}
              className={input}
            >
              <option value="">Always</option>
              {(Object.entries(CONDITIONS) as [Condition, string][]).map(
                ([value, label]) => (
                  <option key={value} value={value}>
                    Only when: {label.toLowerCase()}
                  </option>
                ),
              )}
            </select>
          </Field>
        )}
        {failure && (
          <div className="flex flex-col gap-2 rounded-md bg-danger-soft p-3">
            <p className="text-sm font-medium text-danger">{failure.message}</p>
            {failure.issues.length > 0 && <IssueList issues={failure.issues} />}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button type="button" className={button.ghost} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={button.primary}>
          {pending ? "Saving…" : adding ? "Add section" : "Save section"}
        </button>
      </div>
    </form>
  );
}

function Check({
  checked,
  onChange,
  label,
  code,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  code?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-surface-2/60">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="flex-1">{label}</span>
      {code && <span className="font-mono text-xs text-muted">{code}</span>}
    </label>
  );
}
