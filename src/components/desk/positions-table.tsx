import { useMemo } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { useBotStore } from "@/store/bot-store.ts";
import { fmtMcap, fmtMult, fmtSol, shortAddr } from "@/lib/utils.ts";
import type { Phase } from "@/engine/models.ts";

const PHASE_TONE: Record<Phase, string> = {
  DETECTED: "text-muted",
  OPEN_IGNORE: "text-muted",
  SHAKEOUT: "text-wick",
  SEEK_RENT: "text-rent",
  STUB: "text-keep",
  MOONBAG: "text-moon",
  CLOSED: "text-subtle",
};

export function PositionsTable() {
  const tick = useBotStore((s) => s.tick);
  const rows = useMemo(() => useBotStore.getState().rows(), [tick]);
  const sell50 = useBotStore((s) => s.sell50);
  const sellAll = useBotStore((s) => s.sellAll);
  void tick;

  if (!rows.length) {
    return (
      <div className="flex h-full min-h-48 flex-col justify-center rounded-xl border border-border bg-surface px-5 py-8">
        <div className="text-sm font-medium text-fg">No tickets</div>
        <p className="mt-1 max-w-prose text-sm text-muted text-pretty">
          Add trusted DEV wallets (needed for live), set buy size, then press Start. Dry-run can
          paper-fill any coin with socials so you can test exits without waiting on a DEV. Never
          chasing above skip mcap.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">Positions</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="text-[10px] uppercase tracking-[0.12em] text-subtle">
            <tr className="border-b border-border">
              {["token", "phase", "fill", "now", "mult", "real", "u/r", ""].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rows.map((r) => (
              <tr key={r.pos.mint} className="border-b border-border/70 last:border-0">
                <td className="px-3 py-2.5">
                  <div className="font-sans text-sm text-fg">{r.pos.symbol}</div>
                  <div className="text-[10px] text-subtle">
                    {shortAddr(r.pos.creator, 4)}
                    {r.pos.venue === "pump-amm" ? " · AMM" : ""}
                  </div>
                </td>
                <td className={`px-3 py-2.5 ${PHASE_TONE[r.pos.phase]}`}>
                  <Badge variant="phase" className="normal-case tracking-normal">
                    {r.pos.phase}
                    {r.pos.rent_armed && !r.pos.did_rent ? " · trailing" : ""}
                    {r.pos.did_rent_peel && !r.pos.did_rent ? " peel" : ""}
                  </Badge>
                  {r.pos.last_regime ? (
                    <div className="mt-1 max-w-40 truncate text-[10px] text-subtle">
                      {r.pos.last_regime}
                      {r.pos.last_think ? ` · ${r.pos.last_think.replace(/^THINK /, "")}` : ""}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">{fmtMcap(r.pos.fill_mcap)}</td>
                <td className="px-3 py-2.5">{fmtMcap(r.nowMcap)}</td>
                <td className="px-3 py-2.5">{fmtMult(r.multiple)}</td>
                <td className="px-3 py-2.5">{fmtSol(r.pos.realized_sol)}</td>
                <td className={r.unrealized >= 0 ? "px-3 py-2.5 text-buy" : "px-3 py-2.5 text-live"}>
                  {fmtSol(r.unrealized)}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={r.pos.phase === "CLOSED" || r.pos.tokens_left <= 0}
                      onClick={() => sell50(r.pos.mint)}
                    >
                      50%
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={r.pos.phase === "CLOSED" || r.pos.tokens_left <= 0}
                      onClick={() => sellAll(r.pos.mint)}
                    >
                      All
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
