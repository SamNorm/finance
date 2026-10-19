"use client";

import { CircleOff, RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";
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
  const [failure, setFailure] = useState<string | null>(null);

  function stop() {
    if (
      !confirm(
        `Stop margining ${lineName}? Its borrowing base's lines and terms are removed. Its months of certificates are kept, in case it's margined again.`,
      )
    )
      return;
    setFailure(null);
    startStop(async () => {
      const result = await setBorrowingBaseDefinitionAction(lineId, null);
      if (!result.ok) setFailure(result.message);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
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
      {failure && <p className="text-xs text-danger">{failure}</p>}
      <MarginDialog
        open={restarting}
        onClose={() => setRestarting(false)}
        lineId={lineId}
        lineName={lineName}
        sources={sources}
        replacing
      />
    </div>
  );
}
