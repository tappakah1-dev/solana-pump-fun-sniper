import { Button } from "@/components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { useBotStore } from "@/store/bot-store.ts";
import { shortAddr } from "@/lib/utils.ts";

export function SettingsPanel() {
  const open = useBotStore((s) => s.settingsOpen);
  const setOpen = useBotStore((s) => s.setSettingsOpen);
  const config = useBotStore((s) => s.config);
  const setConfigField = useBotStore((s) => s.setConfigField);
  const livePhrase = useBotStore((s) => s.livePhrase);
  const setLivePhrase = useBotStore((s) => s.setLivePhrase);
  const confirmLive = useBotStore((s) => s.confirmLive);
  const understood = useBotStore((s) => s.understood);
  const engine = useBotStore((s) => s.engine);
  const refreshWalletStatus = useBotStore((s) => s.refreshWalletStatus);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[min(96vw,28rem)] p-0">
        <div className="border-b border-border px-5 py-4">
          <DialogHeader>
            <DialogTitle>Live arm</DialogTitle>
            <DialogDescription>
              The wallet key is not typed here. Push this bot to GitHub, then set Vercel env:
              BOT_PRIVATE_KEY, BOT_LIVE_ENABLED=true, HELIUS_API_KEY, OPERATOR_WHITELIST.
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="rounded-lg border border-border bg-bg px-3 py-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">BOT_PRIVATE_KEY</span>
              <span className="font-mono text-xs text-fg">
                {engine.keyConfigured
                  ? engine.walletPublicKey
                    ? shortAddr(engine.walletPublicKey, 4)
                    : "loaded"
                  : "not set"}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-muted">BOT_LIVE_ENABLED</span>
              <span className="font-mono text-xs text-fg">{engine.liveEnvEnabled ? "true" : "false"}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-muted">HELIUS_API_KEY</span>
              <span className="font-mono text-xs text-fg">{engine.rpcProvider === "helius" ? "loaded" : "not set"}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-muted">OPERATOR_WHITELIST</span>
              <span className="font-mono text-xs text-fg">
                {engine.operatorRequired ? `${engine.operatorWalletCount} wallets` : "open"}
              </span>
            </div>
            <Button size="sm" variant="ghost" className="mt-2 px-0" onClick={() => void refreshWalletStatus()}>
              Recheck env
            </Button>
          </div>

          <Label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2">
            <span className="text-fg">Dry run</span>
            <Switch
              checked={config.dry_run}
              onCheckedChange={(v) => {
                setConfigField("dry_run", v);
                if (v) setConfigField("live", false);
              }}
            />
          </Label>

          <div className="rounded-lg border border-live/40 bg-live/5 p-3">
            <p className="text-xs text-muted text-pretty">
              Type I UNDERSTAND to arm live buys. The key never appears in the UI, logs, or GitHub.
            </p>
            <Label className="mt-3 grid gap-1">
              Confirmation
              <Input
                value={livePhrase}
                onChange={(e) => setLivePhrase(e.target.value)}
                placeholder="I UNDERSTAND"
                autoComplete="off"
              />
            </Label>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" variant="danger" onClick={() => void confirmLive()}>
                Arm live
              </Button>
              <span className="text-xs text-muted">
                {understood ? (engine.hasKeyLoaded() ? "Armed" : "Phrase ok — env not ready") : "Not armed"}
              </span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
