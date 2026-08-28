import { useEffect } from "react";
import { HeaderBar } from "./header-bar.tsx";
import { ConnectWallet } from "./connect-wallet.tsx";
import { TrustedDevs } from "./trusted-devs.tsx";
import { MetricsPanel } from "./metrics-panel.tsx";
import { PositionsTable } from "./positions-table.tsx";
import { LiveTape } from "./live-tape.tsx";
import { TradeHistory } from "./trade-history.tsx";
import { LogWindow } from "./log-window.tsx";
import { SettingsPanel } from "./settings-panel.tsx";
import { PnlChart } from "./pnl-chart.tsx";
import { PanicDialog } from "./panic-dialog.tsx";
import { useBotStore } from "@/store/bot-store.ts";

export function Desk() {
  const refreshWalletStatus = useBotStore((s) => s.refreshWalletStatus);

  useEffect(() => {
    void refreshWalletStatus();
  }, [refreshWalletStatus]);

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
      <SettingsPanel />
      <PanicDialog />
    </div>
  );
}
