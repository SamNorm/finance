"use client";

import { Tabs as Primitive } from "radix-ui";
import { useState, type ReactNode } from "react";

export interface Tab {
  value: string;
  label: ReactNode;
  count?: number | string;
  // A dot on the tab, for errors or warnings inside it.
  alert?: "error" | "warning";
  content: ReactNode;
}

// A page's sections as tabs, rendered by the server and switched in the
// browser with no round trip. The open tab is kept in the URL (`param`,
// left out for the first tab) so a link or a refresh lands on it. A panel
// mounts the first time it's opened and then stays mounted, hidden, so what
// was typed in it survives switching tabs.
export function Tabs({
  tabs,
  initial,
  param = "tab",
  toolbar,
}: {
  tabs: Tab[];
  initial?: string;
  param?: string;
  // Controls at the end of the tab bar.
  toolbar?: ReactNode;
}) {
  const valid = (value: string | undefined) =>
    tabs.some((t) => t.value === value) ? value! : tabs[0]!.value;
  const [value, setValue] = useState(() => valid(initial));
  const [visited, setVisited] = useState(() => new Set([value]));
  // A navigation that names another tab, such as a link, moves to it.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    const next = valid(initial);
    setValue(next);
    if (!visited.has(next)) setVisited(new Set(visited).add(next));
  }

  function change(next: string) {
    setValue(next);
    if (!visited.has(next)) setVisited(new Set(visited).add(next));
    const url = new URL(window.location.href);
    if (next === tabs[0]!.value) url.searchParams.delete(param);
    else url.searchParams.set(param, next);
    window.history.replaceState(null, "", url);
  }

  return (
    <Primitive.Root
      value={value}
      onValueChange={change}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line">
        <Primitive.List className="-mb-px flex max-w-full gap-1 overflow-x-auto [scrollbar-width:none]">
          {tabs.map((tab) => (
            <Primitive.Trigger
              key={tab.value}
              value={tab.value}
              className="flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm whitespace-nowrap text-muted hover:text-foreground focus-visible:rounded-t focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-foreground"
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-medium text-muted tabular-nums">
                  {tab.count}
                </span>
              )}
              {tab.alert && (
                <span
                  className={`size-1.5 rounded-full ${tab.alert === "error" ? "bg-danger" : "bg-warning"}`}
                  aria-label={
                    tab.alert === "error" ? "Has errors" : "Has warnings"
                  }
                />
              )}
            </Primitive.Trigger>
          ))}
        </Primitive.List>
        {toolbar && (
          <div className="flex flex-wrap items-center gap-2 pb-2">
            {toolbar}
          </div>
        )}
      </div>
      {tabs.map((tab) => (
        <Primitive.Content
          key={tab.value}
          value={tab.value}
          forceMount
          className="outline-none data-[state=inactive]:hidden"
        >
          {visited.has(tab.value) && tab.content}
        </Primitive.Content>
      ))}
    </Primitive.Root>
  );
}
