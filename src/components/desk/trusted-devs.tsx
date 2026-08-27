import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { useBotStore } from "@/store/bot-store.ts";

export function TrustedDevs() {
  const tick = useBotStore((s) => s.tick);
  const engine = useBotStore((s) => s.engine);
  const addDevWallets = useBotStore((s) => s.addDevWallets);
  const removeDevWallet = useBotStore((s) => s.removeDevWallet);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  void tick;

  const entries = engine.allow.entries;

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
            Coins created by these wallets can be bought. Everyone else is skipped.
          </p>
        </div>
        <span className="font-mono text-xs tabular-nums text-subtle">{entries.length}</span>
      </div>

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
        <p className="mt-4 text-sm text-muted">None yet. Add a creator before Start.</p>
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
                aria-label={`Remove ${e.original}`}
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
