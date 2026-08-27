import type {
  BotConfig,
  Intent,
  MarketSnapshot,
  Position,
  Socials,
  StrategyEvent,
  TokenCreate,
} from "./models.ts";
import { hasSocials, leftoverValueSol, multipleVsFill } from "./models.ts";
import { creatorOnCooldown, dailyLossHit, openPositionCount, type RiskState } from "./risk.ts";
import { shortAddr } from "../lib/utils.ts";
import { decideStubExit, moonbagReady, thinkIntent } from "./exit-agent.ts";
import { decideRent } from "./rent-agent.ts";

export interface DecideInput {
  now: number;
  event: StrategyEvent;
  config: BotConfig;
  allowHas: (creator: string) => boolean;
  position: Position | null;
  allPositions: Position[];
  risk: RiskState;
  marketAlive: boolean;
  /** Replay and manual overrides run even when the live listener is stopped. */
  allowUnstarted: boolean;
  isReplay: boolean;
}

function log(
  partial: Omit<Intent, "kind"> & { kind?: Intent["kind"] },
): Intent {
  return { kind: "LOG_ONLY", ...partial };
}

function socialFlag(s: Socials | undefined): string {
  return hasSocials(s) ? "yes" : "no";
}

function ageSec(pos: Position, now: number): number {
  if (!pos.fill_ts) return 0;
  return (now - pos.fill_ts) / 1000;
}

function uniqueDeclining(snap: MarketSnapshot, pos: Position): boolean {
  const prev = snap.unique_buyers_prev || pos.unique_buyers_prev || pos.unique_buyers;
  return snap.unique_buyers < prev;
}

function patchFromSnap(pos: Position, snap: MarketSnapshot): Partial<Position> {
  const local_high = Math.max(pos.local_high, snap.mcap);
  const venue = snap.graduated ? "pump-amm" : pos.venue;
  const trail = [...(pos.mcap_trail ?? []), snap.mcap].slice(-8);
  const stall = snap.mcap < local_high * 0.98 ? (pos.stall_bars || 0) + 1 : 0;
  return {
    local_high,
    last_dev_balance: snap.dev_token_balance,
    unique_buyers_prev: pos.unique_buyers || snap.unique_buyers_prev,
    unique_buyers: snap.unique_buyers,
    buy_sol: snap.buy_sol,
    sell_sol: snap.sell_sol,
    venue,
    mcap_trail: trail,
    stall_bars: stall,
    last_mcap: snap.mcap,
  };
}

function annotate(intent: Intent, pos: Position, snap?: MarketSnapshot): Intent {
  return {
    ...intent,
    mint: intent.mint ?? pos.mint,
    creator: intent.creator ?? pos.creator,
    token: intent.token ?? pos.symbol ?? pos.name,
    phase: intent.phase ?? pos.phase,
    mcap: intent.mcap ?? snap?.mcap,
    fill_mcap: intent.fill_mcap ?? pos.fill_mcap,
    base_low: intent.base_low ?? pos.base_low,
    realized_sol: intent.realized_sol ?? pos.realized_sol,
    tokens_left: intent.tokens_left ?? pos.tokens_left,
  };
}

/**
 * DEV sells in the first `dev_sell_ignore_seconds` (default 2 min) are the open,
 * not an exit — even ten of them. After that window we snapshot remaining DEV
 * balance; any further drop vs that baseline is flatten.
 */
function maybeDevSell(pos: Position, snap: MarketSnapshot, input: DecideInput): Intent[] | null {
  const cfg = input.config;
  const ignoreSec = cfg.dev_sell_ignore_seconds ?? 120;
  const age = ageSec(pos, input.now);
  const dumped =
    pos.last_dev_balance > 0 && snap.dev_token_balance < pos.last_dev_balance * 0.98;
  const fields = patchFromSnap(pos, snap);

  if (age < ignoreSec) {
    if (!dumped) return null;
    return [
      annotate(
        log({
          level: "OPEN",
          reason: age < cfg.ignore_open_seconds ? "first_dev_sell_ignored" : "dev_sell_ignored",
          msg: `DEV sell ignored t+${Math.round(age)}s < ${ignoreSec}s (not an exit)`,
        }),
        pos,
        snap,
      ),
      annotate(
        {
          kind: "PATCH",
          level: "OPEN",
          reason: "dev_sell_ignore_tick",
          msg: "dev_sell_ignore",
          fields: { ...fields, last_dev_balance: snap.dev_token_balance },
        },
        pos,
        snap,
      ),
    ];
  }

  if (pos.dev_balance_after_2m == null) {
    return [
      annotate(
        {
          kind: "PATCH",
          level: "OPEN",
          reason: "dev_baseline_2m",
          msg: `DEV baseline set at ${ignoreSec}s bal=${snap.dev_token_balance}`,
          fields: {
            ...fields,
            dev_balance_after_2m: snap.dev_token_balance,
            last_dev_balance: snap.dev_token_balance,
          },
        },
        pos,
        snap,
      ),
    ];
  }

  if (snap.dev_token_balance < pos.dev_balance_after_2m * 0.98) {
    return [
      annotate(
        {
          kind: "SELL_ALL",
          level: "DEAD",
          reason: "second_dev_sell",
          msg: `DEAD DEV sell after ${ignoreSec}s bal=${snap.dev_token_balance} baseline=${pos.dev_balance_after_2m} sold=100%`,
          fields,
        },
        pos,
        snap,
      ),
    ];
  }
  return null;
}

