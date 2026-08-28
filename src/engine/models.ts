export type Phase =
  | "DETECTED"
  | "OPEN_IGNORE"
  | "SHAKEOUT"
  | "SEEK_RENT"
  | "STUB"
  | "MOONBAG"
  | "CLOSED";

export type IntentKind =
  | "SKIP"
  | "BUY"
  | "SELL_FRACTION"
  | "SELL_ALL"
  | "SET_PHASE"
  | "LOG_ONLY"
  | "PATCH";

export type LogLevel =
  | "SEEN"
  | "SKIP"
  | "BUY"
  | "OPEN"
  | "SHAKE"
  | "RENT"
  | "WICK"
  | "KEEP"
  | "TRIM"
  | "THINK"
  | "DEAD"
  | "SELL"
  | "MOON"
  | "MOONBAG"
  | "ERROR"
  | "INFO"
  | "SMART"
  | "PANIC";

export type TapeRegime = "RIPPING" | "HEALTHY" | "WEAKENING" | "DEAD";
export type SellVenue = "curve" | "pump-amm";

export interface BotConfig {
  dry_run: boolean;
  live: boolean;
  /** Dry-run only. Paper-fill any Pump.fun create with socials. Ignored when live. */
  dry_run_any_socials: boolean;
  /** Live only. Trade any create that passes the other rules, not just trusted DEV wallets. */
  live_any_socials: boolean;
  rpc_url: string;
  ws_url: string;
  ticket_sol: number;
  slippage_pct: number;
  /** Assumed real slippage on paper fills (2–3% typical). Not the live cap. */
  paper_slippage_pct: number;
  jito_tip_sol: number;
  max_open_positions: number;
  max_buys_per_dev_hours: number;
  daily_loss_limit_sol: number;
  expect_fill_mcap_low: number;
  expect_fill_mcap_high: number;
  skip_if_mcap_above: number;
  ignore_open_seconds: number;
  shakeout_seconds: number;
  dev_sell_ignore_seconds: number;
  /** Flatten if still under this multiple after `flat_kill_seconds` (never printed). */
  flat_kill_seconds: number;
  flat_kill_multiple: number;
  dead_mcap: number;
  hard_death_from_fill_pct: number;
  /** Top of the dead band: stuck between `dead_mcap` and this for `flatline_seconds` → sell all. */
  flatline_mcap_max: number;
  flatline_seconds: number;
  rent_profit_pct: number;
  rent_sell_fraction: number;
  rent_peel_fraction: number;
  rent_giveback_pct: number;
  rent_cap_multiple: number;
  rent_pause_ratio: number;
  no_rent_timeout_seconds: number;
  trim_3x_frac: number;
  trim_5x_frac: number;
  trim_10x_frac: number;
  moonbag_realized_multiple: number;
  moonbag_leftover_sol: number;
  hold_poll_seconds: number;
  wick_wait_seconds: number;
  wick_from_high_pct: number;
  buy_dom_ratio: number;
  sell_dom_ratio: number;
  reclaim_bars: number;
  allow_file: string;
  smart_file: string;
  log_file: string;
  key_file: string;
  starting_wallet_sol: number;
}

export interface Socials {
  twitter?: string;
  telegram?: string;
  website?: string;
}

export interface Position {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  fill_ts: number;
  fill_mcap: number;
  fill_sol: number;
  tokens_bought: number;
  tokens_left: number;
  realized_sol: number;
  phase: Phase;
  base_low: number;
  local_high: number;
  shakeout_low: number;
  shakeout_samples: number[];
  /** Legacy name: open-ignore snapshot of DEV balance. Dump baseline is `dev_balance_after_2m`. */
  dev_balance_after_15s: number | null;
  /** DEV token balance at first snapshot after `dev_sell_ignore_seconds`. */
  dev_balance_after_2m: number | null;
  last_dev_balance: number;
  did_rent: boolean;
  /** +110% tagged; remaining initials are trailing. */
  rent_armed: boolean;
  rent_armed_ts: number | null;
  rent_peak_mcap: number;
  rent_peak_buy_sol: number;
  rent_ticks_since_arm: number;
  did_rent_peel: boolean;
  did_trim_3x: boolean;
  did_trim_5x: boolean;
  did_trim_10x: boolean;
  hit_rungs: string[];
  mcap_trail: number[];
  stall_bars: number;
  last_regime: TapeRegime | "";
  last_think: string;
  venue: SellVenue;
  wick_timer_started_ts: number | null;
  wick_from_high: number;
  wick_low: number;
  last_reason: string;
  unique_buyers: number;
  unique_buyers_prev: number;
  buy_sol: number;
  sell_sol: number;
  below_base_bars: number;
  dead_mcap_bars: number;
  /** Set when mcap first enters the dead band (dead_mcap..flatline_mcap_max). Reset when it leaves. */
  flatline_started_ts: number | null;
  socials: Socials;
  last_action: string;
  last_mcap: number;
  /** Set when the position closes (sell-all or fully exhausted). 0 while open. */
  closed_ts: number;
}

