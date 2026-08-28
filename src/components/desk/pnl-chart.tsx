import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useBotStore, type PnlPoint } from "@/store/bot-store.ts";
import { fmtSol, fmtTime } from "@/lib/utils.ts";

// Dark-only desk surface (#101214). Single series — the title names it, so no
// legend. Line is the app's keep-blue; grid/axis ink uses the app's tokens.
const SERIES = "#6a8fbf"; // --color-keep
const SURFACE = "#101214"; // --color-surface (dot ring)
const GRID = "#2a2d33"; // --color-border
const INK = "#6d6f68"; // --color-subtle
const ZERO = "#6d6f68";

interface TooltipEntry {
  payload?: PnlPoint;
}

function PnlTooltip({ active, payload }: { active?: boolean; payload?: TooltipEntry[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-3 px-3 py-2 font-mono text-[11px] shadow-lg">
      <div className="text-subtle">
        {fmtTime(p.ts)} · {p.symbol}
      </div>
      <div className="mt-1 flex items-center justify-between gap-4">
        <span className="text-subtle">{p.reason}</span>
        <span className={p.net >= 0 ? "text-buy" : "text-live"}>{fmtSol(p.net)}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-4 border-t border-border pt-1">
        <span className="text-subtle">total</span>
        <span className="text-fg tabular-nums">{fmtSol(p.total)}</span>
      </div>
    </div>
  );
}

export function PnlChart() {
  const tick = useBotStore((s) => s.tick);
  const series = useMemo(() => useBotStore.getState().pnlSeries(), [tick]);
  void tick;

  const total = series.length ? series[series.length - 1]!.total : 0;

  return (
    <section className="flex h-[16rem] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">PnL</h2>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-muted">
          {series.length} closed
        </span>
        <span
          className={`font-mono text-sm tabular-nums ${total >= 0 ? "text-buy" : "text-live"}`}
          title="Cumulative net realized SOL"
        >
          {fmtSol(total)}
        </span>
      </div>
      {!series.length ? (
        <p className="px-4 py-6 text-sm text-muted text-pretty">
          No closed trades yet. Cumulative net realized PnL will draw here.
        </p>
      ) : (
        <div className="min-h-0 flex-1 px-2 pb-2 pt-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 4, right: 16, bottom: 0, left: 4 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="1 3" vertical={false} />
              <XAxis
                dataKey="ts"
                tickFormatter={(ts: number) => fmtTime(ts)}
                stroke={INK}
                tick={{ fill: INK, fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: GRID }}
                minTickGap={56}
              />
              <YAxis
                stroke={INK}
                tick={{ fill: INK, fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => fmtSol(v, 1)}
                width={46}
              />
              <Tooltip
                content={(props) => (
                  <PnlTooltip
                    active={props.active}
                    payload={props.payload as TooltipEntry[] | undefined}
                  />
                )}
                cursor={{ stroke: INK, strokeDasharray: "2 2" }}
              />
              <ReferenceLine y={0} stroke={ZERO} strokeDasharray="4 4" />
              <Line
                type="stepAfter"
                dataKey="total"
                stroke={SERIES}
                strokeWidth={2}
                dot={{ r: 4, fill: SERIES, stroke: SURFACE, strokeWidth: 1.5 }}
                activeDot={{ r: 4, fill: SERIES, stroke: SURFACE, strokeWidth: 1.5 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
