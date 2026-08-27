import type { BotConfig, Position } from "./models.ts";
import { isOpenPhase } from "./models.ts";

export interface RiskState {
  dailyPnl: number;
  buysByDev: { creator: string; ts: number }[];
  buyAttempted: Set<string>;
}

export function createRiskState(): RiskState {
  return { dailyPnl: 0, buysByDev: [], buyAttempted: new Set() };
}

export function openPositionCount(positions: Iterable<Position>): number {
  let n = 0;
  for (const p of positions) if (isOpenPhase(p.phase)) n += 1;
  return n;
}

export function dailyLossHit(risk: RiskState, cfg: BotConfig): boolean {
  return risk.dailyPnl <= -Math.abs(cfg.daily_loss_limit_sol);
}

export function creatorOnCooldown(
  risk: RiskState,
  creator: string,
  now: number,
  cfg: BotConfig,
): boolean {
  const windowMs = cfg.max_buys_per_dev_hours * 3600 * 1000;
  const key = creator.toLowerCase();
  return risk.buysByDev.some(
    (b) => b.creator === key && now - b.ts < windowMs,
  );
}

export function recordBuy(risk: RiskState, creator: string, mint: string, now: number) {
  risk.buysByDev.push({ creator: creator.toLowerCase(), ts: now });
  risk.buyAttempted.add(mint);
}

export function applyRealizedDelta(risk: RiskState, deltaPnl: number) {
  risk.dailyPnl += deltaPnl;
}

/** PnL of a sell vs cost basis of the sold slice. */
export function slicePnl(
  fillSol: number,
  tokensBought: number,
  soldTokens: number,
  soldSol: number,
): number {
  if (!tokensBought) return soldSol;
  const cost = fillSol * (soldTokens / tokensBought);
  return soldSol - cost;
}
