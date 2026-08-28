import { useEffect, useMemo, useRef } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { LOG_TONE } from "@/engine/logger.ts";
import { useBotStore } from "@/store/bot-store.ts";

export function LogWindow() {
  const tick = useBotStore((s) => s.tick);
  const paused = useBotStore((s) => s.logPaused);
  const filter = useBotStore((s) => s.logFilter);
  const setLogPaused = useBotStore((s) => s.setLogPaused);
  const setLogFilter = useBotStore((s) => s.setLogFilter);
  const logs = useMemo(() => useBotStore.getState().filteredLogs(), [tick, filter]);
  const rows = useMemo(
    () => logs.map((e, i) => ({ e, key: `${e.ts_ms}-${i}` })).reverse(),
    [logs],
  );
  const downloadJsonl = useBotStore((s) => s.downloadJsonl);
  const scroller = useRef<HTMLDivElement>(null);
  void tick;

  useEffect(() => {
    if (paused) return;
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [logs.length, paused, tick]);

  return (
    <section className="flex max-h-[24rem] min-h-48 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-bg">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-subtle">Decision log</h2>
        <div className="flex-1" />
        <Input
          value={filter}
          onChange={(e) => setLogFilter(e.target.value)}
          placeholder="Filter…"
          className="h-8 max-w-48 font-mono text-xs"
        />
        <Label className="flex items-center gap-2 text-xs">
          <Checkbox checked={paused} onCheckedChange={(v) => setLogPaused(Boolean(v))} />
          Pause scroll
        </Label>
        <Button size="sm" variant="ghost" onClick={downloadJsonl}>
          <Download className="size-3.5" />
          JSONL
        </Button>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-5">
        {rows.length === 0 ? (
          <div className="text-subtle">No events yet. Press Start — dry-run papers coins with socials.</div>
        ) : (
          rows.map(({ e, key }) => (
            <div key={key} className={`log-${LOG_TONE[e.level]} whitespace-pre`}>
              {e.human}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
