import { useEffect, useState } from "react";
import { HeaderBar } from "./header-bar.tsx";
import { ConnectWallet } from "./connect-wallet.tsx";
import { TrustedDevs } from "./trusted-devs.tsx";
import { MetricsPanel } from "./metrics-panel.tsx";
import { PositionsTable } from "./positions-table.tsx";
import { LiveTape } from "./live-tape.tsx";
import { TradeHistory } from "./trade-history.tsx";
import { LogWindow } from "./log-window.tsx";
import { PnlChart } from "./pnl-chart.tsx";
import { PanicDialog } from "./panic-dialog.tsx";
import { useBotStore } from "@/store/bot-store.ts";

export function Desk() {
  const refreshWalletStatus = useBotStore((s) => s.refreshWalletStatus);
  // The desk renders saved browser config (dial, metrics, times) that can
  // never match the server's default-config HTML — server-render a blank
  // shell and paint client-side only, so hydration can't mismatch and break
  // the page's event system.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    void refreshWalletStatus();
  }, [refreshWalletStatus]);

  // Wallet env lookups can fail on a cold start (serverless warm-up). Retry in
  // the background until the wallet public key is known, so the balance and
  // live status stop looking frozen after a deploy.
  useEffect(() => {
    const id = setInterval(() => {
      const s = useBotStore.getState();
      if (!s.engine.walletPublicKey) void s.refreshWalletStatus();
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  if (!mounted) {
    return <div className="flex min-h-dvh flex-col bg-bg text-fg" />;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <HeaderBar />
      <div className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-4 p-4 lg:p-5">
        <ConnectWallet />
        <TrustedDevs />
        <MetricsPanel />
        <div className="flex flex-col gap-4">
          <PositionsTable />
          <LiveTape />
        </div>
        <TradeHistory />
        <div className="flex min-h-[220px]">
          <LogWindow />
        </div>
        <PnlChart />
      </div>
      <PanicDialog />
    </div>
  );
}
