"use client";

import type { Term } from "@finance/domain";
import { Gauge, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { Menu, MenuItem, MenuSeparator } from "@/components/menu";
import { Badge, Card } from "@/components/page";
import { button, input, table } from "@/components/styles";
import { TermChanges } from "@/components/term-editor";
import { Field, Icon, Modal } from "@/components/ui";
import {
  BLANK_TERM,
  describeTerm,
  termDraft,
  termInput,
  typedRate,
  type TermDraft,
} from "@/lib/credit-lines";
import { describeMonth } from "@/lib/borrowing-bases";
import { formatDate, formatFigure } from "@/lib/format";
import {
  MarginDialog,
  type MarginSources,
} from "../../borrowing-bases/_components/margin-line";
import {
  addCreditLineAction,
  removeCreditLineAction,
  updateCreditLineAction,
} from "../actions";

// A borrower's lines of credit in force, entered a line at a time: each
// with an authorized limit that can differ by season and step from a month,
// and one rate. Analyses count their interest on the usage they assume. A
// consolidated client's are its members', shown here as they are there.

export interface LineRow {
  id: string;
  name: string;
  currency: string;
  limit: Term;
  rate: string;
  closedOn: string | null;
  // A consolidated client's member, which borrows it.
  member?: { id: string; name: string } | null;
  // When it's margined: its latest month with a certificate and the
  // surplus then, or none yet.
  borrowingBase?: { month: string; surplus: string | null } | "none" | null;
}

export function CreditLines({
  entityId,
  lines,
  consolidated = false,
  sources,
}: {
  entityId: string;
  lines: LineRow[];
  consolidated?: boolean;
  // What a line's borrowing base can start from, to margin it.
  sources?: MarginSources;
}) {
  // The line being edited, or "new" for one being added.
  const [editing, setEditing] = useState<LineRow | "new" | null>(null);
  const [margining, setMargining] = useState<LineRow | null>(null);
  const [removing, startRemove] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  function remove(line: LineRow) {
    if (
      !confirm(
        `Delete ${line.name}? Analyses stop counting it, in past years too. A line repaid and cancelled is better closed.`,
      )
    )
      return;
    setFailure(null);
    startRemove(async () => {
      const result = await removeCreditLineAction(line.id);
      if (!result.ok) setFailure(result.message);
    });
  }

  return (
    <Card
      flush
      title="Lines of credit"
      description={
        consolidated ? (
          "The members' lines, as entered on each member: a line is entered on the member that borrows it."
        ) : (
          <>
            Authorized limits and rates in force. Analyses count each
            line&apos;s interest on the usage they assume, as{" "}
            <span className="font-mono">LINE_</span> inputs.
          </>
        )
      }
      actions={
        !consolidated && (
          <button
            type="button"
            className={button.secondary}
            onClick={() => setEditing("new")}
          >
            <Icon name="plus" />
            Add line
          </button>
        )
      }
    >
      {lines.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">
          {consolidated
            ? "None of the members has a line of credit. Add one on the member that borrows it."
            : "No lines of credit. Add the borrower's operating lines, with their limits and rates."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className={table.table}>
            <thead>
              <tr className={table.head}>
                <th className={table.th}>Line</th>
                {consolidated && <th className={table.th}>Member</th>}
                <th className={table.th}>Currency</th>
                <th className={`${table.th} w-full`}>Authorized limit</th>
                <th className={`${table.th} text-right`}>Rate</th>
                <th className={table.th}>Borrowing base</th>
                {!consolidated && (
                  <th className={table.th}>
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.id}
                  className="border-b border-line/70 last:border-b-0"
                >
                  <td className={`${table.td} font-medium whitespace-nowrap`}>
                    <span className="flex items-center gap-2">
                      {line.name}
                      {line.closedOn && (
                        <Badge>Closed on {formatDate(line.closedOn)}</Badge>
                      )}
                    </span>
                  </td>
                  {consolidated && (
                    <td className={`${table.td} whitespace-nowrap`}>
                      {line.member && (
                        <Link
                          href={`/borrowers/${line.member.id}?tab=existing-debt`}
                          className="text-accent hover:underline"
                        >
                          {line.member.name}
                        </Link>
                      )}
                    </td>
                  )}
                  <td className={`${table.td} text-muted`}>{line.currency}</td>
                  <td className={`${table.td} tabular-nums`}>
                    {describeTerm(line.limit)}
                  </td>
                  <td className={`${table.td} text-right tabular-nums`}>
                    {formatFigure(line.rate, "percent")}
                  </td>
                  <td className={`${table.td} py-1.5 whitespace-nowrap`}>
                    <Margin
                      line={line}
                      onMargin={
                        !consolidated && sources && !line.closedOn
                          ? () => setMargining(line)
                          : undefined
                      }
                    />
                  </td>
                  {!consolidated && (
                    <td className="px-2 py-1.5 text-right">
                      <Menu label={`${line.name} actions`}>
                        <MenuItem
                          icon={<Pencil />}
                          onSelect={() => setEditing(line)}
                        >
                          Edit line
                        </MenuItem>
                        {!line.borrowingBase && sources && (
                          <MenuItem
                            icon={<Gauge />}
                            onSelect={() => setMargining(line)}
                          >
                            Margin this line
                          </MenuItem>
                        )}
                        <MenuSeparator />
                        <MenuItem
                          icon={<Trash2 />}
                          danger
                          disabled={removing}
                          onSelect={() => remove(line)}
                        >
                          Delete line
                        </MenuItem>
                      </Menu>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {failure && (
        <p className="border-t border-line px-4 py-2 text-sm text-danger">
          {failure}
        </p>
      )}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing === "new" || !editing
            ? "Add a line of credit"
            : `Edit ${editing.name}`
        }
      >
        <LineForm
          entityId={entityId}
          line={editing === "new" ? null : editing}
          onDone={() => setEditing(null)}
        />
      </Modal>
      {sources && (
        <MarginDialog
          open={margining !== null}
          onClose={() => setMargining(null)}
          lineId={margining?.id ?? ""}
          lineName={margining?.name ?? ""}
          sources={sources}
        />
      )}
    </Card>
  );
}

// A margined line's latest surplus, linking to its borrowing base; or the
// way to margin one that isn't.
function Margin({ line, onMargin }: { line: LineRow; onMargin?: () => void }) {
  const margin = line.borrowingBase;
  if (!margin)
    return onMargin ? (
      <button
        type="button"
        className={`${button.ghost} -ml-2 px-2 py-1 text-xs text-accent`}
        onClick={onMargin}
      >
        <Gauge />
        Margin this line
      </button>
    ) : (
      <span className="text-muted">Not margined</span>
    );
  const short = margin !== "none" && Number(margin.surplus) < 0;
  return (
    <Link
      href={`/borrowing-bases/${line.id}`}
      className="group/margin flex flex-col items-start"
      title="Open its borrowing base"
    >
      {margin === "none" ? (
        <span className="text-accent group-hover/margin:underline">
          No certificate yet
        </span>
      ) : (
        <>
          <span
            className={`font-medium tabular-nums group-hover/margin:underline ${short ? "text-danger" : "text-accent"}`}
          >
            {short ? "Deficit" : "Surplus"}{" "}
            {margin.surplus === null
              ? "–"
              : formatFigure(
                  String(Math.abs(Number(margin.surplus))),
                  "amount",
                )}
          </span>
          <span className="text-xs text-muted">
            {describeMonth(margin.month)}
          </span>
        </>
      )}
    </Link>
  );
}

// The input style without its full width, so fields keep their own.
const box = input.replace("w-full ", "");

// A line's fields as typed. The modal renders it while open, so each
// opening starts from the line as saved.
function LineForm({
  entityId,
  line,
  onDone,
}: {
  entityId: string;
  line: LineRow | null;
  onDone: () => void;
}) {
  const [name, setName] = useState(line?.name ?? "");
  const [currency, setCurrency] = useState(line?.currency ?? "CAD");
  const [rate, setRate] = useState(line ? typedRate(line.rate) : "");
  const [limit, setLimit] = useState<TermDraft>(() =>
    line ? termDraft(line.limit) : BLANK_TERM,
  );
  const [closedOn, setClosedOn] = useState(line?.closedOn ?? "");
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  function save(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const fields = {
      name,
      currency,
      limit: termInput(limit),
      rate,
      ...(line ? { closedOn } : {}),
    };
    startTransition(async () => {
      const result = line
        ? await updateCreditLineAction(line.id, fields)
        : await addCreditLineAction(entityId, fields);
      if (result.ok) onDone();
      else setFailure(result.message);
    });
  }

  return (
    <form onSubmit={save} className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_6rem_7rem]">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Operating line"
              required
              autoFocus
              className={input}
            />
          </Field>
          <Field label="Currency">
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              placeholder="CAD"
              maxLength={3}
              className={input}
            />
          </Field>
          <Field label="Rate">
            <input
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="7.2%"
              className={`${input} text-right tabular-nums`}
            />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <Field
            label="Authorized limit"
            hint="Seasons differ every year, such as a higher limit from October to March. A step changes the limit from a month on, for an amendment, and replaces the seasons above it."
          >
            <input
              value={limit.value}
              onChange={(e) => setLimit({ ...limit, value: e.target.value })}
              placeholder="2,000,000"
              inputMode="decimal"
              className={`${box} w-40 text-right tabular-nums`}
            />
          </Field>
          <TermChanges
            draft={limit}
            name={`${name || "The line"}, limit`}
            onChange={setLimit}
          />
        </div>
        {line && (
          <Field
            label="Closed on"
            hint="Blank while it's open. Analyses count a closed line up to its month."
          >
            <input
              type="date"
              value={closedOn}
              onChange={(e) => setClosedOn(e.target.value)}
              className={`${box} w-48`}
            />
          </Field>
        )}
        {failure && <p className="text-sm text-danger">{failure}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button type="button" className={button.ghost} onClick={onDone}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={button.primary}>
          {pending ? "Saving…" : line ? "Save line" : "Add line"}
        </button>
      </div>
    </form>
  );
}