function paperAnySocials(cfg: BotConfig): boolean {
  return Boolean(cfg.dry_run && cfg.dry_run_any_socials && !cfg.live);
}

function entrySkip(
  create: TokenCreate,
  cfg: BotConfig,
  input: DecideInput,
  mcap: number | undefined,
): Intent | null {
  const creator = create.creator;
  const token = create.symbol || create.name;
  const onList = input.allowHas(creator);
  const paperOpen = paperAnySocials(cfg);
  if (!onList && !paperOpen) {
    return {
      kind: "SKIP",
      level: "SKIP",
      reason: "not_on_allowlist",
      msg: `${token || shortAddr(create.mint)} not_on_allowlist`,
      mint: create.mint,
      creator,
      token,
      mcap,
    };
  }
  if (!hasSocials(create.socials)) {
    return {
      kind: "SKIP",
      level: "SKIP",
      reason: "no_socials",
      msg: `${token} no_socials`,
      mint: create.mint,
      creator,
      token,
      mcap,
    };
  }
  if (input.position && input.position.phase !== "DETECTED" && input.position.phase !== "CLOSED") {
    return {
      kind: "SKIP",
      level: "SKIP",
      reason: "already_in",
      msg: `${token} one_ticket_only already_in`,
      mint: create.mint,
      creator,
      token,
      mcap,
    };
  }
  if (openPositionCount(input.allPositions) >= cfg.max_open_positions) {
    return {
      kind: "SKIP",
      level: "SKIP",
      reason: "max_open_positions",
      msg: `${token} max_open_positions=${cfg.max_open_positions}`,
      mint: create.mint,
      creator,
      token,
      mcap,
    };
  }
  if (!input.isReplay && dailyLossHit(input.risk, cfg)) {
    return {
      kind: "SKIP",
      level: "SKIP",
      reason: "daily_loss_limit",
      msg: `${token} daily_loss_limit pnl=${input.risk.dailyPnl.toFixed(3)}`,
      mint: create.mint,
      creator,
      token,
      mcap,
    };
  }
  if (!input.isReplay && creatorOnCooldown(input.risk, creator, input.now, cfg)) {
    return {
      kind: "SKIP",
      level: "SKIP",
      reason: "dev_cooldown",
      msg: `${token} dev_cooldown ${cfg.max_buys_per_dev_hours}h`,
      mint: create.mint,
      creator,
      token,
      mcap,
    };
  }
  if (input.risk.buyAttempted.has(create.mint)) {
    return {
      kind: "SKIP",
      level: "SKIP",
      reason: "buy_retry_exhausted",
      msg: `${token} buy_retry_exhausted`,
      mint: create.mint,
      creator,
      token,
      mcap,
    };
  }
  if (!input.marketAlive) {
    return {
      kind: "SKIP",
      level: "SKIP",
      reason: "market_data_dead",
      msg: `${token} market_data_dead no_new_buys`,
      mint: create.mint,
      creator,
      token,
      mcap,
    };
  }
  if (mcap != null && mcap > cfg.skip_if_mcap_above) {
    return {
      kind: "SKIP",
      level: "SKIP",
      reason: "chase_mcap",
      msg: `${token} chase_mcap=${mcap} skip_if_mcap_above=${cfg.skip_if_mcap_above}`,
      mint: create.mint,
      creator,
      token,
      mcap,
    };
  }
  return null;
}

