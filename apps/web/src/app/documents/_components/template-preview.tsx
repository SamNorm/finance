"use client";

import { ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Card } from "@/components/page";
import { button, input } from "@/components/styles";

// The draft as it prints, for an analysis and scenario picked here, or for
// a margined line and month when it prints from a line. The page renders at
// its printed width, scaled to fit, and reloads whenever the draft is
// saved.

// The preview page's width on screen: the printed page plus its margins.
const WIDTHS = { portrait: 816 + 48, landscape: 1056 + 48 };
const HEIGHT = 1300;

// What the preview prints from, and the choices to print it from.
export type PreviewFrom =
  | {
      source: "analysis";
      analyses: { id: string; name: string; borrower: string }[];
      analysisId: string | null;
      scenarios: { id: string; name: string }[];
      scenarioId: string | null;
      // The model it reads, when one.
      modelName: string | null;
    }
  | {
      source: "line";
      lines: { id: string; name: string; borrower: string }[];
      lineId: string | null;
      // The line's months with a certificate, oldest first.
      months: string[];
      month: string | null;
    };

// "2024-12" → "Dec 2024".
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-CA", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export function TemplatePreview({
  templateId,
  // Changes whenever the draft is saved.
  version,
  orientation,
  from,
}: {
  templateId: string;
  version: string;
  orientation: "portrait" | "landscape";
  from: PreviewFrom;
}) {
  const router = useRouter();
  const choose = (params: Record<string, string>) =>
    router.replace(`?${new URLSearchParams(params)}`, { scroll: false });

  const picked =
    from.source === "line"
      ? from.lineId && {
          line: from.lineId,
          ...(from.month ? { month: from.month } : {}),
        }
      : from.analysisId && {
          analysis: from.analysisId,
          ...(from.scenarioId ? { scenario: from.scenarioId } : {}),
        };
  if (!picked)
    return (
      <Card title="Preview">
        <p className="py-8 text-center text-sm text-muted">
          {from.source === "line"
            ? "No margined lines to preview it with yet."
            : from.modelName
              ? `No analyses on ${from.modelName} to preview it with yet.`
              : "No analyses to preview it with yet."}
        </p>
      </Card>
    );
  const src = `/documents/preview?${new URLSearchParams({
    ...picked,
    template: templateId,
    draft: "1",
    v: version,
  })}`;
  return (
    <Card
      title="Preview"
      description={
        from.source === "line"
          ? "The draft as it prints, with the figures of the line and month picked."
          : "The draft as it prints, with the figures of the analysis picked."
      }
      className="xl:sticky xl:top-6"
      actions={
        <a
          href={src}
          target="_blank"
          rel="noopener"
          className={button.ghost}
          title="Open the preview in a new tab"
        >
          <ExternalLink />
          Open
        </a>
      }
    >
      <div className="flex flex-col gap-3">
        {from.source === "line" ? (
          <div className="flex flex-wrap gap-2">
            <select
              value={from.lineId ?? ""}
              onChange={(e) => choose({ line: e.target.value })}
              className={`${input} min-w-0 flex-1`}
              aria-label="Line of credit"
            >
              {from.lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.borrower}: {l.name}
                </option>
              ))}
            </select>
            <select
              value={from.month ?? ""}
              onChange={(e) =>
                choose({ line: from.lineId!, month: e.target.value })
              }
              className={`${input.replace("w-full ", "")} w-40`}
              aria-label="Month"
            >
              {[...from.months].reverse().map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <select
              value={from.analysisId ?? ""}
              onChange={(e) => choose({ analysis: e.target.value })}
              className={`${input} min-w-0 flex-1`}
              aria-label="Analysis"
            >
              {from.analyses.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.borrower}: {a.name}
                </option>
              ))}
            </select>
            <select
              value={from.scenarioId ?? ""}
              onChange={(e) =>
                choose({
                  analysis: from.analysisId!,
                  ...(e.target.value ? { scenario: e.target.value } : {}),
                })
              }
              className={`${input} min-w-0 flex-1`}
              aria-label="Scenario"
            >
              <option value="">Base case</option>
              {from.scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <ScaledFrame src={src} width={WIDTHS[orientation]} />
      </div>
    </Card>
  );
}

const subscribe = () => () => {};

// The frame mounts in the browser only, once its box can be measured, so
// its load event is never missed before hydration.
function ScaledFrame({ src, width }: { src: string; width: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  const [loaded, setLoaded] = useState<string | null>(null);
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setScale(Math.min(1, entry!.contentRect.width / width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);
  return (
    <div
      ref={box}
      className="relative overflow-hidden rounded-lg border border-line bg-white"
      style={{ height: HEIGHT * scale }}
    >
      {hydrated && (
        <iframe
          src={src}
          title="Preview of the draft"
          sandbox=""
          onLoad={() => setLoaded(src)}
          className="origin-top-left border-0"
          style={{ width, height: HEIGHT, transform: `scale(${scale})` }}
        />
      )}
      {loaded !== src && (
        <span className="absolute top-2 right-2 rounded-md bg-surface px-2 py-1 text-xs text-muted shadow-xs">
          Updating…
        </span>
      )}
    </div>
  );
}
