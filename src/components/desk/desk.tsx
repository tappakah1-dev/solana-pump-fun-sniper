import { useEffect } from "react";
import { HeaderBar } from "./header-bar.tsx";
import { ConnectWallet } from "./connect-wallet.tsx";
import { TrustedDevs } from "./trusted-devs.tsx";
import { MetricsPanel } from "./metrics-panel.tsx";
import { PositionsTable } from "./positions-table.tsx";
import { LiveTape } from "./live-tape.tsx";
import { LogWindow } from "./log-window.tsx";
import { SettingsPanel } from "./settings-panel.tsx";
import { ReplayPanel } from "./replay-panel.tsx";
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
      <div className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-4 p-4 lg:p-5">
        <ConnectWallet />
        <TrustedDevs />
        <MetricsPanel />
        <div className="grid gap-4 lg:grid-cols-2">
          <PositionsTable />
          <LiveTape />
        </div>
        <div className="flex min-h-[220px]">
          <LogWindow />
        </div>
        <ReplayPanel />
      </div>
      <SettingsPanel />
      <PanicDialog />
    </div>
  );
}
