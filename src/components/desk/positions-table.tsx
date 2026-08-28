import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
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
  const sell25 = useBotStore((s) => s.sell25);
  const sell50 = useBotStore((s) => s.sell50);
  const sellAll = useBotStore((s) => s.sellAll);
  void tick;

  return (
    <section className="flex h-[22rem] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">Positions</h2>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-muted">{rows.length} open</span>
      </div>
      {!rows.length ? (
        <p className="px-4 py-6 text-sm text-muted text-pretty">
          No tickets yet. Start on dry-run to paper-fill coins with socials. Live only buys trusted DEVs.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-surface text-[10px] uppercase tracking-[0.12em] text-subtle">
              <tr className="border-b border-border">
                {["token", "phase", "fill", "now", "mult", "real", ""].map((h) => (
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
                  <td className={`px-3 py-2 ${PHASE_TONE[r.pos.phase]}`}>
                    <Badge
                      variant="phase"
                      className="normal-case tracking-normal"
                      title={r.pos.last_think || r.pos.last_regime || undefined}
                    >
                      {r.pos.phase}
                      {r.pos.rent_armed && !r.pos.did_rent ? " · trail" : ""}
                      {r.pos.did_rent_peel && !r.pos.did_rent ? " peel" : ""}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">{fmtMcap(r.pos.fill_mcap)}</td>
                  <td className="px-3 py-2">{fmtMcap(r.nowMcap)}</td>
                  <td className="px-3 py-2">{fmtMult(r.multiple)}</td>
                  <td className={r.unrealized >= 0 ? "px-3 py-2 text-buy" : "px-3 py-2 text-live"}>
                    {fmtSol(r.pos.realized_sol)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2"
                        disabled={r.pos.phase === "CLOSED" || r.pos.tokens_left <= 0}
                        onClick={() => sell25(r.pos.mint)}
                      >
                        25%
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2"
                        disabled={r.pos.phase === "CLOSED" || r.pos.tokens_left <= 0}
                        onClick={() => sell50(r.pos.mint)}
                      >
                        50%
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2"
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
      )}
    </section>
  );
}
