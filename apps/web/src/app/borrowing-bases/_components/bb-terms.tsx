"use client";

import type { Issue } from "@finance/domain";
import type { BorrowingBaseDefinition } from "@finance/domain/borrowing-bases";
import type { Term } from "@finance/domain/terms";
import { CalendarClock, Pencil } from "lucide-react";
import Link from "next/link";
import {
  startTransition,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { toast } from "sonner";
import { IssueList } from "@/components/issue-list";
import { Card } from "@/components/page";
import { button, input } from "@/components/styles";
import { TermChanges } from "@/components/term-editor";
import { Field, Modal, Segmented } from "@/components/ui";
import { addMonths, type Figure } from "@/lib/borrowing-bases";
import { describeTerm, termDraft, termInput } from "@/lib/credit-lines";
import { formatFigure } from "@/lib/format";
import {
  setBorrowingBaseDefinitionAction,
  setBorrowingBaseTermAction,
  updateMarginedLineAction,
} from "../actions";
import { DefinitionEditor } from "./definition-editor";

interface LineFacts {
  name: string;
  currency: string;
  limit: Term;
  rate: string;
  certificateDueDays: number | null;
  entityId: string;
}

// The input style without its full width, so fields keep their own.
const box = input.replace("w-full ", "");

// The line's own terms, then its borrowing base's definition: its lines
// and tests, edited as a whole, then saved. A common amendment, a term
// changing from a month, saves on its own.
export function BorrowingBaseTerms({
  lineId,
  line,
  definition,
  items,
  figures,
}: {
  lineId: string;
  line: LineFacts;
  definition: BorrowingBaseDefinition;
  // The borrower's balance sheet items, which lines reconcile with.
  items: { code: string; label: string }[];
  // What tests can read.
  figures: Figure[];
}) {
  // Warnings from the last save, which outlive the editor it remounts.
  const [warnings, setWarnings] = useState<Issue[]>([]);
  // Charts are saved from their tab: they don't reset unsaved changes here.
  const edited = JSON.stringify({ ...definition, charts: undefined });
  return (
    <div className="flex flex-col gap-4">
      <LineCard lineId={lineId} line={line} />
      {warnings.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-warning/30 bg-warning-soft/40 px-4 py-3">
          <p className="text-sm font-medium">Saved, with warnings</p>
          <IssueList issues={warnings} />
        </div>
      )}
      <DefinitionEditor
        key={edited}
        currency={line.currency}
        definition={definition}
        items={items}
        figures={figures}
        onSave={(next, renames) =>
          setBorrowingBaseDefinitionAction(lineId, next, renames)
        }
        onWarnings={setWarnings}
        description={
          definition.basedOn
            ? `Started from ${definition.basedOn.name}; the line's own since. Click a line to edit it, then save the whole borrowing base.`
            : "Click a line to edit it, then save the whole borrowing base."
        }
        unsaved="Unsaved changes. Results and certificates follow the saved borrowing base until you save."
        actions={(dirty) => (
          <TermChangeButton
            lineId={lineId}
            definition={definition}
            dirty={dirty}
            onWarnings={setWarnings}
          />
        )}
      />
    </div>
  );
}

// The line of credit's own terms: its limit, which can step and be
// seasonal, and when certificates are due.
function LineCard({ lineId, line }: { lineId: string; line: LineFacts }) {
  const [editing, setEditing] = useState(false);
  return (
    <Card
      title="The line"
      description="Its own terms, as on the borrower's Existing debt tab."
      actions={
        <>
          <Link
            href={`/borrowers/${line.entityId}?tab=existing-debt`}
            className={button.ghost}
          >
            Existing debt
          </Link>
          <button
            type="button"
            className={button.secondary}
            onClick={() => setEditing(true)}
          >
            <Pencil />
            Edit
          </button>
        </>
      }
    >
      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[auto_auto_1fr]">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted">Authorized limit</dt>
          <dd className="tabular-nums">
            {describeTerm(line.limit)} {line.currency}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted">Rate</dt>
          <dd className="tabular-nums">{formatFigure(line.rate, "percent")}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted">Certificate due</dt>
          <dd>
            {line.certificateDueDays === null ? (
              <span className="text-muted">
                Not set: late certificates aren&apos;t flagged.
              </span>
            ) : (
              `${line.certificateDueDays} days after each month's end`
            )}
          </dd>
        </div>
      </dl>
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title={`Edit ${line.name}`}
      >
        <LineForm
          lineId={lineId}
          line={line}
          onDone={() => setEditing(false)}
        />
      </Modal>
    </Card>
  );
}

