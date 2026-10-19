"use client";

import { useState, type ReactNode } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatFigure } from "@/lib/format";

// A chart over financial figures by period, reusable wherever lines have
// values: bars, lines or both on one axis (series share a format), projected
// periods shaded, an optional threshold, and a table view with the same
// numbers. Colors come from the --chart-n tokens, in series order, so a
// series keeps its color whatever else is shown.

export type ChartFormat = "amount" | "percent" | "ratio" | "count";

export interface ChartPeriod {
  label: string;
  // A longer label for the tooltip and table, e.g. "Dec 31, 2025 · Projected".
  detail: string;
  projected: boolean;
}

export interface ChartSeries {
  label: string;
  mark: "bar" | "line";
  values: (number | null)[];
  // The base case under a scenario: drawn in neutral gray, for reference.
  reference?: boolean;
}

// A limit drawn across the chart, such as a covenant's: by period, as it can
// step from one year to the next; blank where none applies.
export interface ChartThreshold {
  label: string;
  values: (number | null)[];
}

export interface MetricChartProps {
  title: ReactNode;
  format: ChartFormat;
  periods: ChartPeriod[];
  series: ChartSeries[];
  threshold?: ChartThreshold | null;
  // How a threshold that changes steps, for its legend: "by year".
  steps?: string;
  // Bars stack as parts of a whole, such as a borrowing base by collateral.
  stacked?: boolean;
  // Buttons for the card header, such as edit and remove.
  actions?: ReactNode;
  height?: number;
}

const color = (series: ChartSeries, index: number) =>
  series.reference ? "var(--muted)" : `var(--chart-${(index % 8) + 1})`;

const compact = new Intl.NumberFormat("en-CA", {
  notation: "compact",
  maximumFractionDigits: 2,
});

function tick(value: number, format: ChartFormat) {
  if (format === "percent") return `${Math.round(value * 1000) / 10}%`;
  if (format === "ratio") return `${Math.round(value * 100) / 100}x`;
  return compact.format(value);
}

// Round ticks from zero (or the lowest value, when negative) past the
// highest, four or five steps apart: 0 / 1x / 2x…, 0 / 5M / 10M….
export function niceTicks(values: number[]): number[] {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  if (low === high) return [0, 1];
  const rough = (high - low) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ??
    10 * magnitude;
  const ticks = [];
  for (let t = Math.floor(low / step) * step; t < high + step; t += step) {
    ticks.push(Number(t.toPrecision(12)));
    if (t >= high) break;
  }
  return ticks;
}

const show = (value: number | null | undefined, format: ChartFormat) =>
  value === null || value === undefined
    ? "–"
    : formatFigure(String(value), format);