function maybeBuy(create: TokenCreate, mcap: number, input: DecideInput): Intent[] {
  const skip = entrySkip(create, input.config, input, mcap);
  if (skip) return [skip];
  const token = create.symbol || create.name;
  const onList = input.allowHas(create.creator);
  const paper = paperAnySocials(input.config) && !onList;
  return [
    {
      kind: "BUY",
      level: "BUY",
      reason: paper ? "paper_any_socials" : "allow_fill",
      msg: `${token} ${input.config.ticket_sol} SOL fill_mcap=${Math.round(mcap)} dry=${input.config.dry_run}${paper ? " paper_any_socials" : ""}`,
      mint: create.mint,
      creator: create.creator,
      token,
      mcap,
      fill_mcap: mcap,
      phase: "OPEN_IGNORE",
      fields: { socials: create.socials, name: create.name, symbol: create.symbol, creator: create.creator },
    },
  ];
}

function handleCreate(create: TokenCreate, input: DecideInput): Intent[] {
  const token = create.symbol || create.name;
  const allow = input.allowHas(create.creator);
  const paper = paperAnySocials(input.config);
  const seen: Intent = log({
    level: "SEEN",
    reason: "create",
    msg: `${token} creator=${shortAddr(create.creator)} allow=${allow ? "yes" : paper ? "paper" : "no"} socials=${socialFlag(create.socials)} mcap=${create.mcap ?? "n/a"}`,
    mint: create.mint,
    creator: create.creator,
    token,
    mcap: create.mcap,
    phase: "DETECTED",
  });

  const skip = entrySkip(create, input.config, input, create.mcap);
  if (skip && skip.reason === "not_on_allowlist") return [seen, skip];
  if (skip && skip.reason === "no_socials") return [seen, skip];

  const detect: Intent = {
    kind: "SET_PHASE",
    level: "SEEN",
    reason: "detected",
    msg: `${token} detected`,
    mint: create.mint,
    creator: create.creator,
    token,
    phase: "DETECTED",
    mcap: create.mcap,
    fields: {
      mint: create.mint,
      name: create.name,
      symbol: create.symbol,
      creator: create.creator,
      socials: create.socials,
      last_reason: "detected",
      last_action: "DETECTED",
    },
  };

  if (skip) return [seen, skip];
  return [seen, detect];
}

function handleDetectedBuy(pos: Position, snap: MarketSnapshot, input: DecideInput): Intent[] {
  const create: TokenCreate = {
    mint: pos.mint,
    creator: pos.creator,
    name: pos.name,
    symbol: pos.symbol,
    ts: snap.ts,
    socials: snap.socials ?? pos.socials,
    mcap: snap.mcap,
  };
  return maybeBuy(create, snap.mcap, input);
}

function maybeFlatKill(pos: Position, snap: MarketSnapshot, input: DecideInput): Intent[] | null {
  const cfg = input.config;
  if (pos.did_rent || pos.rent_armed) return null;
  const age = ageSec(pos, input.now);
  if (age < cfg.flat_kill_seconds) return null;
  // Only the first ~15s after the timer. Replay/time-jumps past this keep shakeout.
  if (age > cfg.flat_kill_seconds + 15) return null;
  if (!pos.fill_mcap) return null;
  const peak = Math.max(pos.local_high, snap.mcap);
  if (peak > pos.fill_mcap * cfg.flat_kill_multiple) return null;
  const nowMult = snap.mcap / pos.fill_mcap;
  const reason = nowMult < 1 ? "dump_kill" : "flat_kill";
  const msg =
    nowMult < 1
      ? `DEAD dump_kill t+${Math.round(age)}s mcap=${Math.round(snap.mcap)} fill=${Math.round(pos.fill_mcap)} sold=100%`
      : `DEAD flat_kill t+${Math.round(age)}s no print above ${cfg.flat_kill_multiple}× sold=100%`;
  return [
    annotate(
      {
        kind: "SELL_ALL",
        level: "DEAD",
        reason,
        msg,
        fields: patchFromSnap(pos, snap),
      },
      pos,
      snap,
    ),
  ];
}

/**
 * Dead-band flatline: mcap stuck between `dead_mcap` and `flatline_mcap_max`
 * for `flatline_seconds` → sell 100%. The timer starts on first band touch
 * and resets as soon as mcap escapes above the band (below it, `dead_mcap`
 * already kills). Rented positions are handled by the trail, never this.
 */
