import { useEffect, useState } from "react";
import { Cloud, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Label } from "@/components/ui/label.tsx";
import { useBotStore } from "@/store/bot-store.ts";

export function TrustedDevs() {
  const tick = useBotStore((s) => s.tick);
  const engine = useBotStore((s) => s.engine);
  const config = useBotStore((s) => s.config);
  const allowSynced = useBotStore((s) => s.allowSynced);
  const setConfigField = useBotStore((s) => s.setConfigField);
  const addDevWallets = useBotStore((s) => s.addDevWallets);
  const removeDevWallet = useBotStore((s) => s.removeDevWallet);
  const syncAllowDevs = useBotStore((s) => s.syncAllowDevs);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  void tick;

  useEffect(() => {
    void syncAllowDevs();
  }, [syncAllowDevs]);

  const entries = engine.allow.entries;
  const paperOpen = config.dry_run && config.dry_run_any_socials && !config.live;

  function add() {
    const n = addDevWallets(draft);
    if (!n) {
      setErr("Paste one or more Solana wallet addresses");
      return;
    }
    setDraft("");
    setErr("");
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-fg">Trusted DEV wallets</h2>
          <p className="mt-1 text-sm text-muted text-pretty">
            {paperOpen
              ? "Paper mode: any Pump.fun coin with socials can fill. Live still only buys these wallets."
              : config.live_any_socials
                ? "Live trades any coin that passes the rules — this list is optional."
                : "Coins created by these wallets can be bought. Everyone else is skipped."}
          </p>
        </div>
        <span className="ml-auto flex items-center gap-2">
          {allowSynced ? (
            <span className="flex items-center gap-1 font-mono text-[10px] text-muted" title="Saved to your account — survives browsers and redeploys">
              <Cloud className="size-3" />
              synced
            </span>
          ) : null}
          <span className="font-mono text-xs tabular-nums text-subtle">{entries.length}</span>
        </span>
      </div>

      <Label className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2.5">
        <span>
          <span className="block text-sm text-fg">Paper any coin with socials</span>
          <span className="mt-0.5 block text-xs text-subtle">
            Dry-run only. Skip waiting on DEVs — still respects skip-mcap, ticket size, max open. Live ignores this.
          </span>
        </span>
        <Switch
          checked={paperOpen}
          disabled={!config.dry_run}
          onCheckedChange={(v) => setConfigField("dry_run_any_socials", v)}
        />
      </Label>

      <Label className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2.5">
        <span>
          <span className="block text-sm text-fg">Live: any coin with socials</span>
          <span className="mt-0.5 block text-xs text-subtle">
            Live mode only. Real SOL trades any create that passes the other rules (socials, skip-mcap,
            risk limits) — trusted DEV wallets become optional. Ignored in dry-run.
          </span>
        </span>
        <Switch
          checked={config.live_any_socials}
          disabled={config.dry_run}
          onCheckedChange={(v) => setConfigField("live_any_socials", v)}
        />
      </Label>

      <form
        className="mt-3 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Textarea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={"Paste creator wallets, one per line\nAddress  # optional label"}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
        />
        <div className="flex items-center gap-2">
          <Button type="submit">
            <Plus className="size-3.5" />
            Add wallets
          </Button>
          {err ? <p className="text-xs text-live">{err}</p> : null}
        </div>
      </form>

      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          {paperOpen
            ? "No trusted DEVs yet — fine for paper. Add them before you arm live."
            : "None yet. Add a creator before Start, or turn on paper-any-socials for dry-run."}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {entries.map((e) => (
            <li
              key={e.key}
              className="flex items-start gap-2 rounded-lg border border-border bg-bg px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="break-all font-mono text-xs text-fg">{e.original}</div>
                {e.label ? <div className="mt-0.5 truncate text-xs text-muted">{e.label}</div> : null}
              </div>
              <button
                type="button"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
                onClick={() => removeDevWallet(e.original)}
                aria-label="Remove wallet"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}