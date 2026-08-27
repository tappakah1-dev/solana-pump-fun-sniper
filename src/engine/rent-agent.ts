import type { BotConfig, MarketSnapshot, Position } from "./models.ts";
import { multipleVsFill } from "./models.ts";

/**
 * SEEK_RENT agent.
 *
 * Rent is a risk rule, not a profit target. Once +110% (2.1× fill) prints,
 * 50% of the original bag WILL be sold. Only the print is flexible:
 *
 *   1. Peel `rent_peel_fraction` (default 20%) at the exact tag — never sit
 *      100% size through a 2.1× dump.
 *   2. Trail the rest of initials (~30% of original) while tape is ripping.
 *   3. Fire the trail on fade (sell print / buy-volume pause / 12% giveback
 *      from the post-tag high) or at `rent_cap_multiple` (default 3×).
 *
 * Rent cannot be cancelled. Unique buyers + buy/sell ratio, not raw volume.
 */

export type RentWhy = "peel" | "cap" | "giveback" | "fade_sell" | "fade_pause" | "hold" | "wait";

export type RentAction =
  | { type: "HOLD" }
  | { type: "PEEL"; fraction: number }
  | { type: "TRAIL"; fraction: number; mark3x: boolean };

export interface RentDecision {
  action: RentAction;
  reason: string;
  think: string;
  why: RentWhy;
  fields: Partial<Position>;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(0.95, Math.max(0, n));
}

export function rentTriggerMultiple(cfg: BotConfig): number {
  return 1 + cfg.rent_profit_pct;
}

/** Fraction of *remaining* tokens to sell on the trail tick so original sold ≈ rent_sell_fraction. */
export function trailFractionOfRemaining(cfg: BotConfig): number {
  const peel = clamp01(cfg.rent_peel_fraction);
  const total = Math.min(0.95, Math.max(peel, cfg.rent_sell_fraction));
  if (peel >= total - 1e-9) return 0;
  return (total - peel) / Math.max(1e-9, 1 - peel);
}

function uniqueUp(snap: MarketSnapshot, pos: Position): boolean {
  const prev = snap.unique_buyers_prev || pos.unique_buyers_prev || pos.unique_buyers;
  return snap.unique_buyers >= prev;
}

function buyDominant(snap: MarketSnapshot, cfg: BotConfig): boolean {
  if (snap.sell_sol <= 0) return snap.buy_sol > 0;
  return snap.buy_sol >= cfg.buy_dom_ratio * snap.sell_sol;
}

function accelerating(trail: number[]): boolean {
  if (trail.length < 3) return false;
  const a = trail[trail.length - 3]!;
  const b = trail[trail.length - 2]!;
  const c = trail[trail.length - 1]!;
  if (a <= 0 || b <= 0) return false;
  return b / a >= 1.06 && c / b >= 1.06;
}

export function rentTapeRipping(pos: Position, snap: MarketSnapshot, cfg: BotConfig): boolean {
  const peak = Math.max(pos.rent_peak_mcap || 0, pos.local_high || 0, snap.mcap);
  const drop = peak > 0 ? (peak - snap.mcap) / peak : 0;
  if (drop >= cfg.rent_giveback_pct) return false;
  if (!buyDominant(snap, cfg)) return false;
  if (!uniqueUp(snap, pos)) return false;
  const trail = [...(pos.mcap_trail ?? []), snap.mcap].slice(-8);
  if (accelerating(trail) && drop < 0.12) return true;
  if (drop < 0.08) return true;
  return false;
}

export function sellPrint(snap: MarketSnapshot): boolean {
  return snap.sell_sol > 0 && snap.sell_sol >= Math.max(snap.buy_sol, 1e-9);
}

export function buyVolumePause(pos: Position, snap: MarketSnapshot, cfg: BotConfig): boolean {
  const peak = pos.rent_peak_buy_sol || 0;
  if (peak <= 0) return false;
  if ((pos.rent_ticks_since_arm || 0) < 1) return false;
  return snap.buy_sol < cfg.rent_pause_ratio * peak;
}

function fmtX(mult: number): string {
  return `${mult.toFixed(2)}×`;
}

export function peakFields(pos: Position, snap: MarketSnapshot, armed: boolean): Partial<Position> {
  if (!armed) return {};
  return {
    rent_peak_mcap: Math.max(pos.rent_peak_mcap || 0, snap.mcap),
    rent_peak_buy_sol: Math.max(pos.rent_peak_buy_sol || 0, snap.buy_sol),
    rent_ticks_since_arm: (pos.rent_ticks_since_arm || 0) + 1,
  };
}

