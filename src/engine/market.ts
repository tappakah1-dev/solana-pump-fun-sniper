import type { MarketSnapshot } from "./models.ts";

/**
 * MarketSource is a protocol. Live snapshots come from pump.fun coins + trades
 * (see live-runner / pump-map). ReplayMarketSource drives the lab slider.
 */
export interface MarketSource {
  snapshot(mint: string, now: number): MarketSnapshot | null;
  alive(): boolean;
}

export class ReplayMarketSource implements MarketSource {
  private latest = new Map<string, MarketSnapshot>();
  private _alive = true;

  push(snap: MarketSnapshot) {
    this.latest.set(snap.mint, snap);
  }

  snapshot(mint: string): MarketSnapshot | null {
    return this.latest.get(mint) ?? null;
  }

  alive() {
    return this._alive;
  }

  setAlive(v: boolean) {
    this._alive = v;
  }
}

export class LiveMarketSource implements MarketSource {
  private readonly rpcUrl: string;
  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
  }

  snapshot(): MarketSnapshot | null {
    if (!this.rpcUrl) return null;
    return null;
  }

  alive() {
    return Boolean(this.rpcUrl);
  }
}

export function syntheticSnapshot(
  mint: string,
  mcap: number,
  now: number,
  extra: Partial<MarketSnapshot> = {},
): MarketSnapshot {
  return {
    ts: now,
    mint,
    mcap,
    price_sol: 0,
    unique_buyers: 40,
    unique_buyers_prev: 36,
    buy_sol: 6,
    sell_sol: 3,
    dev_token_balance: 1_000_000_000,
    liquidity_gone: false,
    graduated: false,
    smart_net_sell: false,
    ...extra,
  };
}
