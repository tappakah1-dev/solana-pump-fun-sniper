import type { BotConfig } from "./models.ts";
export type { BotConfig };

export const DEFAULT_CONFIG: BotConfig = {
  dry_run: true,
  live: false,
  rpc_url: "https://solana-rpc.publicnode.com",
  ws_url: "",
  ticket_sol: 0.05,
  slippage_pct: 25,
  jito_tip_sol: 0.0002,
  max_open_positions: 3,
  max_buys_per_dev_hours: 8,
  daily_loss_limit_sol: 0.25,
  expect_fill_mcap_low: 4000,
  expect_fill_mcap_high: 8000,
  skip_if_mcap_above: 12000,
  ignore_open_seconds: 15,
  shakeout_seconds: 120,
  dev_sell_ignore_seconds: 120,
  dead_mcap: 3000,
  hard_death_from_fill_pct: 0.55,
  rent_profit_pct: 1.10,
  rent_sell_fraction: 0.5,
  rent_peel_fraction: 0.2,
  rent_giveback_pct: 0.12,
  rent_cap_multiple: 3,
  rent_pause_ratio: 0.5,
  no_rent_timeout_seconds: 600,
  trim_3x_frac: 0.2,
  trim_5x_frac: 0.2,
  trim_10x_frac: 0.25,
  moonbag_realized_multiple: 10,
  moonbag_leftover_sol: 0.2,
  hold_poll_seconds: 15,
  wick_wait_seconds: 75,
  wick_from_high_pct: 0.4,
  buy_dom_ratio: 1.3,
  sell_dom_ratio: 1.3,
  reclaim_bars: 3,
  allow_file: "allow.txt",
  smart_file: "smart.txt",
  log_file: "logs/events.jsonl",
  key_file: "",
  starting_wallet_sol: 2.0,
};