export function MetricChart({
  title,
  format,
  periods,
  series,
  threshold = null,
  steps = "by year",
  stacked = false,
  actions,
  height = 220,
}: MetricChartProps) {
  const [asTable, setAsTable] = useState(false);
  const limits = (threshold?.values ?? []).filter(
    (v): v is number => v !== null,
  );
  // One value throughout draws as a reference line; steps draw as a line
  // that steps with them.
  const flat =
    limits.length > 0 &&
    limits.length === periods.length &&
    limits.every((v) => v === limits[0])
      ? limits[0]!
      : null;
  const data = periods.map((period, p) => ({
    label: period.label,
    ...Object.fromEntries(series.map((s, i) => [`s${i}`, s.values[p] ?? null])),
    limit: threshold?.values[p] ?? null,
  }));
  const projected = periods.filter((p) => p.projected);
  const hasLines = series.some((s) => s.mark === "line");
  const hasBars = series.some((s) => s.mark === "bar");
  // Selective labels: the last value of a lone line, never every point, and
  // none where bars would crowd it.
  const labelEnd =
    !hasBars &&
    series.filter((s) => s.mark === "line" && !s.reference).length === 1;
  // Room on the right for that label, as wide as the figure.
  const endLabel = labelEnd
    ? show(
        series
          .find((s) => s.mark === "line" && !s.reference)
          ?.values.findLast((v) => v !== null),
        format,
      )
    : "";
  // Many periods, such as months, read as a line without a dot on each.
  const dense = periods.length > 12;
  const bars = series.filter((s) => s.mark === "bar");
  // Stacked bars reach their sum, each period.
  const stacks = stacked
    ? periods.map((_, p) =>
        bars.reduce((sum, s) => sum + (s.values[p] ?? 0), 0),
      )
    : [];
  const ticks = niceTicks([
    ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)),
    ...stacks,
    ...limits,
  ]);
  const lastBar = series.findLastIndex((s) => s.mark === "bar");
  // The base case draws first, behind the scenario it compares with.
  const order = series
    .map((s, i) => ({ s, i }))
    .sort(
      (a, b) => Number(Boolean(b.s.reference)) - Number(Boolean(a.s.reference)),
    );

  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-pressed={asTable}
            onClick={() => setAsTable(!asTable)}
            className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-foreground aria-pressed:bg-surface-2 aria-pressed:text-foreground"
          >
            Table
          </button>
          {actions}
        </div>
      </header>

      {(series.length > 1 || limits.length > 0) && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {series.map((s, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <Key mark={s.mark} color={color(s, i)} />
              {s.label}
            </li>
          ))}
          {threshold && limits.length > 0 && (
            <li className="flex items-center gap-1.5">
              <svg width="14" height="8" aria-hidden>
                <line
                  x1="0"
                  y1="4"
                  x2="14"
                  y2="4"
                  stroke="var(--foreground)"
                  strokeWidth="1.5"
                  strokeDasharray="3 2"
                />
              </svg>
              {threshold.label}
              {flat !== null ? ` ${show(flat, format)}` : `, ${steps}`}
            </li>
          )}
        </ul>
      )}

      {asTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted">
                <th className="py-1 pr-3 text-left font-normal" />
                {periods.map((p, i) => (
                  <th
                    key={i}
                    className="px-2 py-1 text-right font-normal whitespace-nowrap"
                    title={p.detail}
                  >
                    {p.label}
                    {p.projected ? "*" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {series.map((s, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1 pr-3 text-left">{s.label}</td>
                  {s.values.map((v, p) => (
                    <td key={p} className="px-2 py-1 text-right">
                      {show(v, format)}
                    </td>
                  ))}
                </tr>
              ))}
              {threshold && limits.length > 0 && (
                <tr className="border-t border-line text-muted">
                  <td className="py-1 pr-3 text-left">{threshold.label}</td>
                  {threshold.values.map((v, p) => (
                    <td key={p} className="px-2 py-1 text-right">
                      {show(v, format)}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
          {projected.length > 0 && (
            <p className="mt-1 text-xs text-muted">* Projected</p>
          )}
        </div>
      ) : (
        <ComposedChart
          responsive
          style={{ width: "100%", height }}
          data={data}
          margin={{
            top: 20,
            right: labelEnd ? Math.max(48, 12 + endLabel.length * 7) : 8,
            bottom: 0,
            left: 0,
          }}
          barGap={2}
          barCategoryGap="30%"
        >
          <CartesianGrid vertical={false} stroke="var(--line)" />
          {projected.length > 0 && (
            <ReferenceArea
              x1={projected[0]!.label}
              x2={projected.at(-1)!.label}
              fill="var(--surface-2)"
              fillOpacity={1}
              ifOverflow="extendDomain"
              // Above the plot, clear of lines and thresholds.
              label={{
                value: "Projected",
                position: "top",
                fill: "var(--muted)",
                fontSize: 11,
              }}
            />
          )}
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: "var(--line-strong)" }}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            interval="preserveStartEnd"
          />
          <YAxis
            width={52}
            ticks={ticks}
            domain={[ticks[0]!, ticks.at(-1)!]}
            allowDataOverflow
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickFormatter={(v: number) => tick(v, format)}
          />
          <Tooltip
            isAnimationActive={false}
            cursor={
              hasBars && !hasLines
                ? { fill: "var(--surface-2)", opacity: 0.6 }
                : { stroke: "var(--line-strong)", strokeWidth: 1 }
            }
            content={({ active, label, payload }) => (
              <ChartTooltip
                active={active}
                label={label}
                payload={payload}
                periods={periods}
                series={series}
                format={format}
              />
            )}
          />
          {flat !== null ? (
            <ReferenceLine
              y={flat}
              stroke="var(--foreground)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          ) : (
            limits.length > 0 && (
              <Line
                dataKey="limit"
                name={threshold!.label}
                type="step"
                stroke="var(--foreground)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
              />
            )
          )}
          {order.map(({ s, i }) =>
            s.mark === "bar" ? (
              <Bar
                key={i}
                dataKey={`s${i}`}
                name={s.label}
                fill={color(s, i)}
                maxBarSize={24}
                stackId={stacked ? "stack" : undefined}
                radius={!stacked || i === lastBar ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
              />
            ) : (
              <Line
                key={i}
                dataKey={`s${i}`}
                name={s.label}
                type="linear"
                stroke={color(s, i)}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={
                  dense
                    ? false
                    : {
                        r: 4,
                        fill: color(s, i),
                        stroke: "var(--surface)",
                        strokeWidth: 2,
                      }
                }
                activeDot={{
                  r: 5,
                  fill: color(s, i),
                  stroke: "var(--surface)",
                  strokeWidth: 2,
                }}
                isAnimationActive={false}
              >
                {labelEnd && !s.reference && (
                  <LabelList
                    dataKey={`s${i}`}
                    content={({ x, y, value, index }) =>
                      index === data.length - 1 && value !== null ? (
                        <text
                          x={Number(x) + 8}
                          y={Number(y)}
                          dy={4}
                          fill="var(--foreground)"
                          fontSize={12}
                        >
                          {show(Number(value), format)}
                        </text>
                      ) : null
                    }
                  />
                )}
              </Line>
            ),
          )}
        </ComposedChart>
      )}
    </section>
  );
}

// Legend keys mirror the mark: a rounded block for bars, a stroke for lines.
function Key({ mark, color }: { mark: "bar" | "line"; color: string }) {
  return mark === "bar" ? (
    <span
      aria-hidden
      className="inline-block size-2.5 rounded-sm"
      style={{ background: color }}
    />
  ) : (
    <span
      aria-hidden
      className="inline-block h-0.5 w-3.5 rounded-full"
      style={{ background: color }}
    />
  );
}

// Every series at the hovered period: the value first, then the series.
function ChartTooltip({
  active,
  label,
  payload,
  periods,
  series,
  format,
}: {
  active?: boolean;
  label?: unknown;
  payload?: readonly { dataKey?: unknown; value?: unknown }[];
  periods: ChartPeriod[];
  series: ChartSeries[];
  format: ChartFormat;
}) {
  if (!active || !payload?.length) return null;
  const period = periods.find((p) => p.label === label);
  return (
    <div className="flex min-w-40 flex-col gap-1.5 rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="text-muted">{period?.detail ?? String(label)}</p>
      {series.map((s, i) => {
        const value = payload.find((item) => item.dataKey === `s${i}`)?.value;
        return (
          <p key={i} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-0.5 w-3 shrink-0 rounded-full"
              style={{ background: color(s, i) }}
            />
            <span className="font-medium text-foreground tabular-nums">
              {show(typeof value === "number" ? value : null, format)}
            </span>
            <span className="truncate text-muted">{s.label}</span>
          </p>
        );
      })}
    </div>
  );
}
