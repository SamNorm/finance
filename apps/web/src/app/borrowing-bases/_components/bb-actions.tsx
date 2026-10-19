"use client";

import { CircleOff, RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ask } from "@/components/confirm";
import { Menu, MenuItem, MenuSeparator } from "@/components/menu";
import { setBorrowingBaseDefinitionAction } from "../actions";
import { MarginDialog, type MarginSources } from "./margin-line";

// A margined line's rarer actions: start its borrowing base over, or stop
// margining it.
export function BorrowingBaseActions({
  lineId,
  lineName,
  sources,
}: {
  lineId: string;
  lineName: string;
  sources: MarginSources;
}) {
  const [restarting, setRestarting] = useState(false);
  const [stopping, startStop] = useTransition();

  async function stop() {
    if (
      !(await ask({
        title: `Stop margining ${lineName}?`,
        body: "Its borrowing base's lines and terms are removed. Its months of certificates are kept, in case it's margined again.",
        action: "Stop margining",
        danger: true,
      }))
    )
      return;
    startStop(async () => {
      const result = await setBorrowingBaseDefinitionAction(lineId, null);
      if (result.ok) toast.success(`Stopped margining ${lineName}.`);
      else toast.error(result.message);
    });
  }

  return (
    <>
      <Menu label={`${lineName} actions`}>
        <MenuItem icon={<RotateCcw />} onSelect={() => setRestarting(true)}>
          Start over from…
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<CircleOff />}
          danger
          disabled={stopping}
          onSelect={stop}
        >
          {stopping ? "Stopping…" : "Stop margining"}
        </MenuItem>
      </Menu>
      <MarginDialog
        open={restarting}
        onClose={() => setRestarting(false)}
        lineId={lineId}
        lineName={lineName}
        sources={sources}
        replacing
      />
    </>
  );
}