function maybeFlatline(
  pos: Position,
  snap: MarketSnapshot,
  input: DecideInput,
  baseFields: Partial<Position>,
): Intent[] | null {
  const cfg = input.config;
  if (pos.did_rent || pos.rent_armed) return null;
  const inBand = snap.mcap > cfg.dead_mcap && snap.mcap <= cfg.flatline_mcap_max;

  if (!inBand) {
    if (pos.flatline_started_ts == null) return null;
    return [
      annotate(
        {
          kind: "PATCH",
          level: "INFO",
          reason: "flatline_reset",
          msg: `flatline reset mcap=${Math.round(snap.mcap)} left the dead band`,
          fields: { ...baseFields, flatline_started_ts: null },
        },
        pos,
        snap,
      ),
    ];
  }

  const started = pos.flatline_started_ts ?? input.now;
  const secs = (input.now - started) / 1000;
  if (pos.flatline_started_ts == null) {
    return [
      annotate(
        log({
          level: "INFO",
          reason: "flatline_start",
          msg: `flatline mcap=${Math.round(snap.mcap)} dead band ${cfg.dead_mcap}–${cfg.flatline_mcap_max} sell_all_in=${cfg.flatline_seconds}s`,
        }),
        pos,
        snap,
      ),
      annotate(
        {
          kind: "PATCH",
          level: "INFO",
          reason: "flatline_tick",
          msg: "flatline",
          fields: { ...baseFields, flatline_started_ts: started },
        },
        pos,
        snap,
      ),
    ];
  }

  if (secs < cfg.flatline_seconds) {
    return [
      annotate(
        {
          kind: "PATCH",
          level: "INFO",
          reason: "flatline_tick",
          msg: `flatline ${Math.round(secs)}s/${cfg.flatline_seconds}s`,
          fields: baseFields,
        },
        pos,
        snap,
      ),
    ];
  }

  return [
    annotate(
      {
        kind: "SELL_ALL",
        level: "DEAD",
        reason: "flatline_stuck",
        msg: `DEAD flatline mcap=${Math.round(snap.mcap)} stuck=${Math.round(secs)}s in dead band sold=100%`,
        fields: { ...baseFields, flatline_started_ts: null },
      },
      pos,
      snap,
    ),
  ];
}

function handleOpenIgnore(pos: Position, snap: MarketSnapshot, input: DecideInput): Intent[] {
  const flat = maybeFlatKill(pos, snap, input);
  if (flat) return flat;
  const cfg = input.config;
  const intents: Intent[] = [];
  const fields = patchFromSnap(pos, snap);
  const firstSell =
    pos.last_dev_balance > 0 && snap.dev_token_balance < pos.last_dev_balance * 0.98;
  if (firstSell) {
    intents.push(
      annotate(
        log({
          level: "OPEN",
          reason: "first_dev_sell_ignored",
          msg: `first_dev_sell ignored t+${Math.round(ageSec(pos, input.now))}s < ${cfg.dev_sell_ignore_seconds}s`,
        }),
        pos,
        snap,
      ),
    );
  }
  const age = ageSec(pos, input.now);
  if (age >= cfg.ignore_open_seconds) {
    intents.push(
      annotate(
        {
          kind: "SET_PHASE",
          level: "OPEN",
          reason: "baseline_set",
          msg: `OPEN first_dev_sell ignored baseline_set_at_${cfg.ignore_open_seconds}s`,
          phase: "SHAKEOUT",
          fields: {
            ...fields,
            phase: "SHAKEOUT",
            dev_balance_after_15s: snap.dev_token_balance,
            last_dev_balance: snap.dev_token_balance,
            shakeout_low: snap.mcap,
            shakeout_samples: [snap.mcap],
            last_reason: "baseline_set",
            last_action: "SHAKEOUT",
          },
        },
        pos,
        snap,
      ),
    );
    return intents;
  }
  intents.push({
    kind: "PATCH",
    level: "OPEN",
    reason: "open_ignore_tick",
    msg: "open_ignore",
    mint: pos.mint,
    fields,
  });
  return intents;
}

function robustLow(samples: number[], fallback: number): number {
  const xs = samples.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!xs.length) return fallback;
  const idx = Math.min(xs.length - 1, Math.max(0, Math.floor(xs.length * 0.2)));
  return xs[idx] ?? fallback;
}

