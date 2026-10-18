"use client";

import { Check, ChevronDown } from "lucide-react";
import { formatDate } from "@/lib/format";
import { Menu, MenuLabel, MenuLink } from "./menu";
import { VersionBadge } from "./page";
import { button } from "./styles";

interface Version {
  number: number;
  status: "draft" | "published" | "retired";
  // ISO date.
  publishedAt: string | null;
}

// The version shown, and a menu of the others, newest first. Each opens with
// ?v=, which drops the page's other parameters.
export function VersionPicker({
  versions,
  current,
}: {
  versions: Version[];
  current: number;
}) {
  const shown = versions.find((v) => v.number === current);
  return (
    <Menu
      label="Versions"
      align="start"
      trigger={
        <button type="button" className={`${button.secondary} gap-2 pr-2`}>
          <span>Version {current}</span>
          {shown && <VersionBadge status={shown.status} />}
          <ChevronDown className="text-muted" />
        </button>
      }
    >
      <MenuLabel>Versions</MenuLabel>
      {versions.toReversed().map((v) => (
        <MenuLink
          key={v.number}
          href={`?v=${v.number}`}
          current={v.number === current}
        >
          <span className="w-6 font-medium">v{v.number}</span>
          <VersionBadge status={v.status} />
          <span className="ml-auto pl-4 text-xs text-muted">
            {v.publishedAt ? formatDate(v.publishedAt) : ""}
          </span>
          {v.number === current ? (
            <Check className="text-accent" />
          ) : (
            <span className="size-4" />
          )}
        </MenuLink>
      ))}
    </Menu>
  );
}
