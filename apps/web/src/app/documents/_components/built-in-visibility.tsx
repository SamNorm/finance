"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, useTransition } from "react";
import { button } from "@/components/styles";
import { setBuiltInHiddenAction } from "../actions";

// Stops offering a built-in document to analysts, once the organization
// has its own instead, or offers it again.
export function BuiltInVisibility({
  template,
  hidden,
}: {
  template: { key: string; name: string };
  hidden: boolean;
}) {
  const [pending, start] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className={button.ghost}
        disabled={pending}
        title={
          hidden
            ? `Offer the ${template.name.toLowerCase()} to print again`
            : `Stop offering the ${template.name.toLowerCase()} to print, for one of your own`
        }
        onClick={() =>
          start(async () => {
            setFailure(null);
            const result = await setBuiltInHiddenAction(template.key, !hidden);
            if (!result.ok) setFailure(result.message);
          })
        }
      >
        {hidden ? <Eye /> : <EyeOff />}
        {hidden ? "Offer again" : "Hide"}
      </button>
      {failure && <p className="text-xs text-danger">{failure}</p>}
    </div>
  );
}
