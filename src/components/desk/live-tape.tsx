import { useMemo } from "react";
import { useBotStore } from "@/store/bot-store.ts";
import { fmtMcap, fmtTime, shortAddr } from "@/lib/utils.ts";
import { Badge } from "@/components/ui/badge.tsx";

export function LiveTape() {
  const tick = useBotStore((s) => s.tick);
  const feed = useBotStore((s) => s.feed);
  const running = useBotStore((s) => s.running);
  const lastPoll = useBotStore((s) => s.lastPoll);
  const listenerError = useBotStore((s) => s.listenerError);
  const coinsSeen = useBotStore((s) => s.coinsSeen);
  void tick;

  const rows = useMemo(() => feed, [feed]);

  return (
    <section className="flex min-h-56 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">Pump.fun tape</h2>
        <div className="flex-1" />
        <span className="font-mono text-[10px] tabular-nums text-muted">
          {running ? `${coinsSeen} seen` : "stopped"}
          {lastPoll ? ` · ${fmtTime(lastPoll)}` : ""}
        </span>
      </div>
      {listenerError ? (
        <div className="px-4 py-2 text-xs text-live">{listenerError}</div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {!running && rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted text-pretty">
            Press Start. The desk watches live Pump.fun creates and only buys trusted DEV wallets.
          </p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">Listening for creates…</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface text-[10px] uppercase tracking-[0.12em] text-subtle">
              <tr className="border-b border-border">
                <th className="px-3 py-2 font-medium">token</th>
                <th className="px-3 py-2 font-medium">creator</th>
                <th className="px-3 py-2 font-medium">mcap</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {rows.map((r) => (
                <tr key={r.mint} className="border-b border-border/70 last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-sans text-[13px] text-fg">{r.symbol}</div>
                    <div className="max-w-36 truncate text-[10px] text-subtle">{r.name}</div>
                  </td>
                  <td className="px-3 py-2 text-muted">{shortAddr(r.creator, 4)}</td>
                  <td className="px-3 py-2">{fmtMcap(r.mcap)}</td>
                  <td className="px-3 py-2">
                    {r.allow ? (
                      <Badge variant="ok">buy</Badge>
                    ) : (
                      <Badge variant="default">skip</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
