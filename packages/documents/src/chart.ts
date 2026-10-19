import { escape } from "./format";
import type { Locale } from "./locale";

// Charts as documents print them: an SVG of bars, lines or both over the
// periods, projected periods shaded and a threshold drawn dashed, stepping
// by year, or by month for a borrowing base, where it does. Plain SVG, so a
// PDF renders it as vectors with no script.

export interface ChartInput {
  format: "amount" | "percent" | "ratio" | "count";
  // Months rather than years: a borrowing base's.
  monthly?: boolean;
  periods: { label: string; projected: boolean }[];
  series: { label: string; mark: "bar" | "line"; values: (number | null)[] }[];
  threshold: { label: string; values: (number | null)[] } | null;
}

// Print-friendly colours, in series order.
export const SERIES_COLORS = [
  "#2563eb",
  "#ea580c",
  "#16a34a",
  "#9333ea",
  "#0891b2",
  "#ca8a04",
];

// Round ticks from zero (or the lowest value) past the highest.
function ticks(values: number[]): number[] {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  if (low === high) return [0, 1];
  const rough = (high - low) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ??
    10 * magnitude;
  const list = [];
  for (let t = Math.floor(low / step) * step; t < high + step; t += step) {
    list.push(Number(t.toPrecision(12)));
    if (t >= high) break;
  }
  return list;
}

export function chartSvg(chart: ChartInput, l: Locale): string {
  const width = 340;
  const height = 190;
  const left = 46;
  const right = 10;
  const top = 10;
  const bottom = 24;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const all = [
    ...chart.series.flatMap((s) => s.values),
    ...(chart.threshold?.values ?? []),
  ].filter((v): v is number => v !== null);
  const marks = ticks(all);
  const low = marks[0]!;
  const high = marks.at(-1)!;
  const y = (v: number) => top + plotH - ((v - low) / (high - low)) * plotH;
  const band = plotW / Math.max(1, chart.periods.length);
  const center = (p: number) => left + band * (p + 0.5);
  const parts: string[] = [];

  // Projected periods shaded behind everything.
  const projected = chart.periods.flatMap((p, i) => (p.projected ? [i] : []));
  if (projected.length)
    parts.push(
      `<rect x="${left + band * projected[0]!}" y="${top}" width="${band * projected.length}" height="${plotH}" fill="#f1f5f9"/>`,
    );
  for (const m of marks)
    parts.push(
      `<line x1="${left}" x2="${width - right}" y1="${y(m)}" y2="${y(m)}" stroke="#e2e8f0" stroke-width="1"/>`,
      `<text x="${left - 6}" y="${y(m) + 3}" text-anchor="end" font-size="9" fill="#64748b">${escape(l.tick(m, chart.format))}</text>`,
    );
  // Over twelve periods, every other label or fewer, the last always.
  const every = Math.ceil(chart.periods.length / 12);
  const last = chart.periods.length - 1;
  chart.periods.forEach((p, i) => {
    if ((last - i) % every) return;
    parts.push(
      `<text x="${center(i)}" y="${height - 8}" text-anchor="middle" font-size="${chart.monthly ? 8 : 9}" fill="#64748b">${escape(p.label)}</text>`,
    );
  });

  const bars = chart.series.filter((s) => s.mark === "bar");
  const barW = Math.min(18, (band * 0.7) / Math.max(1, bars.length));
  chart.series.forEach((s, i) => {
    const color = SERIES_COLORS[i % SERIES_COLORS.length]!;
    if (s.mark === "bar") {
      const k = bars.indexOf(s);
      s.values.forEach((v, p) => {
        if (v === null) return;
        // From zero, which the ticks always include, up or down.
        const x = center(p) - (barW * bars.length) / 2 + barW * k;
        const zero = y(0);
        parts.push(
          `<rect x="${x}" y="${Math.min(y(v), zero)}" width="${barW - 1}" height="${Math.abs(y(v) - zero)}" fill="${color}" rx="1.5"/>`,
        );
      });
      return;
    }
    const points = s.values.flatMap((v, p) =>
      v === null ? [] : [`${center(p)},${y(v)}`],
    );
    parts.push(
      `<polyline points="${points.join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
      ...s.values.flatMap((v, p) =>
        v === null
          ? []
          : [
              `<circle cx="${center(p)}" cy="${y(v)}" r="2.8" fill="${color}" stroke="#fff" stroke-width="1"/>`,
            ],
      ),
    );
  });

  // The threshold, stepping halfway between periods where it changes.
  if (chart.threshold) {
    const path: string[] = [];
    chart.threshold.values.forEach((v, p) => {
      if (v === null) return;
      const from = p === 0 ? left : center(p) - band / 2;
      const to =
        p === chart.periods.length - 1 ? width - right : center(p) + band / 2;
      path.push(`${path.length ? "L" : "M"}${from},${y(v)} L${to},${y(v)}`);
    });
    if (path.length)
      parts.push(
        `<path d="${path.join(" ")}" fill="none" stroke="#0f172a" stroke-width="1.2" stroke-dasharray="4 3"/>`,
      );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img">${parts.join("")}</svg>`;
}

// The legend under a chart's title, in HTML: a key per series, and the
// threshold with its value when it never steps.
export function legendHtml(chart: ChartInput, l: Locale): string {
  const keys = chart.series.map(
    (s, i) =>
      `<span class="key"><i style="background:${SERIES_COLORS[i % SERIES_COLORS.length]};${s.mark === "line" ? "height:2px" : ""}"></i>${escape(s.label)}</span>`,
  );
  const limits = (chart.threshold?.values ?? []).filter(
    (v): v is number => v !== null,
  );
  if (chart.threshold && limits.length) {
    const flat = limits.every((v) => v === limits[0]);
    keys.push(
      `<span class="key"><i class="dashed"></i>${escape(chart.threshold.label)}${flat ? ` ${escape(l.figure(String(limits[0]), chart.format))}` : chart.monthly ? l.w.byMonth : l.w.byYear}</span>`,
    );
  }
  return keys.length > 1 || chart.threshold
    ? `<div class="legend">${keys.join("")}</div>`
    : "";
}