function handleShakeout(pos: Position, snap: MarketSnapshot, input: DecideInput): Intent[] {
  const flat = maybeFlatKill(pos, snap, input);
  if (flat) return flat;
  const cfg = input.config;
  const samples = [...pos.shakeout_samples, snap.mcap];
  const shakeout_low = pos.shakeout_low ? Math.min(pos.shakeout_low, snap.mcap) : snap.mcap;
  const fields = { ...patchFromSnap(pos, snap), shakeout_low, shakeout_samples: samples };
  const deadBars = snap.mcap <= cfg.dead_mcap ? pos.dead_mcap_bars + 1 : 0;

  const dev = maybeDevSell(pos, snap, input);
  if (dev?.some((i) => i.kind === "SELL_ALL")) return dev;
  const extra = (dev ?? []).filter((i) => i.kind !== "SELL_ALL");

  if (snap.mcap <= cfg.dead_mcap) {
    return [
      ...extra,
      annotate(
        {
          kind: "SELL_ALL",
          level: "DEAD",
          reason: "shakeout_dead_mcap",
          msg: `DEAD shakeout mcap=${Math.round(snap.mcap)} dead_mcap=${cfg.dead_mcap} sold=100%`,
          fields: { ...fields, dead_mcap_bars: deadBars },
        },
        pos,
        snap,
      ),
    ];
  }
  if (snap.mcap < pos.fill_mcap * (1 - cfg.hard_death_from_fill_pct)) {
    return [
      ...extra,
      annotate(
        {
          kind: "SELL_ALL",
          level: "DEAD",
          reason: "hard_death_from_fill",
          msg: `DEAD hard_death mcap=${Math.round(snap.mcap)} fill=${Math.round(pos.fill_mcap)} sold=100%`,
          fields,
        },
        pos,
        snap,
      ),
    ];
  }

  const flatline = maybeFlatline(pos, snap, input, { ...fields, dead_mcap_bars: deadBars });
  if (flatline) return [...extra, ...flatline];

  const age = ageSec(pos, input.now);
  const shakeoutEnd = cfg.ignore_open_seconds + cfg.shakeout_seconds;

  // Rent tag printed during shakeout — the open is over, so the desk takes
  // profit now instead of waiting out the shakeout clock and watching the
  // move fade. Next tick decideRent peels / trails / caps as usual.
  const rentTag = pos.fill_mcap > 0 && snap.mcap >= pos.fill_mcap * (1 + cfg.rent_profit_pct);
  if (rentTag) {
    const base_low = robustLow(samples, shakeout_low);
    return [
      ...extra,
      annotate(
        {
          kind: "SET_PHASE",
          level: "SHAKE",
          reason: "rent_tag_in_shakeout",
          msg: `SHAKE rent tag ${(snap.mcap / pos.fill_mcap).toFixed(2)}× in shakeout → SEEK_RENT base_low=${Math.round(base_low)}`,
          phase: "SEEK_RENT",
          base_low,
          fields: {
            ...fields,
            phase: "SEEK_RENT",
            base_low,
            last_reason: "rent_tag_in_shakeout",
            last_action: "SEEK_RENT",
          },
        },
        pos,
        snap,
      ),
    ];
  }

  if (age >= shakeoutEnd) {
    const base_low = robustLow(samples, shakeout_low);
    return [
      ...extra,
      annotate(
        {
          kind: "SET_PHASE",
          level: "SHAKE",
          reason: "shakeout_complete",
          msg: `SHAKE low=${Math.round(shakeout_low)} base_low=${Math.round(base_low)}`,
          phase: "SEEK_RENT",
          base_low,
          fields: {
            ...fields,
            phase: "SEEK_RENT",
            base_low,
            last_reason: "shakeout_complete",
            last_action: "SEEK_RENT",
          },
        },
        pos,
        snap,
      ),
    ];
  }
  if (extra.length) {
    extra.push({
      kind: "PATCH",
      level: "SHAKE",
      reason: "shakeout_tick",
      msg: "shakeout",
      mint: pos.mint,
      fields: { ...fields, dead_mcap_bars: deadBars },
    });
    return extra;
  }
  return [
    {
      kind: "PATCH",
      level: "SHAKE",
      reason: "shakeout_tick",
      msg: "shakeout",
      mint: pos.mint,
      fields: { ...fields, dead_mcap_bars: deadBars },
    },
  ];
}