export interface TokenCreate {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  ts: number;
  socials: Socials;
  metadata_uri?: string;
  mcap?: number;
}

export interface MarketSnapshot {
  ts: number;
  mint: string;
  mcap: number;
  bonding_curve_progress?: number;
  unique_buyers: number;
  unique_buyers_prev: number;
  buy_sol: number;
  sell_sol: number;
  dev_token_balance: number;
  /** True only when the token is untradeable. Graduation is `graduated`, not this. */
  liquidity_gone: boolean;
  /** Bonding curve complete — sells go through PumpSwap, not a flatten. */
  graduated: boolean;
  smart_net_sell: boolean;
  name?: string;
  symbol?: string;
  creator?: string;
  socials?: Socials;
}

export type StrategyEvent =
  | { type: "CREATE"; create: TokenCreate; replay?: boolean }
  | { type: "SNAPSHOT"; snapshot: MarketSnapshot; replay?: boolean }
  | { type: "MANUAL_SELL_25"; mint: string }
  | { type: "MANUAL_SELL_50"; mint: string }
  | { type: "MANUAL_SELL_ALL"; mint: string }
  | { type: "FORCE_MOONBAG"; mint: string }
  | { type: "PANIC_FLATTEN"; includeMoonbags: boolean };

export interface Intent {
  kind: IntentKind;
  level: LogLevel;
  reason: string;
  msg: string;
  mint?: string;
  creator?: string;
  token?: string;
  fraction?: number;
  phase?: Phase;
  fields?: Partial<Position>;
  mcap?: number;
  fill_mcap?: number;
  multiple?: number;
  realized_sol?: number;
  tokens_left?: number;
  base_low?: number;
  /** Live fill override (SOL spent). */
  fillSol?: number;
  /** Live sell override (SOL received). */
  soldSol?: number;
}

export interface LogEvent {
  ts: string;
  ts_ms: number;
  level: LogLevel;
  mint: string;
  creator: string;
  token: string;
  phase: string;
  msg: string;
  reason: string;
  mcap: number | null;
  fill_mcap: number | null;
  multiple: number | null;
  realized_sol: number | null;
  tokens_left: number | null;
  base_low: number | null;
  dry_run: boolean;
  human: string;
}

export const TOKEN_UNIT = 1_000_000;

export function hasSocials(s: Socials | undefined | null): boolean {
  if (!s) return false;
  return Boolean(s.twitter || s.telegram || s.website);
}

export function leftoverValueSol(pos: Position, mcap: number): number {
  if (!pos.tokens_bought || !pos.fill_mcap || !pos.fill_sol) return 0;
  const frac = pos.tokens_left / pos.tokens_bought;
  return frac * (mcap / pos.fill_mcap) * pos.fill_sol;
}

export function multipleVsFill(pos: Position, mcap: number): number {
  if (!pos.fill_mcap) return 0;
  return mcap / pos.fill_mcap;
}

export function emptyPosition(partial: Partial<Position> & Pick<Position, "mint" | "name" | "symbol" | "creator">): Position {
  return {
    fill_ts: 0,
    fill_mcap: 0,
    fill_sol: 0,
    tokens_bought: 0,
    tokens_left: 0,
    realized_sol: 0,
    phase: "DETECTED",
    base_low: 0,
    local_high: 0,
    shakeout_low: 0,
    shakeout_samples: [],
    dev_balance_after_15s: null,
    dev_balance_after_2m: null,
    last_dev_balance: 0,
    did_rent: false,
    rent_armed: false,
    rent_armed_ts: null,
    rent_peak_mcap: 0,
    rent_peak_buy_sol: 0,
    rent_ticks_since_arm: 0,
    did_rent_peel: false,
    did_trim_3x: false,
    did_trim_5x: false,
    did_trim_10x: false,
    hit_rungs: [],
    mcap_trail: [],
    stall_bars: 0,
    last_regime: "",
    last_think: "",
    venue: "curve",
    wick_timer_started_ts: null,
    wick_from_high: 0,
    wick_low: 0,
    last_reason: "",
    unique_buyers: 0,
    unique_buyers_prev: 0,
    buy_sol: 0,
    sell_sol: 0,
    below_base_bars: 0,
    dead_mcap_bars: 0,
    flatline_started_ts: null,
    socials: {},
    last_action: "",
    last_mcap: 0,
    closed_ts: 0,
    ...partial,
  };
}

export function isOpenPhase(phase: Phase): boolean {
  return (
    phase === "OPEN_IGNORE" ||
    phase === "SHAKEOUT" ||
    phase === "SEEK_RENT" ||
    phase === "STUB" ||
    phase === "MOONBAG"
  );
}

export function isManagedPhase(phase: Phase): boolean {
  return isOpenPhase(phase) || phase === "DETECTED";
}
