"use client";

import { ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Card } from "@/components/page";
import { button, input } from "@/components/styles";

// The draft as it prints, for an analysis and scenario picked here. The
// page renders at its printed width, scaled to fit, and reloads whenever the
// draft is saved.

// The preview page's width on screen: the printed page plus its margins.
const WIDTHS = { portrait: 816 + 48, landscape: 1056 + 48 };
const HEIGHT = 1300;

export function TemplatePreview({
  templateId,
  // Changes whenever the draft is saved.
  version,
  orientation,
  analyses,
  analysisId,
  scenarios,
  scenarioId,
  modelName,
}: {
  templateId: string;
  version: string;
  orientation: "portrait" | "landscape";
  analyses: { id: string; name: string; borrower: string }[];
  analysisId: string | null;
  scenarios: { id: string; name: string }[];
  scenarioId: string | null;
  // The model it reads, when one.
  modelName: string | null;
}) {
  const router = useRouter();
  const choose = (analysis: string, scenario: string | null) =>
    router.replace(
      `?${new URLSearchParams({ analysis, ...(scenario ? { scenario } : {}) })}`,
      { scroll: false },
    );

  if (!analysisId)
    return (
      <Card title="Preview">
        <p className="py-8 text-center text-sm text-muted">
          {modelName
            ? `No analyses on ${modelName} to preview it with yet.`
            : "No analyses to preview it with yet."}
        </p>
      </Card>
    );
  const src = `/documents/preview?${new URLSearchParams({
    analysis: analysisId,
    template: templateId,
    draft: "1",
    v: version,
    ...(scenarioId ? { scenario: scenarioId } : {}),
  })}`;
  return (
    <Card
      title="Preview"
      description="The draft as it prints, with the figures of the analysis picked."
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
        <div className="flex flex-wrap gap-2">
          <select
            value={analysisId}
            onChange={(e) => choose(e.target.value, null)}
            className={`${input} min-w-0 flex-1`}
            aria-label="Analysis"
          >
            {analyses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.borrower}: {a.name}
              </option>
            ))}
          </select>
          <select
            value={scenarioId ?? ""}
            onChange={(e) => choose(analysisId, e.target.value || null)}
            className={`${input} min-w-0 flex-1`}
            aria-label="Scenario"
          >
            <option value="">Base case</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
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