function handleSeekRent(pos: Position, snap: MarketSnapshot, input: DecideInput): Intent[] {
  const cfg = input.config;
  const fields: Partial<Position> = patchFromSnap(pos, snap);
  const age = ageSec(pos, input.now);
  const armed = Boolean(pos.rent_armed || pos.did_rent_peel);
  const working: Position = { ...pos, ...fields };

  const dev = maybeDevSell(pos, snap, input);
  if (dev?.some((i) => i.kind === "SELL_ALL")) return dev;
  const extra = (dev ?? []).filter((i) => i.kind !== "SELL_ALL");

  const flatline = maybeFlatline(pos, snap, input, fields);
  if (flatline) return [...extra, ...flatline];

  if (!armed && age >= cfg.no_rent_timeout_seconds) {
    return [
      ...extra,
      annotate(
        {
          kind: "SELL_ALL",
          level: "DEAD",
          reason: "DEAD_NO_RENT",
          msg: `DEAD NO_RENT timeout=${cfg.no_rent_timeout_seconds}s sold=100%`,
          fields,
        },
        pos,
        snap,
      ),
    ];
  }

  const decision = decideRent(working, snap, cfg);
  const merged = { ...fields, ...decision.fields };

  if (decision.action.type === "PEEL") {
    return [
      ...extra,
      annotate(
        {
          kind: "SELL_FRACTION",
          level: "RENT",
          reason: "rent_peel",
          fraction: decision.action.fraction,
          msg: decision.think,
          phase: "SEEK_RENT",
          multiple: multipleVsFill(pos, snap.mcap),
          fields: merged,
        },
        pos,
        snap,
      ),
    ];
  }

  if (decision.action.type === "TRAIL") {
    return [
      ...extra,
      annotate(
        {
          kind: "SELL_FRACTION",
          level: "RENT",
          reason: "rent_110",
          fraction: decision.action.fraction,
          msg: decision.think,
          phase: "STUB",
          multiple: multipleVsFill(pos, snap.mcap),
          fields: merged,
        },
        pos,
        snap,
      ),
    ];
  }

  const thinkChanged = decision.think && decision.think !== pos.last_think;
  const holdLog =
    thinkChanged && decision.why !== "wait"
      ? [
          annotate(
            {
              kind: "LOG_ONLY",
              level: "THINK",
              reason: decision.reason,
              msg: decision.think,
            },
            pos,
            snap,
          ),
        ]
      : [];

  if (extra.length) {
    extra.push({
      kind: "PATCH",
      level: "INFO",
      reason: decision.reason,
      msg: decision.think || "seek_rent",
      mint: pos.mint,
      fields: merged,
    });
    return [...holdLog, ...extra];
  }
  return [
    ...holdLog,
    {
      kind: "PATCH",
      level: "INFO",
      reason: decision.reason,
      msg: decision.think || "seek_rent",
      mint: pos.mint,
      fields: merged,
    },
  ];
}

