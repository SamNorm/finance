"use client";

import type { LinesToMargin } from "@finance/domain";
import { ChevronRight, Gauge, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { button, input } from "@/components/styles";
import { Modal } from "@/components/ui";
import { describeTerm } from "@/lib/credit-lines";
import { MarginDialog, type MarginSources } from "./margin-line";

// Margins a line from the borrowing bases: a borrower's open line of credit
// not margined yet, then what its borrowing base starts from. A borrower
// with no open line links to its Existing debt tab, to add one first.
export function MarginALine({
  borrowers,
  sources,
  variant = "secondary",
}: {
  borrowers: LinesToMargin[];
  sources: MarginSources;
  variant?: "primary" | "secondary";
}) {
  const [picking, setPicking] = useState(false);
  const [margining, setMargining] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [query, setQuery] = useState("");

  const typed = query.trim().toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(typed);
  // A borrower found by its name keeps all its lines; otherwise only the
  // lines found by theirs.
  const found = borrowers.flatMap((b) => {
    if (!typed || matches(b.entity.name)) return [b];
    const lines = b.lines.filter((l) => matches(l.name));
    return lines.length ? [{ ...b, lines }] : [];
  });
  const withLines = found.filter((b) => b.lines.length);
  const without = found.filter((b) => !b.lines.length);

  function close() {
    setPicking(false);
    setQuery("");
  }

  return (
    <>
      <button
        type="button"
        className={variant === "primary" ? button.primary : button.secondary}
        onClick={() => setPicking(true)}
      >
        <Gauge />
        Margin a line
      </button>
      <Modal open={picking} onClose={close} title="Margin a line">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <p className="text-sm text-muted">
            Choose a borrower&apos;s line of credit, then what its borrowing
            base starts from.
          </p>
          {borrowers.length > 5 && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a borrower or line"
              aria-label="Find a borrower or line"
              autoFocus
              className={input}
            />
          )}
          {withLines.length > 0 && (
            <section className="flex flex-col gap-3">
              <h3 className="text-xs font-medium text-muted">
                Lines of credit not margined
              </h3>
              {withLines.map(({ entity, lines }) => (
                <div key={entity.id} className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">{entity.name}</span>
                  {lines.map((line) => (
                    <button
                      key={line.id}
                      type="button"
                      onClick={() => {
                        close();
                        setMargining({
                          id: line.id,
                          name: `${line.name} (${entity.name})`,
                        });
                      }}
                      className="group flex items-center gap-3 rounded-md border border-line px-3 py-2 text-left hover:border-accent hover:bg-accent-soft/40"
                    >
                      <span className="min-w-0 flex-1 text-sm">
                        {line.name}
                        <span className="ml-2 text-xs text-muted">
                          {line.currency}
                        </span>
                      </span>
                      <span className="text-sm text-muted tabular-nums">
                        {describeTerm(line.limit)}
                      </span>
                      <ChevronRight className="size-4 text-muted group-hover:text-accent" />
                    </button>
                  ))}
                </div>
              ))}
            </section>
          )}
          {without.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted">
                No open line of credit yet
              </h3>
              <ul className="divide-y divide-line rounded-md border border-line">
                {without.map(({ entity }) => (
                  <li
                    key={entity.id}
                    className="flex items-center gap-3 px-3 py-1.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {entity.name}
                    </span>
                    <Link
                      href={`/borrowers/${entity.id}?tab=existing-debt`}
                      onClick={close}
                      className={`${button.ghost} px-2 py-1 text-xs text-accent`}
                    >
                      <Plus />
                      Add a line
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!found.length && (
            <p className="py-6 text-center text-sm text-muted">
              {typed
                ? `No borrower or line matches “${query.trim()}”.`
                : "Every borrower's open lines of credit are margined."}
            </p>
          )}
        </div>
        <div className="flex justify-end border-t border-line px-5 py-3">
          <button type="button" className={button.ghost} onClick={close}>
            Cancel
          </button>
        </div>
      </Modal>
      <MarginDialog
        open={margining !== null}
        onClose={() => setMargining(null)}
        lineId={margining?.id ?? ""}
        lineName={margining?.name ?? ""}
        sources={sources}
      />
    </>
  );
}
