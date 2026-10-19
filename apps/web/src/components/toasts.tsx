"use client";

import {
  CircleAlert,
  CircleCheck,
  Info,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import { Toaster, useSonner } from "sonner";

// Short notes on what just happened, such as "Saved.", in the bottom right
// corner for a few seconds. Raise one with sonner's toast.success(…) or
// toast.error(…). Mounted once by the root layout.
export function Toasts() {
  const layer = useRef<HTMLDivElement>(null);
  const { toasts } = useSonner();

  // A Modal is a <dialog> in the browser's top layer, over the rest of the
  // page. The toasts sit in the top layer too, in a popover raised over any
  // open dialog as one comes in. Over a dialog they can be read, not
  // clicked: everything outside it is inert.
  useEffect(() => {
    const popover = layer.current;
    if (!popover) return;
    if (popover.matches(":popover-open")) {
      if (toasts.length === 0 || !document.querySelector("dialog:modal"))
        return;
      popover.hidePopover();
    }
    popover.showPopover();
  }, [toasts.length]);

  return (
    <div
      ref={layer}
      popover="manual"
      className="inset-auto top-0 left-0 m-0 size-0 overflow-visible border-0 bg-transparent p-0"
    >
      <Toaster
        position="bottom-right"
        duration={5000}
        icons={{
          success: <CircleCheck className="size-4 text-success" />,
          error: <CircleAlert className="size-4 text-danger" />,
          warning: <TriangleAlert className="size-4 text-warning" />,
          info: <Info className="size-4 text-accent" />,
          loading: <LoaderCircle className="size-4 animate-spin text-muted" />,
        }}
        style={
          {
            "--normal-bg": "var(--surface)",
            "--normal-text": "var(--foreground)",
            "--normal-border": "var(--line-strong)",
            "--border-radius": "var(--radius-lg)",
          } as CSSProperties
        }
        toastOptions={{
          classNames: {
            toast: "font-sans! text-sm!",
            title: "font-medium",
            description: "text-muted!",
          },
        }}
      />
    </div>
  );
}