function handleStub(pos: Position, snap: MarketSnapshot, input: DecideInput): Intent[] {
  const cfg = input.config;
  const intents: Intent[] = [];
  let fields: Partial<Position> = patchFromSnap(pos, snap);

  const dev = maybeDevSell(pos, snap, input);
  if (dev?.some((i) => i.kind === "SELL_ALL")) return dev;
  if (dev) intents.push(...dev.filter((i) => i.kind !== "SELL_ALL"));

  let below = pos.below_base_bars;
  if (pos.base_low > 0 && snap.mcap < pos.base_low) below += 1;
  else below = 0;
  fields = { ...fields, below_base_bars: below };

  const dropFromHigh =
    pos.local_high > 0 ? (pos.local_high - snap.mcap) / pos.local_high : 0;
  let wickStarted = pos.wick_timer_started_ts;
  let wickHigh = pos.wick_from_high;
  let wickLow = pos.wick_low;

  if (wickStarted == null && dropFromHigh >= cfg.wick_from_high_pct) {
    wickStarted = input.now;
    wickHigh = pos.local_high;
    wickLow = snap.mcap;
    fields = {
      ...fields,
      wick_timer_started_ts: wickStarted,
      wick_from_high: wickHigh,
      wick_low: wickLow,
    };
    intents.push(
      annotate(
        log({
          level: "WICK",
          reason: "wick_wait",
          msg: `${(-dropFromHigh).toFixed(2)} from high wait=${cfg.wick_wait_seconds}s`,
        }),
        pos,
        snap,
      ),
    );
  } else if (wickStarted != null) {
    wickLow = wickLow ? Math.min(wickLow, snap.mcap) : snap.mcap;
    fields = { ...fields, wick_low: wickLow };
    const waited = (input.now - wickStarted) / 1000;
    if (waited >= cfg.wick_wait_seconds) {
      const mid = (wickHigh + wickLow) / 2;
      const reclaimed = snap.mcap >= mid || (pos.base_low > 0 && snap.mcap >= pos.base_low);
      const dump = snap.sell_sol >= cfg.sell_dom_ratio * Math.max(snap.buy_sol, 0.0001);
      if (reclaimed && !dump) {
        intents.push(
          annotate(
            log({
              level: "KEEP",
              reason: "wick_reclaim",
              msg: `reclaimed base_low=${Math.round(pos.base_low)} mid=${Math.round(mid)}`,
              base_low: pos.base_low,
            }),
            pos,
            snap,
          ),
        );
        fields = {
          ...fields,
          wick_timer_started_ts: null,
          wick_from_high: 0,
          wick_low: 0,
          last_reason: "wick_reclaim",
          last_action: "KEEP",
          local_high: Math.max(snap.mcap, pos.base_low),
        };
        wickStarted = null;
      } else if (snap.mcap < pos.base_low) {
        return [
          ...intents,
          annotate(
            {
              kind: "SELL_ALL",
              level: "DEAD",
              reason: "wick_no_reclaim",
              msg: `DEAD wick_no_reclaim mcap=${Math.round(snap.mcap)} base_low=${Math.round(pos.base_low)} sold=100%`,
              fields: { ...fields, wick_timer_started_ts: null },
            },
            pos,
            snap,
          ),
        ];
      } else {
        fields = { ...fields, wick_timer_started_ts: null, last_action: "KEEP" };
        wickStarted = null;
      }
    }
  }

  if (wickStarted == null && below >= cfg.reclaim_bars) {
    return [
      ...intents,
      annotate(
        {
          kind: "SELL_ALL",
          level: "DEAD",
          reason: "base_low_break",
          msg: `DEAD base_low broken bars=${below} mcap=${Math.round(snap.mcap)} sold=100%`,
          fields,
        },
        pos,
        snap,
      ),
    ];
  }

  if (snap.smart_net_sell) {
    intents.push(
      annotate(
        log({
          level: "SMART",
          reason: "smart_net_sell",
          msg: "smart.txt net sell (exit hint)",
        }),
        pos,
        snap,
      ),
    );
  }

  const keep = wickStarted == null;
  const working: Position = { ...pos, ...fields };
  const decision = decideStubExit(working, snap, cfg, { keep });
  fields = { ...fields, ...decision.fields };

  const lastThink = pos.last_think;
  const shouldLogThink =
    decision.action.type !== "HOLD" ||
    decision.think !== lastThink ||
    decision.regime !== pos.last_regime;
  if (shouldLogThink && decision.think) {
    intents.push(annotate(thinkIntent(pos, decision, snap), pos, snap));
  }

  if (decision.action.type === "SELL_ALL") {
    intents.push(
      annotate(
        {
          kind: "SELL_ALL",
          level: "DEAD",
          reason: decision.reason,
          msg: `${decision.think} sold=100%`,
          fields,
        },
        pos,
        snap,
      ),
    );
    return intents;
  }

  if (decision.action.type === "MOONBAG") {
    intents.push(
      annotate(
        {
          kind: "SET_PHASE",
          level: "MOON",
          reason: "moonbag_armed",
          msg: decision.think,
          phase: "MOONBAG",
          fields: { ...fields, phase: "MOONBAG", last_reason: "moonbag_armed", last_action: "MOONBAG" },
        },
        pos,
        snap,
      ),
    );
    return intents;
  }

  if (decision.action.type === "CLIP") {
    const fraction = decision.action.fraction;
    intents.push(
      annotate(
        {
          kind: "SELL_FRACTION",
          level: "TRIM",
          reason: decision.reason,
          fraction,
          msg: decision.think,
          multiple: multipleVsFill(pos, snap.mcap),
          fields: { ...fields, last_reason: decision.reason, last_action: `TRIM ${decision.action.rung}` },
        },
        pos,
        snap,
      ),
    );
    return intents;
  }

  intents.push({
    kind: "PATCH",
    level: "INFO",
    reason: "stub_tick",
    msg: "stub",
    mint: pos.mint,
    fields,
  });
  return intents;
}

function handleMoonbag(pos: Position, snap: MarketSnapshot, input: DecideInput): Intent[] {
  const fields = patchFromSnap(pos, snap);
  const dev = maybeDevSell(pos, snap, input);
  if (dev?.some((i) => i.kind === "SELL_ALL")) return dev;
  return [
    ...(dev ?? []),
    {
      kind: "PATCH",
      level: "MOON",
      reason: "moonbag_tick",
      msg: pos.last_think || "moonbag hold (no engine)",
      mint: pos.mint,
      fields,
    },
  ];
}