function LineForm({
  lineId,
  line,
  onDone,
}: {
  lineId: string;
  line: LineFacts;
  onDone: () => void;
}) {
  const [limit, setLimit] = useState(() => termDraft(line.limit));
  const [due, setDue] = useState(
    line.certificateDueDays === null ? "" : String(line.certificateDueDays),
  );
  const [pending, startSave] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  function save(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    startSave(async () => {
      const result = await updateMarginedLineAction(lineId, {
        limit: termInput(limit),
        certificateDueDays: due,
      });
      if (!result.ok) return setFailure(result.message);
      toast.success(`${line.name} saved.`);
      startTransition(onDone);
    });
  }

  return (
    <form onSubmit={save} className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-2">
          <Field
            label={`Authorized limit, ${line.currency}`}
            hint="Seasons differ every year; a step changes the limit from a month on, for an amendment."
          >
            <input
              value={limit.value}
              onChange={(e) => setLimit({ ...limit, value: e.target.value })}
              inputMode="decimal"
              className={`${box} w-40 text-right tabular-nums`}
            />
          </Field>
          <TermChanges
            draft={limit}
            name={`${line.name}, limit`}
            onChange={setLimit}
          />
        </div>
        <Field
          label="Certificate due, days after the month's end"
          hint="Blank for none. Months past their due date without a certificate are flagged as overdue."
        >
          <input
            value={due}
            onChange={(e) => setDue(e.target.value)}
            inputMode="numeric"
            placeholder="20"
            className={`${box} w-24 text-right tabular-nums`}
          />
        </Field>
        {failure && <p className="text-sm text-danger">{failure}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button type="button" className={button.ghost} onClick={onDone}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={button.primary}>
          {pending ? "Saving…" : "Save line"}
        </button>
      </div>
    </form>
  );
}

// The common amendment, saved on its own: a rate, a cap or a reserve's
// amount changing from a month on.
function TermChangeButton({
  lineId,
  definition,
  dirty,
  onWarnings,
}: {
  lineId: string;
  definition: BorrowingBaseDefinition;
  dirty: boolean;
  onWarnings: (issues: Issue[]) => void;
}) {
  const [changing, setChanging] = useState(false);
  return (
    <>
      <button
        type="button"
        className={button.secondary}
        onClick={() => setChanging(true)}
        disabled={dirty}
        title={
          dirty
            ? "Save or discard your changes first."
            : "An amendment: a rate, a cap or a reserve changing from a month on."
        }
      >
        <CalendarClock />
        Change a term from a month
      </button>
      <Modal
        open={changing}
        onClose={() => setChanging(false)}
        title="Change a term from a month"
      >
        {changing && (
          <TermChangeForm
            lineId={lineId}
            definition={definition}
            onDone={(issues) => {
              onWarnings(issues);
              setChanging(false);
            }}
            onClose={() => setChanging(false)}
          />
        )}
      </Modal>
    </>
  );
}

interface TermOption {
  code: string;
  term: "rate" | "cap" | "amount";
  label: string;
  current: Term | undefined;
  format: "amount" | "percent";
}

// The common amendment: an advance rate, a cap or a reserve's amount
// changing from a month on. From the start corrects it for every month.
function TermChangeForm({
  lineId,
  definition,
  onDone,
  onClose,
}: {
  lineId: string;
  definition: BorrowingBaseDefinition;
  onDone: (warnings: Issue[]) => void;
  onClose: () => void;
}) {
  const options = definition.lines.flatMap((l): TermOption[] =>
    l.kind === "collateral"
      ? [
          {
            code: l.code,
            term: "rate",
            label: `${l.label}: advance rate`,
            current: l.rate,
            format: "percent",
          },
          {
            code: l.code,
            term: "cap",
            label: `${l.label}: cap`,
            current: l.cap,
            format: "amount",
          },
        ]
      : l.kind === "group"
        ? [
            {
              code: l.code,
              term: "cap",
              label: `${l.label}: cap`,
              current: l.cap,
              format: "amount",
            },
          ]
        : l.kind === "reserve"
          ? [
              {
                code: l.code,
                term: "amount",
                label: `${l.label}: amount`,
                current: l.amount,
                format: "amount",
              },
            ]
          : [],
  );
  const [chosen, setChosen] = useState(0);
  const [from, setFrom] = useState<"month" | "start">("month");
  const [month, setMonth] = useState(() =>
    addMonths(new Date().toISOString().slice(0, 7), 1),
  );
  const [value, setValue] = useState("");
  const [pending, startSave] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const option = options[chosen];

  function save(event: FormEvent) {
    event.preventDefault();
    if (!option) return;
    setFailure(null);
    startSave(async () => {
      const result = await setBorrowingBaseTermAction(lineId, {
        code: option.code,
        term: option.term,
        value,
        from: from === "month" ? month : null,
      });
      if (!result.ok) return setFailure(result.message);
      toast.success("Term changed.");
      startTransition(() => onDone(result.value));
    });
  }

  if (!option)
    return (
      <p className="px-5 py-4 text-sm text-muted">
        This borrowing base has no rates, caps or set reserves to change.
      </p>
    );

  return (
    <form onSubmit={save} className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
        <Field label="Term">
          <select
            value={chosen}
            onChange={(e) => setChosen(Number(e.target.value))}
            className={input}
          >
            {options.map((o, i) => (
              <option key={`${o.code}.${o.term}`} value={i}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-sm">
          <span className="text-muted">Now: </span>
          <span className="tabular-nums">
            {option.current
              ? describeTerm(option.current, option.format)
              : "none"}
          </span>
        </p>
        <div className="grid gap-3 sm:grid-cols-[auto_auto_1fr]">
          <Field label="Applies" group>
            <Segmented
              name="from"
              options={{ month: "From a month", start: "From the start" }}
              value={from}
              onChange={setFrom}
            />
          </Field>
          {from === "month" && (
            <Field label="From">
              <input
                type="month"
                required
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className={`${box} w-44`}
              />
            </Field>
          )}
          <Field label="New value">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={option.format === "percent" ? "70%" : "1,000,000"}
              required={option.term === "rate"}
              autoFocus
              className={`${box} w-36 text-right tabular-nums`}
            />
          </Field>
        </div>
        <p className="text-xs text-muted">
          {from === "month"
            ? "Adds a step: months before keep the terms that applied to them, so past results don't change."
            : option.term === "rate"
              ? "Corrects the term for every month, past ones included."
              : "Corrects the term for every month, past ones included. Blank removes it."}
        </p>
        {failure && <p className="text-sm text-danger">{failure}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button type="button" className={button.ghost} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={button.primary}>
          {pending ? "Saving…" : "Change the term"}
        </button>
      </div>
    </form>
  );
}
