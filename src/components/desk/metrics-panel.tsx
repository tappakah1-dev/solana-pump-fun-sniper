import { useState } from "react";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { useBotStore } from "@/store/bot-store.ts";
import type { BotConfig } from "@/engine/models.ts";

interface Metric {
  key: keyof BotConfig;
  label: string;
  hint?: string;
}

const PRIMARY: Metric[] = [
  { key: "skip_if_mcap_above", label: "Skip if mcap above", hint: "Do not chase" },
  { key: "max_open_positions", label: "Max open tickets" },
  { key: "daily_loss_limit_sol", label: "Daily loss limit (SOL)" },
  { key: "slippage_pct", label: "Slippage %" },
  { key: "jito_tip_sol", label: "Jito tip (SOL)", hint: "Attached to live txs, sent via Jito" },
  { key: "dev_sell_ignore_seconds", label: "DEV-sell ignore (s)", hint: "Sells in this window are not an exit" },
  { key: "flat_kill_seconds", label: "Flat/dump sell (s)", hint: "No print or already red → sell 100%" },
  { key: "rent_peel_fraction", label: "Rent peel at +110%", hint: "Sold immediately at the tag" },
  { key: "rent_giveback_pct", label: "Rent giveback", hint: "Trail fires this far under the post-tag high" },
  { key: "rent_cap_multiple", label: "Rent cap (× fill)", hint: "Take remaining initials by this multiple" },
];

const MORE: { title: string; items: Metric[] }[] = [
  {
    title: "Entry",
    items: [
      { key: "expect_fill_mcap_low", label: "Expect fill low" },
      { key: "expect_fill_mcap_high", label: "Expect fill high" },
      { key: "max_buys_per_dev_hours", label: "Dev cooldown (hours)" },
    ],
  },
  {
    title: "Phases",
    items: [
      { key: "ignore_open_seconds", label: "Open-ignore (s)" },
      { key: "shakeout_seconds", label: "Shakeout (s)" },
      { key: "dead_mcap", label: "Dead mcap" },
      { key: "hard_death_from_fill_pct", label: "Hard death from fill" },
      { key: "rent_profit_pct", label: "Rent trigger" },
      { key: "rent_sell_fraction", label: "Rent sell fraction (peel+trail)" },
      { key: "rent_pause_ratio", label: "Rent buy-pause ratio" },
      { key: "no_rent_timeout_seconds", label: "No-rent timeout (s)" },
    ],
  },
  {
    title: "Stub / moonbag",
    items: [
      { key: "trim_3x_frac", label: "3× trim" },
      { key: "trim_5x_frac", label: "5× trim" },
      { key: "trim_10x_frac", label: "10× trim" },
      { key: "moonbag_leftover_sol", label: "Moonbag leftover (SOL)" },
      { key: "wick_wait_seconds", label: "Wick wait (s)" },
      { key: "wick_from_high_pct", label: "Wick from high" },
    ],
  },
];

function fmtValue(value: BotConfig[keyof BotConfig]): string {
  if (typeof value !== "number") return String(value ?? "");
  return value.toFixed(8).replace(/\.?0+$/, "");
}

function MetricInput({ m }: { m: Metric }) {
  const config = useBotStore((s) => s.config);
  const setConfigField = useBotStore((s) => s.setConfigField);
  const value = config[m.key];
  return (
    <Label className="grid gap-1">
      <span className="text-sm text-fg">{m.label}</span>
      <Input
        type="number"
        step="any"
        value={fmtValue(value)}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) setConfigField(m.key, n as BotConfig[typeof m.key]);
        }}
      />
      {m.hint ? <span className="text-xs text-subtle">{m.hint}</span> : null}
    </Label>
  );
}

export function MetricsPanel() {
  const config = useBotStore((s) => s.config);
  const setConfigField = useBotStore((s) => s.setConfigField);
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-medium text-fg">Buy metrics</h2>
      <p className="mt-1 text-sm text-muted text-pretty">
        Fixed ticket. Same size every trade. At +110% peel 20% (rent armed, cannot cancel). The
        rest of initials trails until a fade, −12% giveback, or 3×. Then the sell agent owns the
        stub: clip a ripping 100k+, flatten a 20–50k death, moonbag only a real leftover.
      </p>

      <Label className="mt-4 grid gap-1">
        <span className="text-sm text-fg">Buy exact SOL in</span>
        <Input
          type="number"
          step="any"
          value={fmtValue(config.ticket_sol)}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) setConfigField("ticket_sol", n);
          }}
          className="h-12 font-mono text-lg"
        />
        <span className="text-xs text-subtle">
          Spendable SOL per ticket. Maps to Pump.fun buy_exact_sol_in.
        </span>
      </Label>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {PRIMARY.map((m) => (
          <MetricInput key={m.key} m={m} />
        ))}
      </div>
      <button
        type="button"
        className="mt-4 text-sm text-muted underline-offset-2 hover:text-fg hover:underline"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide phase rules" : "More phase rules"}
      </button>
      {open ? (
        <div className="mt-4 space-y-5">
          {MORE.map((g) => (
            <div key={g.title}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-subtle">{g.title}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {g.items.map((m) => (
                  <MetricInput key={m.key} m={m} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
