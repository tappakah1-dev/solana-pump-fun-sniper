import type { BotConfig, Intent, MarketSnapshot, Position } from "./models.ts";
import { leftoverValueSol, multipleVsFill } from "./models.ts";

/**
 * Post-rent sell agent.
 *
 * Not an LLM on every poll (that would be slow, expensive, and jittery).
 * It classifies tape structure and sizes the next clip — or decides flatten vs
 * moonbag — the way a desk would: one runner in 10–15 has to pay the rugs,
 * 20–50k is where most coins die, 100k+ is the bag you do not dump.
 */
export type TapeRegime = "RIPPING" | "HEALTHY" | "WEAKENING" | "DEAD";
export type McapZone = "early" | "death" | "runner" | "moon";

export const LADDER_RUNGS = [
  { id: "3x", multiple: 3 },
  { id: "5x", multiple: 5 },
  { id: "6p5x", multiple: 6.5 },
  { id: "8x", multiple: 8 },
  { id: "10x", multiple: 10 },
  { id: "16x", multiple: 16 },
  { id: "30x", multiple: 30 },
] as const;

export type RungId = (typeof LADDER_RUNGS)[number]["id"];

export type AgentAction =
  | { type: "HOLD" }
  | { type: "CLIP"; fraction: number; rung: RungId }
  | { type: "SELL_ALL" }
  | { type: "MOONBAG" };

export interface AgentDecision {
  action: AgentAction;
  regime: TapeRegime;
  zone: McapZone;
  reason: string;
  think: string;
  fields: Partial<Position>;
}

function fmtK(mcap: number): string {
  if (mcap >= 100_000) return `$${(mcap / 1000).toFixed(0)}k`;
  if (mcap >= 1000) return `$${(mcap / 1000).toFixed(1)}k`;
  return `$${Math.round(mcap)}`;
}

export function mcapZone(mcap: number): McapZone {
  if (mcap >= 100_000) return "moon";
  if (mcap >= 50_000) return "runner";
  if (mcap >= 20_000) return "death";
  return "early";
}

export function pushTrail(prev: number[] | undefined, mcap: number): number[] {
  const next = [...(prev ?? []), mcap];
  return next.slice(-8);
}

export function alreadyHit(pos: Position, id: RungId): boolean {
  if (pos.hit_rungs?.includes(id)) return true;
  if (id === "3x") return pos.did_trim_3x;
  if (id === "5x") return pos.did_trim_5x;
  if (id === "10x") return pos.did_trim_10x;
  return false;
}

function sellDominant(snap: MarketSnapshot, cfg: BotConfig): boolean {
  if (snap.buy_sol <= 0) return snap.sell_sol > 0;
  return snap.sell_sol >= cfg.sell_dom_ratio * snap.buy_sol;
}

function buyDominant(snap: MarketSnapshot, cfg: BotConfig): boolean {
  if (snap.sell_sol <= 0) return snap.buy_sol > 0;
  return snap.buy_sol >= cfg.buy_dom_ratio * snap.sell_sol;
}

function uniqueUp(snap: MarketSnapshot, pos: Position): boolean {
  const prev = snap.unique_buyers_prev || pos.unique_buyers_prev || pos.unique_buyers;
  return snap.unique_buyers >= prev;
}

function uniqueDown(snap: MarketSnapshot, pos: Position): boolean {
  const prev = snap.unique_buyers_prev || pos.unique_buyers_prev || pos.unique_buyers;
  return snap.unique_buyers < prev;
}

function accelerating(trail: number[]): boolean {
  if (trail.length < 3) return false;
  const a = trail[trail.length - 3]!;
  const b = trail[trail.length - 2]!;
  const c = trail[trail.length - 1]!;
  if (a <= 0 || b <= 0) return false;
  return b / a >= 1.06 && c / b >= 1.06;
}

