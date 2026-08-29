import type { MarketSnapshot, Socials, TokenCreate } from "./models.ts";

export interface PumpCoin {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  twitter?: string | null;
  telegram?: string | null;
  website?: string | null;
  metadata_uri?: string | null;
  usd_market_cap?: number | null;
  market_cap_usd?: number | null;
  market_cap?: number | null;
  created_timestamp: number;
  complete?: boolean | null;
  token_program?: string | null;
  associated_bonding_curve?: string | null;
  bonding_curve?: string | null;
  virtual_sol_reserves?: number | null;
  virtual_token_reserves?: number | null;
  total_supply?: number | null;
  is_cashback_enabled?: boolean | null;
  image_uri?: string | null;
  pump_swap_pool?: string | null;
  raydium_pool?: string | null;
  /** Mayhem coins are experimental — the desk always skips them. */
  mayhem?: boolean | null;
}

export interface PumpTrade {
  type?: string;
  amountSol?: string | number;
  userAddress?: string;
  timestamp?: string;
  baseAmount?: string | number;
}

export function createdTsMs(ts: number): number {
  if (!Number.isFinite(ts) || ts <= 0) return Date.now();
  return ts < 1e12 ? ts * 1000 : ts;
}

export function coinMcapUsd(coin: PumpCoin, solUsd?: number): number {
  const vs = Number(coin.virtual_sol_reserves);
  const vt = Number(coin.virtual_token_reserves);
  const supply = Number(coin.total_supply) || 1_000_000_000_000_000;
  if (solUsd && solUsd > 0 && vs > 0 && vt > 0 && supply > 0) {
    const fromCurve = (vs / 1e9) * (supply / vt) * solUsd;
    if (Number.isFinite(fromCurve) && fromCurve > 0) return fromCurve;
  }
  const v = coin.usd_market_cap ?? coin.market_cap_usd;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return 0;
}

export function coinSocials(coin: PumpCoin): Socials {
  const s: Socials = {};
  if (coin.twitter) s.twitter = coin.twitter;
  if (coin.telegram) s.telegram = coin.telegram;
  if (coin.website) s.website = coin.website;
  return s;
}

export function coinToCreate(coin: PumpCoin, now = Date.now()): TokenCreate {
  return {
    mint: coin.mint,
    creator: coin.creator,
    name: coin.name || "TOKEN",
    symbol: coin.symbol || "TKN",
    ts: createdTsMs(coin.created_timestamp) || now,
    socials: coinSocials(coin),
    metadata_uri: coin.metadata_uri ?? undefined,
    mcap: coinMcapUsd(coin) || undefined,
    mayhem: Boolean(coin.mayhem),
  };
}

function num(v: string | number | undefined | null): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function tradeTsMs(t: PumpTrade): number {
  if (!t.timestamp) return 0;
  const ms = Date.parse(t.timestamp);
  return Number.isFinite(ms) ? ms : 0;
}

export interface SnapshotInput {
  coin: PumpCoin;
  trades: PumpTrade[];
  now: number;
  windowMs?: number;
  smartHas?: (addr: string) => boolean;
  prevUnique?: number;
  prevDevBalance?: number;
  devTokenBalance?: number;
  solUsd?: number;
}

export function snapshotFromMarket(input: SnapshotInput): MarketSnapshot {
  const windowMs = input.windowMs ?? 60_000;
  const now = input.now;
  const cutoff = now - windowMs;
  const recent = input.trades.filter((t) => {
    const ts = tradeTsMs(t);
    return !ts || ts >= cutoff;
  });
  const buyers = new Set<string>();
  let buySol = 0;
  let sellSol = 0;
  let smartBuy = 0;
  let smartSell = 0;
  let creatorSellTokens = 0;
  const creator = input.coin.creator.toLowerCase();
  for (const t of recent) {
    const sol = num(t.amountSol);
    const addr = (t.userAddress ?? "").toLowerCase();
    const side = (t.type ?? "").toLowerCase();
    if (side === "buy") {
      buySol += sol;
      if (addr) buyers.add(addr);
      if (input.smartHas?.(addr)) smartBuy += sol;
    } else if (side === "sell") {
      sellSol += sol;
      if (input.smartHas?.(addr)) smartSell += sol;
      if (addr && addr === creator) creatorSellTokens += num(t.baseAmount);
    }
  }
  const unique = buyers.size;
  let devBal = input.devTokenBalance;
  if (devBal == null) {
    const prev = input.prevDevBalance ?? 1_000_000_000;
    devBal = Math.max(0, prev - creatorSellTokens);
  }
  const graduated = Boolean(input.coin.complete);
  const vs = Number(input.coin.virtual_sol_reserves);
  const vt = Number(input.coin.virtual_token_reserves);
  const priceSol = vs > 0 && vt > 0 ? vs / 1e9 / vt : 0;
  return {
    ts: now,
    mint: input.coin.mint,
    mcap: coinMcapUsd(input.coin, input.solUsd),
    price_sol: Number.isFinite(priceSol) ? priceSol : 0,
    unique_buyers: unique,
    unique_buyers_prev: input.prevUnique ?? unique,
    buy_sol: buySol,
    sell_sol: sellSol,
    dev_token_balance: devBal,
    graduated,
    // Graduation is a venue change, not a flatten. Only mark gone if the curve
    // is unfinished AND reserves are actually empty.
    liquidity_gone:
      !graduated &&
      input.coin.virtual_sol_reserves != null &&
      Number(input.coin.virtual_sol_reserves) <= 0,
    smart_net_sell: smartSell > smartBuy && smartSell > 0,
    name: input.coin.name,
    symbol: input.coin.symbol,
    creator: input.coin.creator,
    socials: coinSocials(input.coin),
  };
}

export interface TapeRow {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  mcap: number;
  ts: number;
  allow: boolean;
  hasSocials: boolean;
  complete: boolean;
  tag: "buy" | "paper" | "skip";
}
