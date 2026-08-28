import { Play, Square, AlertTriangle, Shield } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { useBotStore } from "@/store/bot-store.ts";
import { fmtSol, shortAddr } from "@/lib/utils.ts";

export function HeaderBar() {
  const tick = useBotStore((s) => s.tick);
  const config = useBotStore((s) => s.config);
  const running = useBotStore((s) => s.running);
  const engine = useBotStore((s) => s.engine);
  const start = useBotStore((s) => s.start);
  const stop = useBotStore((s) => s.stop);
  const setLiveTrading = useBotStore((s) => s.setLiveTrading);
  const setPanicOpen = useBotStore((s) => s.setPanicOpen);
  const operatorSession = useBotStore((s) => s.operatorSession);
  const operatorPubkey = useBotStore((s) => s.operatorPubkey);
  void tick;

  const live = engine.isLiveArmed();
  const open = engine.openCount();
  const connected = running && engine.listenerConnected;
  const operatorLocked = engine.operatorRequired && !operatorSession;

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-3 lg:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-md border border-border bg-surface-2 font-mono text-xs tracking-[0.18em] text-fg">
          AE
        </div>
        <div className="min-w-0">
          <div className="font-display text-sm font-medium tracking-tight text-fg">Allow-Exec</div>
          <div className="text-xs text-subtle">Trusted DEV Pump.fun desk</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={live ? "live" : "dry"}>{live ? "Live" : "Dry run"}</Badge>
        {!live && config.dry_run_any_socials ? (
          <Badge variant="ok" className="normal-case tracking-normal">
            paper any socials
          </Badge>
        ) : null}
        <Badge variant={connected ? "ok" : "default"} className="normal-case tracking-normal">
          {connected ? "listening" : "stopped"}
        </Badge>
        <Badge variant={engine.keyConfigured ? "ok" : "default"} className="normal-case tracking-normal">
          {engine.keyConfigured
            ? engine.walletPublicKey
              ? shortAddr(engine.walletPublicKey, 4)
              : "env wallet"
            : "set BOT_PRIVATE_KEY on Vercel"}
        </Badge>
        {engine.keyConfigured && !engine.liveEnvEnabled ? (
          <Badge variant="live" className="normal-case tracking-normal" title="Live swaps return live_env_disabled until it is true">
            BOT_LIVE_ENABLED off
          </Badge>
        ) : null}
        <Badge
          variant={engine.rpcProvider === "helius" ? "ok" : "default"}
          className="normal-case tracking-normal"
        >
          {engine.rpcProvider === "helius" ? "Helius" : engine.rpcProvider === "custom" ? "custom RPC" : "public RPC"}
        </Badge>
        {engine.operatorRequired ? (
          <Badge variant={operatorSession ? "ok" : "live"} className="normal-case tracking-normal">
            {operatorSession
              ? `op ${shortAddr(operatorPubkey || "connected", 3)}`
              : "wallet locked"}
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-4 font-mono text-xs tabular-nums">
        <Stat k="wallet" v={`${fmtSol(engine.walletSol)} SOL`} />
        <Stat
          k="day pnl"
          v={`${engine.risk.dailyPnl >= 0 ? "+" : ""}${fmtSol(engine.risk.dailyPnl)}`}
          tone={engine.risk.dailyPnl < 0 ? "live" : engine.risk.dailyPnl > 0 ? "buy" : undefined}
        />
        <Stat k="open" v={String(open)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button variant="secondary" onClick={stop}>
            <Square className="size-3.5" />
            Stop
          </Button>
        ) : (
          <Button onClick={start} disabled={operatorLocked} title={operatorLocked ? "Connect the whitelisted Phantom first (Solana network)" : undefined}>
            <Play className="size-3.5" />
            Start
          </Button>
        )}
        <Button variant="danger" onClick={() => setPanicOpen(true)}>
          <AlertTriangle className="size-3.5" />
          Panic
        </Button>
        {live ? (
          <Button variant="secondary" onClick={() => setLiveTrading(false)} title="Back to paper trading">
            <Shield className="size-3.5" />
            Dry run
          </Button>
        ) : (
          <Button
            variant="ghost"
            onClick={() => setLiveTrading(true)}
            disabled={operatorLocked}
            title={
              operatorLocked
                ? "Connect the whitelisted Phantom first (Solana network)"
                : "Arm real SOL trades (BOT_LIVE_ENABLED must be true on Vercel)"
            }
          >
            <Shield className="size-3.5" />
            Live
          </Button>
        )}
      </div>
    </header>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-[0.14em] text-subtle">{k}</span>
      <span className={tone === "live" ? "text-live" : tone === "buy" ? "text-buy" : "text-fg"}>{v}</span>
    </div>
  );
}
