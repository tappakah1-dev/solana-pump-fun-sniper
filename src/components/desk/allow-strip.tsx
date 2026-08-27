import { useBotStore } from "@/store/bot-store.ts";
import { shortAddr } from "@/lib/utils.ts";

export function AllowStrip() {
  const tick = useBotStore((s) => s.tick);
  const engine = useBotStore((s) => s.engine);
  void tick;
  const entries = engine.allow.entries;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg px-4 py-2 lg:px-6">
      <span className="text-[10px] uppercase tracking-[0.14em] text-subtle">allow.txt</span>
      {entries.length === 0 ? (
        <span className="text-xs text-muted">empty — load wallets in settings</span>
      ) : (
        entries.map((e) => (
          <span
            key={e.key}
            className="rounded-sm border border-border bg-surface px-2 py-0.5 font-mono text-[11px] text-fg"
            title={e.original}
          >
            {shortAddr(e.original, 6)}
            {e.label ? <span className="ml-1 text-subtle">{e.label}</span> : null}
          </span>
        ))
      )}
    </div>
  );
}