export function decideRent(pos: Position, snap: MarketSnapshot, cfg: BotConfig): RentDecision {
  const mult = multipleVsFill(pos, snap.mcap);
  const trigger = rentTriggerMultiple(cfg);
  const cap = cfg.rent_cap_multiple;
  const peelFrac = clamp01(cfg.rent_peel_fraction);
  const trailFrac = trailFractionOfRemaining(cfg);
  const armed = Boolean(pos.rent_armed || pos.did_rent_peel);
  const peaks = peakFields(pos, snap, armed);
  const ticking: Position = { ...pos, ...peaks };
  const peakMcap = Math.max(ticking.rent_peak_mcap || 0, snap.mcap);

  const finish = (
    action: RentAction,
    why: RentWhy,
    reason: string,
    think: string,
    extra: Partial<Position> = {},
  ): RentDecision => ({
    action,
    why,
    reason,
    think,
    fields: { ...peaks, last_think: think, last_reason: reason, ...extra },
  });

  if (pos.did_rent) {
    return finish({ type: "HOLD" }, "hold", "rent_done", `THINK RENT ${fmtX(mult)} already banked`);
  }

  if (!armed) {
    if (mult < trigger) {
      return finish(
        { type: "HOLD" },
        "wait",
        "seek_rent_tick",
        `THINK RENT ${fmtX(mult)} waiting for ${fmtX(trigger)} tag`,
      );
    }
    // Gapped through 2.1× and the cap in one print — take the full 50% now.
    if (mult >= cap) {
      const think = `THINK RENT ${fmtX(mult)} gapped to cap → sell ${Math.round(cfg.rent_sell_fraction * 100)}% (initials + 3×)`;
      return finish(
        { type: "TRAIL", fraction: cfg.rent_sell_fraction, mark3x: true },
        "cap",
        "rent_110",
        think,
        {
          rent_armed: true,
          did_rent_peel: true,
          did_rent: true,
          rent_peak_mcap: snap.mcap,
          rent_peak_buy_sol: snap.buy_sol,
          rent_ticks_since_arm: 0,
          did_trim_3x: true,
          hit_rungs: [...new Set([...(pos.hit_rungs ?? []), "3x"])],
          phase: "STUB",
          last_action: "RENT",
        },
      );
    }
    const think = `THINK RENT ${fmtX(mult)} peel ${Math.round(peelFrac * 100)}% — initials armed, trailing the rest`;
    return finish(
      { type: "PEEL", fraction: peelFrac },
      "peel",
      "rent_peel",
      think,
      {
        rent_armed: true,
        did_rent_peel: true,
        rent_peak_mcap: snap.mcap,
        rent_peak_buy_sol: snap.buy_sol,
        rent_ticks_since_arm: 0,
        last_action: "RENT_PEEL",
        phase: "SEEK_RENT",
      },
    );
  }

  // Armed — trail the remaining initials. Cannot un-arm.
  if (mult >= cap) {
    const think = `THINK RENT ${fmtX(mult)} cap → sell ${Math.round(trailFrac * 100)}% remaining (initials complete, 3× marked)`;
    return finish(
      { type: "TRAIL", fraction: trailFrac, mark3x: true },
      "cap",
      "rent_110",
      think,
      {
        did_rent: true,
        phase: "STUB",
        last_action: "RENT",
        did_trim_3x: true,
        hit_rungs: [...new Set([...(pos.hit_rungs ?? []), "3x"])],
      },
    );
  }

  if (peakMcap > 0 && snap.mcap <= peakMcap * (1 - cfg.rent_giveback_pct)) {
    const drop = Math.round((1 - snap.mcap / peakMcap) * 100);
    const think = `THINK RENT ${fmtX(mult)} −${drop}% from post-tag high → sell ${Math.round(trailFrac * 100)}% remaining (giveback)`;
    return finish(
      { type: "TRAIL", fraction: trailFrac, mark3x: false },
      "giveback",
      "rent_110",
      think,
      { did_rent: true, phase: "STUB", last_action: "RENT" },
    );
  }

  if (sellPrint(snap)) {
    const think = `THINK RENT ${fmtX(mult)} sell print → sell ${Math.round(trailFrac * 100)}% remaining (initials complete)`;
    return finish(
      { type: "TRAIL", fraction: trailFrac, mark3x: false },
      "fade_sell",
      "rent_110",
      think,
      { did_rent: true, phase: "STUB", last_action: "RENT" },
    );
  }

  if (buyVolumePause(ticking, snap, cfg) && !rentTapeRipping(pos, snap, cfg)) {
    const think = `THINK RENT ${fmtX(mult)} buy pause → sell ${Math.round(trailFrac * 100)}% remaining (initials complete)`;
    return finish(
      { type: "TRAIL", fraction: trailFrac, mark3x: false },
      "fade_pause",
      "rent_110",
      think,
      { did_rent: true, phase: "STUB", last_action: "RENT" },
    );
  }

  const ripping = rentTapeRipping(pos, snap, cfg);
  const think = ripping
    ? `THINK RENT ${fmtX(mult)} ripping — hold trail (fade or ${cap.toFixed(1)}× will fire)`
    : `THINK RENT ${fmtX(mult)} armed — watching fade / ${Math.round(cfg.rent_giveback_pct * 100)}% giveback / ${cap.toFixed(1)}× cap`;
  return finish({ type: "HOLD" }, "hold", "rent_trail_hold", think, { last_action: "RENT_TRAIL" });
}
