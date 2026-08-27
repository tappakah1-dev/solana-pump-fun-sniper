import { useState } from "react";
import { Wallet, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { useBotStore } from "@/store/bot-store.ts";
import { shortAddr } from "@/lib/utils.ts";

export function ConnectWallet() {
  const tick = useBotStore((s) => s.tick);
  const engine = useBotStore((s) => s.engine);
  const operatorSession = useBotStore((s) => s.operatorSession);
  const operatorPubkey = useBotStore((s) => s.operatorPubkey);
  const operatorError = useBotStore((s) => s.operatorError);
  const connectOperator = useBotStore((s) => s.connectOperator);
  const disconnectOperator = useBotStore((s) => s.disconnectOperator);
  const [busy, setBusy] = useState(false);
  void tick;

  const required = engine.operatorRequired;
  const connected = Boolean(operatorSession && operatorPubkey);
  const rpc = engine.rpcProvider;

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-fg">Operator wallet</h2>
          <p className="mt-1 text-sm text-muted text-pretty">
            {required
              ? "Only wallets in OPERATOR_WHITELIST can Start or arm live. Sign a nonce — the bot key stays on the server."
              : "No whitelist set. Anyone with this URL can dry-run. Set OPERATOR_WHITELIST on Vercel to lock the desk."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-sm border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            rpc {rpc}
          </span>
          {required ? (
            <span className="rounded-sm border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              {engine.operatorWalletCount} listed
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!required ? (
          <span className="text-xs text-subtle">Desk is open until you set OPERATOR_WHITELIST.</span>
        ) : connected ? (
          <>
            <span className="font-mono text-xs text-buy">{shortAddr(operatorPubkey, 4)}</span>
            <Button size="sm" variant="ghost" onClick={disconnectOperator}>
              <Unplug className="size-3.5" />
              Disconnect
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void connectOperator().finally(() => setBusy(false));
            }}
          >
            <Wallet className="size-3.5" />
            {busy ? "Waiting for wallet…" : "Connect wallet"}
          </Button>
        )}
      </div>
      {operatorError ? <p className="mt-2 text-xs text-live">{operatorError}</p> : null}
    </section>
  );
}
