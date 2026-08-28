import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { useBotStore } from "@/store/bot-store.ts";
import { fmtMcap, fmtMult, fmtSol, fmtTime, shortAddr } from "@/lib/utils.ts";

export function TradeHistory() {
  const tick = useBotStore((s) => s.tick);
  const rows = useMemo(() => useBotStore.getState().historyRows(), [tick]);
  void tick;

  return (
    <section className="flex h-[16rem] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">
          Traded coins history
        </h2>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-muted">
          {rows.length} closed
        </span>
      </div>
      {!rows.length ? (
        <p className="px-4 py-6 text-sm text-muted text-pretty">
          No closed trades yet. Exits land here with peak multiple and realized PnL.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-surface text-[10px] uppercase tracking-[0.12em] text-subtle">
              <tr className="border-b border-border">
                {["token", "filled", "peak", "exit", "pnl"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {rows.map((r) => (
                <tr key={r.pos.mint} className="border-b border-border/70 last:border-0">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-sans text-[13px] text-fg">{r.pos.symbol}</span>
                      <a
                        href={`https://trade.padre.gg/trade/solana/${r.pos.mint}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 rounded-md border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted hover:border-accent/50 hover:text-fg"
                        title="Open in Padre"
                      >
                        Padre
                        <ExternalLink className="size-2.5" />
                      </a>
                    </div>
                    <div className="text-[10px] text-subtle">
                      {shortAddr(r.pos.creator, 4)}
                      {r.pos.venue === "pump-amm" ? " · AMM" : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{fmtMcap(r.pos.fill_mcap)}</div>
                    <div className="text-[10px] text-subtle">{fmtTime(r.pos.fill_ts)}</div>
                  </td>
                  <td className="px-3 py-2">{fmtMult(r.peakMult)}</td>
                  <td className="px-3 py-2 text-subtle">{r.pos.last_reason || r.pos.last_action || "—"}</td>
                  <td className={r.net >= 0 ? "px-3 py-2 text-buy" : "px-3 py-2 text-live"}>
                    {fmtSol(r.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