export function classifyTape(pos: Position, snap: MarketSnapshot, cfg: BotConfig): TapeRegime {
  if (snap.mcap <= cfg.dead_mcap) return "DEAD";
  const drop = pos.local_high > 0 ? (pos.local_high - snap.mcap) / pos.local_high : 0;
  const trail = pushTrail(pos.mcap_trail, snap.mcap);
  const stall = snap.mcap < pos.local_high * 0.98 ? pos.stall_bars + 1 : 0;
  const zone = mcapZone(snap.mcap);
  const ripping =
    accelerating(trail) &&
    buyDominant(snap, cfg) &&
    uniqueUp(snap, pos) &&
    drop < 0.18;
  if (ripping) return "RIPPING";
  if (drop < 0.12 && buyDominant(snap, cfg) && uniqueUp(snap, pos)) return "RIPPING";
  if (drop < 0.08 && snap.mcap >= pos.local_high * 0.95 && !sellDominant(snap, cfg)) {
    return "RIPPING";
  }

  const deathFade =
    (zone === "death" || zone === "early") &&
    (stall >= 3 || drop >= 0.28) &&
    sellDominant(snap, cfg) &&
    (uniqueDown(snap, pos) || drop >= 0.35);

  if (deathFade && drop >= 0.45) return "DEAD";
  if (deathFade) return "WEAKENING";
  if (sellDominant(snap, cfg) && uniqueDown(snap, pos) && drop >= 0.22) return "WEAKENING";
  if (drop >= 0.4 && !buyDominant(snap, cfg)) return "WEAKENING";
  if (stall >= 4 && zone === "death" && !buyDominant(snap, cfg)) return "WEAKENING";
  if (pos.base_low > 0 && snap.mcap < pos.base_low) return "WEAKENING";
  return "HEALTHY";
}

function clipFraction(regime: TapeRegime, zone: McapZone): number {
  if (regime === "RIPPING") {
    if (zone === "moon") return 0.12;
    if (zone === "runner") return 0.15;
    return 0.18;
  }
  if (regime === "HEALTHY") {
    if (zone === "moon") return 0.15;
    if (zone === "runner") return 0.2;
    if (zone === "death") return 0.25;
    return 0.2;
  }
  // WEAKENING — take more of the remaining bag; death-zone fades get cut hard.
  if (zone === "death" || zone === "early") return 0.5;
  if (zone === "runner") return 0.4;
  return 0.35;
}

function dueRungs(pos: Position, multiple: number): (typeof LADDER_RUNGS)[number][] {
  return LADDER_RUNGS.filter((rung) => multiple >= rung.multiple && !alreadyHit(pos, rung.id));
}

function markRungs(pos: Position, ids: RungId[]): Partial<Position> {
  const hit = [...new Set([...(pos.hit_rungs ?? []), ...ids])];
  const fields: Partial<Position> = { hit_rungs: hit };
  if (ids.includes("3x")) fields.did_trim_3x = true;
  if (ids.includes("5x")) fields.did_trim_5x = true;
  if (ids.includes("10x")) fields.did_trim_10x = true;
  return fields;
}

export function moonbagReady(pos: Position, mcap: number, cfg: BotConfig): boolean {
  const leftover = leftoverValueSol(pos, mcap);
  if (leftover > cfg.moonbag_leftover_sol) return false;
  const paid =
    pos.realized_sol >= cfg.moonbag_realized_multiple * cfg.ticket_sol ||
    alreadyHit(pos, "16x") ||
    alreadyHit(pos, "30x") ||
    Boolean(pos.did_trim_10x);
  const zone = mcapZone(mcap);
  if (!paid && (zone === "death" || zone === "early")) {
    // Unpaid 20–50k leftover is not a moonbag. That is how desks give back the rent.
    if (pos.last_regime === "WEAKENING" || pos.last_regime === "DEAD") return false;
  }
  if (paid) return true;
  if (zone === "moon") return true;
  return false;
}

function thinkLine(parts: {
  regime: TapeRegime;
  zone: McapZone;
  mcap: number;
  verb: string;
}): string {
  return `THINK ${parts.regime} ${fmtK(parts.mcap)} ${parts.zone}-zone ${parts.verb}`;
}

