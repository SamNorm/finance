"use client";

import type { Issue, ModelLine } from "@finance/domain";
import { useMemo, useState, useTransition } from "react";
import { button, card, table } from "@/components/styles";
import { Icon } from "@/components/ui";
import { formatFigure } from "@/lib/format";
import { moveLineAction } from "../actions";
import { LineDrawer, type LineEditing } from "./line-drawer";
import { FORMATS, LINE_KINDS, type InputItem } from "./line-labels";

// A section of the model: a header line and the lines up to the next one,
// by position in the model.
interface Section {
  code: string;
  label: string;
  start: number;
  end: number;
  count: number;
}

// A model version's lines in order: section headers, assumptions with their
// base-case values, calculations with their formulas, and inputs entered per
// borrower. Chips narrow the table to one section, so a long model doesn't
// scroll on and on; positions stay the model's own.
export function LinesWorkspace({
  version,
  editable,
  lines,
  issues,
  inputs,
}: {
  version: { id: string; number: number };
  editable: boolean;
  lines: ModelLine[];
  issues: Issue[];
  inputs: InputItem[];
}) {
  const [editing, setEditing] = useState<LineEditing | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moving, startMove] = useTransition();
  const [chosen, setChosen] = useState<string | null>(null);
  const issuesByCode = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of issues) {
      if (issue.itemCode)
        map.set(issue.itemCode, [...(map.get(issue.itemCode) ?? []), issue]);
    }
    return map;
  }, [issues]);
  const sections = useMemo(() => sectionsOf(lines), [lines]);
  // A section renamed or removed since it was chosen shows everything.
  const section = sections.find((s) => s.code === chosen) ?? null;
  const rows = lines
    .map((line, index) => ({ line, index }))
    .filter(
      ({ index }) =>
        !section || (index >= section.start && index < section.end),
    );

  function move(code: string, position: number) {
    setMoveError(null);
    startMove(async () => {
      const result = await moveLineAction(version.id, code, position);
      if (!result.ok) setMoveError(result.message);
    });
  }

  // Within a section, lines move inside it; the header stays put.
  const canMove = (index: number, by: -1 | 1) => {
    const to = index + by;
    if (!section) return to >= 0 && to < lines.length;
    return index !== section.start && to > section.start && to < section.end;
  };

  return (
    <section className={`${card} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">Lines</h2>
        <span className="text-xs text-muted">
          Formulas read item codes from the scoring model and the codes of other
          lines. Select a line to {editable ? "edit" : "see"} it.
        </span>
        {editable && (
          <button
            type="button"
            className={`${button.primary} ml-auto`}
            onClick={() =>
              setEditing({
                mode: "new",
                position: section ? section.end : lines.length,
                defaults: {},
              })
            }
          >
            <Icon name="plus" />
            Add line
          </button>
        )}
      </div>
      {sections.length > 1 && (
        <div
          role="group"
          aria-label="Sections"
          className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5"
        >
          <Chip
            pressed={!section}
            onClick={() => setChosen(null)}
            count={lines.filter((l) => l.kind !== "header").length}
          >
            All
          </Chip>
          {sections.map((s) => (
            <Chip
              key={s.code}
              pressed={s.code === section?.code}
              onClick={() => setChosen(s.code)}
              count={s.count}
            >
              {s.label}
            </Chip>
          ))}
        </div>
      )}
      {moveError && (
        <p className="border-b border-line bg-danger-soft px-4 py-2 text-sm text-danger">
          {moveError}
        </p>
      )}

      {lines.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <p className="text-sm font-medium">No lines yet.</p>
          {editable && (
            <>
              <p className="max-w-md text-sm text-muted">
                Add assumptions (a growth rate, a covenant threshold) and
                calculations written as formulas, like{" "}
                <code className="font-mono">EBITDA / DEBT_SERVICE</code>.
              </p>
              <button
                type="button"
                className={button.primary}
                onClick={() =>
                  setEditing({ mode: "new", position: 0, defaults: {} })
                }
              >
                <Icon name="plus" />
                Add line
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className={`w-full text-sm ${moving ? "opacity-60" : ""}`}>
            <thead>
              <tr className={table.head}>
                <th className="w-7" />
                <th className="py-2.5 pr-2 pl-2 font-medium">Line</th>
                <th className="w-56 px-2 font-medium">Code</th>
                <th className="w-44 px-2 font-medium">Kind</th>
                <th className="px-2 font-medium">Formula or value</th>
                {editable && <th className="w-24" />}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ line, index }) => {
                const lineIssues = issuesByCode.get(line.code);
                const severity = lineIssues?.some((i) => i.severity === "error")
                  ? "error"
                  : lineIssues
                    ? "warning"
                    : null;
                const header = line.kind === "header";
                return (
                  <tr
                    key={line.code}
                    onClick={() =>
                      setEditing({ mode: "edit", code: line.code })
                    }
                    className={`group cursor-pointer border-b border-line/60 last:border-b-0 hover:bg-accent-soft/50 ${
                      header ? "bg-surface-2/60" : ""
                    }`}
                  >
                    <td className="pl-3">
                      {severity && (
                        <span
                          className={`block size-2 rounded-full ${severity === "error" ? "bg-danger" : "bg-warning"}`}
                          title={lineIssues!.map((i) => i.message).join("\n")}
                        />
                      )}
                    </td>
                    <td className={`py-2 pr-2 pl-2 ${header ? "pt-3" : ""}`}>
                      {header ? (
                        <span className="text-xs font-semibold tracking-wide text-muted uppercase">
                          {line.label}
                        </span>
                      ) : (
                        line.label
                      )}
                    </td>
                    <td className="px-2 font-mono text-xs text-muted">
                      {header ? "" : line.code}
                    </td>
                    <td className="px-2 text-xs whitespace-nowrap text-muted">
                      {header
                        ? ""
                        : `${LINE_KINDS[line.kind]} · ${FORMATS[line.format]}`}
                    </td>
                    <td className="max-w-0 px-2">
                      <span
                        className="block truncate font-mono text-xs"
                        title={line.formula ?? undefined}
                      >
                        {line.kind === "calculation"
                          ? line.formula
                          : line.kind === "input"
                            ? [
                                line.breaksDown && `Part of ${line.breaksDown}`,
                                line.projectionFormula &&
                                  `Projected: ${line.projectionFormula}`,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "Entered in analyses"
                            : line.kind === "assumption"
                              ? formatFigure(
                                  line.defaultValue === "TRUE"
                                    ? "true"
                                    : line.defaultValue === "FALSE"
                                      ? "false"
                                      : line.defaultValue,
                                  line.format,
                                )
                              : ""}
                      </span>
                    </td>
                    {editable && (
                      <td className="pr-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                          <button
                            type="button"
                            className={button.icon}
                            title="Move up"
                            disabled={!canMove(index, -1) || moving}
                            onClick={() => move(line.code, index - 1)}
                          >
                            <Icon name="up" />
                          </button>
                          <button
                            type="button"
                            className={button.icon}
                            title="Move down"
                            disabled={!canMove(index, 1) || moving}
                            onClick={() => move(line.code, index + 1)}
                          >
                            <Icon name="down" />
                          </button>
                          <button
                            type="button"
                            className={button.icon}
                            title="Add a line below"
                            onClick={() =>
                              setEditing({
                                mode: "new",
                                position: index + 1,
                                defaults: {},
                              })
                            }
                          >
                            <Icon name="plus" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <LineDrawer
        editing={editing}
        versionId={version.id}
        lines={lines}
        inputs={inputs}
        issues={issuesByCode}
        editable={editable}
        onChange={setEditing}
      />
    </section>
  );
}

function Chip({
  pressed,
  onClick,
  count,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  count: number;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-xs text-muted hover:text-foreground aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent"
    >
      {children}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function sectionsOf(lines: ModelLine[]): Section[] {
  const sections: Section[] = [];
  lines.forEach((line, index) => {
    const last = sections.at(-1);
    if (line.kind === "header") {
      if (last) last.end = index;
      sections.push({
        code: line.code,
        label: line.label,
        start: index,
        end: lines.length,
        count: 0,
      });
    } else if (last) {
      last.count++;
    }
  });
  return sections;
}