export const CONFIG_META: {
  key: keyof BotConfig;
  label: string;
  group: "mode" | "size" | "entry" | "phases" | "stub" | "files";
  kind: "bool" | "number" | "string";
  hint?: string;
}[] = [
  { key: "dry_run", label: "Dry run", group: "mode", kind: "bool", hint: "Full logic, no real transactions" },
  { key: "live", label: "Live flag", group: "mode", kind: "bool", hint: "Also requires typing I UNDERSTAND" },
  { key: "rpc_url", label: "RPC URL", group: "mode", kind: "string", hint: "Fallback only. HELIUS_API_KEY on Vercel wins." },
  { key: "ws_url", label: "WebSocket URL", group: "mode", kind: "string", hint: "Optional. Creates are polled from Pump.fun HTTP." },
  { key: "key_file", label: "Key file path", group: "mode", kind: "string", hint: "Never logged. Prefer BOT_PRIVATE_KEY env." },
  { key: "starting_wallet_sol", label: "Simulated wallet SOL", group: "mode", kind: "number" },
  { key: "ticket_sol", label: "Buy exact SOL in", group: "size", kind: "number", hint: "buy_exact_sol_in spendable SOL. Same size every trade." },
  { key: "slippage_pct", label: "Slippage %", group: "size", kind: "number", hint: "Live swap slippage cap" },
  { key: "jito_tip_sol", label: "Jito tip (SOL)", group: "size", kind: "number", hint: "Tip attached to live txs and sent via Jito." },
  { key: "max_open_positions", label: "Max open positions", group: "size", kind: "number" },
  { key: "max_buys_per_dev_hours", label: "Max buys per dev (hours)", group: "size", kind: "number" },
  { key: "daily_loss_limit_sol", label: "Daily loss limit (SOL)", group: "size", kind: "number" },
  { key: "expect_fill_mcap_low", label: "Expect fill mcap low", group: "entry", kind: "number" },
  { key: "expect_fill_mcap_high", label: "Expect fill mcap high", group: "entry", kind: "number" },
  { key: "skip_if_mcap_above", label: "Skip if mcap above", group: "entry", kind: "number" },
  { key: "ignore_open_seconds", label: "Open-ignore seconds", group: "phases", kind: "number" },
  { key: "shakeout_seconds", label: "Shakeout seconds", group: "phases", kind: "number" },
  { key: "dev_sell_ignore_seconds", label: "DEV-sell ignore (s)", group: "phases", kind: "number", hint: "DEV sells in this window are not an exit, even many of them." },
  { key: "dead_mcap", label: "Dead mcap", group: "phases", kind: "number" },
  { key: "hard_death_from_fill_pct", label: "Hard death from fill", group: "phases", kind: "number" },
  { key: "rent_profit_pct", label: "Rent profit pct", group: "phases", kind: "number", hint: "Tag at 1+this (1.10 = 2.1×). Arms trailing rent, cannot cancel." },
  { key: "rent_sell_fraction", label: "Rent sell fraction", group: "phases", kind: "number", hint: "Total initials vs original bag (peel + trail)." },
  { key: "rent_peel_fraction", label: "Rent peel at tag", group: "phases", kind: "number", hint: "Sold immediately at +110%. Rest trails." },
  { key: "rent_giveback_pct", label: "Rent giveback", group: "phases", kind: "number", hint: "Trail fires if mcap drops this far from the post-tag high." },
  { key: "rent_cap_multiple", label: "Rent cap multiple", group: "phases", kind: "number", hint: "Take remaining initials by this multiple even if still ripping." },
  { key: "rent_pause_ratio", label: "Rent buy-pause ratio", group: "phases", kind: "number", hint: "Trail fires when buy SOL < this × peak buy since tag." },
  { key: "no_rent_timeout_seconds", label: "No-rent timeout (s)", group: "phases", kind: "number" },
  { key: "trim_3x_frac", label: "3× trim fraction", group: "stub", kind: "number" },
  { key: "trim_5x_frac", label: "5× trim fraction", group: "stub", kind: "number" },
  { key: "trim_10x_frac", label: "10× trim fraction", group: "stub", kind: "number" },
  { key: "moonbag_realized_multiple", label: "Moonbag realized multiple", group: "stub", kind: "number" },
  { key: "moonbag_leftover_sol", label: "Moonbag leftover SOL", group: "stub", kind: "number" },
  { key: "hold_poll_seconds", label: "Hold poll seconds", group: "stub", kind: "number" },
  { key: "wick_wait_seconds", label: "Wick wait seconds", group: "stub", kind: "number" },
  { key: "wick_from_high_pct", label: "Wick from high pct", group: "stub", kind: "number" },
  { key: "buy_dom_ratio", label: "Buy dominance ratio", group: "stub", kind: "number" },
  { key: "sell_dom_ratio", label: "Sell dominance ratio", group: "stub", kind: "number" },
  { key: "reclaim_bars", label: "Reclaim bars", group: "stub", kind: "number" },
  { key: "allow_file", label: "Allow file", group: "files", kind: "string" },
  { key: "smart_file", label: "Smart file", group: "files", kind: "string" },
  { key: "log_file", label: "Log file", group: "files", kind: "string" },
];

export function parseYamlConfig(text: string): Partial<BotConfig> {
  const out: Partial<BotConfig> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim() as keyof BotConfig;
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!(key in DEFAULT_CONFIG)) continue;
    const def = DEFAULT_CONFIG[key];
    if (typeof def === "boolean") {
      (out as Record<string, unknown>)[key] = value === "true" || value === "yes" || value === "1";
    } else if (typeof def === "number") {
      const n = Number(value);
      if (Number.isFinite(n)) (out as Record<string, unknown>)[key] = n;
    } else {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

export function stringifyYamlConfig(cfg: BotConfig): string {
  const lines = [
    "# Allow-Exec — Pump.fun allow-list execution bot",
    "# Dry-run is the default. Live requires live: true AND typing I UNDERSTAND.",
    "",
  ];
  for (const meta of CONFIG_META) {
    const v = cfg[meta.key];
    lines.push(`${meta.key}: ${v === "" ? '""' : String(v)}`);
  }
  return lines.join("\n") + "\n";
}

export function mergeConfig(partial?: Partial<BotConfig>): BotConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}

const STORAGE_KEY = "allow-exec-config-v1";

export function loadPersistedConfig(): BotConfig {
  if (typeof localStorage === "undefined") return { ...DEFAULT_CONFIG };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<BotConfig>;
    return mergeConfig(parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function persistConfig(cfg: BotConfig) {
  if (typeof localStorage === "undefined") return;
  const redacted = { ...cfg };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(redacted));
}