export function decideStubExit(
  pos: Position,
  snap: MarketSnapshot,
  cfg: BotConfig,
  opts: { keep: boolean },
): AgentDecision {
  const trail = pushTrail(pos.mcap_trail, snap.mcap);
  const stall = snap.mcap + 1e-9 < pos.local_high * 0.98 ? (pos.stall_bars || 0) + 1 : 0;
  const regime = classifyTape({ ...pos, mcap_trail: trail, stall_bars: stall }, snap, cfg);
  const zone = mcapZone(snap.mcap);
  const drop = pos.local_high > 0 ? (pos.local_high - snap.mcap) / pos.local_high : 0;
  const multiple = multipleVsFill(pos, snap.mcap);
  const leftover = leftoverValueSol(pos, snap.mcap);
  const baseFields: Partial<Position> = {
    mcap_trail: trail,
    stall_bars: stall,
    last_regime: regime,
    last_think: "",
  };

  const finish = (d: Omit<AgentDecision, "regime" | "zone" | "fields"> & { fields?: Partial<Position> }): AgentDecision => {
    const think = d.think;
    return {
      ...d,
      regime,
      zone,
      fields: { ...baseFields, ...d.fields, last_think: think, last_regime: regime },
    };
  };

  if (moonbagReady({ ...pos, last_regime: pos.last_regime, hit_rungs: pos.hit_rungs }, snap.mcap, cfg)) {
    const think = thinkLine({
      regime,
      zone,
      mcap: snap.mcap,
      verb: `leftover ${leftover.toFixed(2)} SOL realized ${pos.realized_sol.toFixed(2)} → moonbag (this one pays the rugs)`,
    });
    return finish({
      action: { type: "MOONBAG" },
      reason: "moonbag_armed",
      think,
    });
  }

  if (regime === "DEAD" && (zone === "death" || zone === "early") && drop >= 0.4) {
    const think = thinkLine({
      regime,
      zone,
      mcap: snap.mcap,
      verb: `−${Math.round(drop * 100)}% from ${fmtK(pos.local_high)} stalled=${stall} → SELL_ALL (20–50k death, this is not a runner)`,
    });
    return finish({
      action: { type: "SELL_ALL" },
      reason: "death_zone_fade",
      think,
    });
  }

  if (
    opts.keep &&
    (zone === "death" || zone === "early") &&
    stall >= 4 &&
    sellDominant(snap, cfg) &&
    uniqueDown(snap, pos) &&
    snap.mcap < 55_000
  ) {
    const think = thinkLine({
      regime: "WEAKENING",
      zone,
      mcap: snap.mcap,
      verb: `stalled ${stall} bars under ${fmtK(pos.local_high)} sell>buy → SELL_ALL (dies in the 20–50k band)`,
    });
    return finish({
      action: { type: "SELL_ALL" },
      reason: "death_zone_stall",
      think,
      fields: { last_regime: "WEAKENING" },
    });
  }

  if (!opts.keep) {
    const think = thinkLine({
      regime,
      zone,
      mcap: snap.mcap,
      verb: "wick wait — no clip until reclaim or flatten",
    });
    return finish({ action: { type: "HOLD" }, reason: "wick_wait", think });
  }

  const due = dueRungs(pos, multiple);
  if (due.length) {
    let fraction = clipFraction(regime, zone);
    if (due.length > 1) {
      // Gapped through rungs (30k → 80k print). Take the missed clips as one,
      // capped so a ripping runner still keeps a real stub.
      fraction = Math.min(0.45, fraction + 0.08 * (due.length - 1));
    }
    if (regime === "WEAKENING" && (zone === "death" || zone === "early")) {
      const think = thinkLine({
        regime,
        zone,
        mcap: snap.mcap,
        verb: `weak tape leftover ${leftover.toFixed(2)} SOL → SELL_ALL (don't donate a 20–50k death)`,
      });
      return finish({ action: { type: "SELL_ALL" }, reason: "death_zone_fade", think });
    }
    const top = due[due.length - 1]!;
    const pct = Math.round(fraction * 100);
    const labels = due.map((r) => `${r.multiple}×`).join(",");
    const think = thinkLine({
      regime,
      zone,
      mcap: snap.mcap,
      verb:
        regime === "RIPPING"
          ? `${labels} hit, clip ${pct}% remaining (runner tape — don't dump 100k+)`
          : regime === "WEAKENING"
            ? `${labels} but tape fading, take ${pct}% remaining`
            : `${labels} clip ${pct}% remaining`,
    });
    return finish({
      action: { type: "CLIP", fraction, rung: top.id },
      reason: `trim_${top.id}`,
      think,
      fields: markRungs(
        pos,
        due.map((r) => r.id),
      ),
    });
  }

  if (regime === "WEAKENING" && (zone === "death" || zone === "early") && drop >= 0.28) {
    const think = thinkLine({
      regime,
      zone,
      mcap: snap.mcap,
      verb: `−${Math.round(drop * 100)}% off high in death zone → SELL_ALL remaining`,
    });
    return finish({ action: { type: "SELL_ALL" }, reason: "death_zone_fade", think });
  }

  const think = thinkLine({
    regime,
    zone,
    mcap: snap.mcap,
    verb:
      regime === "RIPPING"
        ? "hold remaining — tape still lifting"
        : regime === "WEAKENING"
          ? "no new rung, watching fade"
          : "hold, waiting for next rung or a real fade",
  });
  return finish({ action: { type: "HOLD" }, reason: "stub_hold", think });
}

export function thinkIntent(pos: Position, decision: AgentDecision, snap: MarketSnapshot): Intent {
  return {
    kind: "LOG_ONLY",
    level: "THINK",
    reason: decision.reason,
    msg: decision.think,
    mint: pos.mint,
    creator: pos.creator,
    token: pos.symbol,
    phase: pos.phase,
    mcap: snap.mcap,
    fill_mcap: pos.fill_mcap,
  };
}