function handleSnapshot(snap: MarketSnapshot, input: DecideInput): Intent[] {
  const pos = input.position;
  if (!pos || pos.phase === "CLOSED") {
    return [];
  }

  if (snap.graduated && pos.phase !== "DETECTED" && pos.venue !== "pump-amm") {
    const note = annotate(
      log({
        level: "THINK",
        reason: "graduated_pumpswap",
        msg: `THINK graduated → PumpSwap AMM (not liquidity gone)`,
      }),
      pos,
      snap,
    );
    const rest =
      pos.phase === "OPEN_IGNORE"
        ? handleOpenIgnore({ ...pos, venue: "pump-amm" }, snap, input)
        : pos.phase === "SHAKEOUT"
          ? handleShakeout({ ...pos, venue: "pump-amm" }, snap, input)
          : pos.phase === "SEEK_RENT"
            ? handleSeekRent({ ...pos, venue: "pump-amm" }, snap, input)
            : pos.phase === "STUB"
              ? handleStub({ ...pos, venue: "pump-amm" }, snap, input)
              : handleMoonbag({ ...pos, venue: "pump-amm" }, snap, input);
    return [
      {
        kind: "PATCH",
        level: "INFO",
        reason: "venue_pumpswap",
        msg: "venue=pump-amm",
        mint: pos.mint,
        fields: { venue: "pump-amm" },
      },
      note,
      ...rest,
    ];
  }

  if (snap.liquidity_gone && !snap.graduated && pos.phase !== "DETECTED") {
    return [
      annotate(
        {
          kind: "SELL_ALL",
          level: "DEAD",
          reason: "liquidity_gone",
          msg: `DEAD liquidity_gone sold=100%`,
        },
        pos,
        snap,
      ),
    ];
  }

  if (pos.phase === "DETECTED") return handleDetectedBuy(pos, snap, input);
  if (pos.phase === "OPEN_IGNORE") return handleOpenIgnore(pos, snap, input);
  if (pos.phase === "SHAKEOUT") return handleShakeout(pos, snap, input);
  if (pos.phase === "SEEK_RENT") return handleSeekRent(pos, snap, input);
  if (pos.phase === "STUB") return handleStub(pos, snap, input);
  if (pos.phase === "MOONBAG") return handleMoonbag(pos, snap, input);
  return [];
}

function handleManual(input: DecideInput): Intent[] {
  const ev = input.event;
  const pos = input.position;
  if (ev.type === "PANIC_FLATTEN") {
    const intents: Intent[] = [];
    for (const p of input.allPositions) {
      if (p.phase === "CLOSED" || p.phase === "DETECTED") continue;
      if (p.phase === "MOONBAG" && !ev.includeMoonbags) continue;
      intents.push(
        annotate(
          {
            kind: "SELL_ALL",
            level: "PANIC",
            reason: "panic_flatten",
            msg: `PANIC flatten ${p.symbol} sold=100%`,
          },
          p,
        ),
      );
    }
    return intents;
  }
  if (!pos || pos.phase === "CLOSED") {
    return [
      log({
        level: "ERROR",
        reason: "no_position",
        msg: "no open position for override",
        mint: "mint" in ev ? ev.mint : "",
      }),
    ];
  }
  if (ev.type === "MANUAL_SELL_50") {
    if (pos.tokens_left <= 0) {
      return [log({ level: "ERROR", reason: "empty", msg: "nothing left to sell", mint: pos.mint })];
    }
    return [
      annotate(
        {
          kind: "SELL_FRACTION",
          level: "SELL",
          reason: "manual_50",
          fraction: 0.5,
          msg: `manual sold=50%`,
        },
        pos,
      ),
    ];
  }
  if (ev.type === "MANUAL_SELL_ALL") {
    return [
      annotate(
        {
          kind: "SELL_ALL",
          level: "SELL",
          reason: "manual_100",
          msg: `manual sold=100%`,
        },
        pos,
      ),
    ];
  }
  if (ev.type === "FORCE_MOONBAG") {
    return [
      annotate(
        {
          kind: "SET_PHASE",
          level: "MOON",
          reason: "force_moonbag",
          msg: `MOON forced leftover unmanaged`,
          phase: "MOONBAG",
          fields: { phase: "MOONBAG", last_reason: "force_moonbag", last_action: "MOONBAG" },
        },
        pos,
      ),
    ];
  }
  return [];
}

/**
 * Pure state machine. No RPC. Event in → intents out.
 */
export function decide(input: DecideInput): Intent[] {
  const ev = input.event;
  if (ev.type === "CREATE") return handleCreate(ev.create, input);
  if (ev.type === "SNAPSHOT") return handleSnapshot(ev.snapshot, input);
  return handleManual(input);
}

export { moonbagReady, leftoverValueSol, uniqueDeclining };
