import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { coinToCreate, coinMcapUsd, snapshotFromMarket, type PumpCoin, type PumpTrade } from "./pump-map.ts";

const coin: PumpCoin = {
  mint: "Mint111111111111111111111111111111111111111",
  name: "Biz",
  symbol: "BIZ",
  creator: "BizCreator1111111111111111111111111111111",
  twitter: "https://x.com/biz",
  telegram: "",
  website: "https://biz.example",
  usd_market_cap: 5600,
  created_timestamp: Date.parse("2026-08-27T10:00:00Z"),
  complete: false,
};

describe("pump-map", () => {
  it("maps coin → create with socials and mcap", () => {
    const c = coinToCreate(coin);
    assert.equal(c.mint, coin.mint);
    assert.equal(c.creator, coin.creator);
    assert.equal(c.socials.twitter, coin.twitter);
    assert.equal(c.socials.website, coin.website);
    assert.equal(c.mcap, 5600);
  });

  it("prefers bonding-curve reserves over a stale usd_market_cap", () => {
    const n = coinMcapUsd(
      {
        ...coin,
        usd_market_cap: 6030,
        virtual_sol_reserves: 30_000_000_000,
        virtual_token_reserves: 1_000_000_000_000_000,
        total_supply: 1_000_000_000_000_000,
      },
      150,
    );
    assert.ok(n > 4000);
    assert.ok(Math.abs(n - 4500) < 1);
  });

  it("complete coin → graduated PumpSwap, not liquidity_gone", () => {
    const trades: PumpTrade[] = [
      {
        type: "buy",
        amountSol: "0.4",
        userAddress: "Buyer111",
        timestamp: new Date().toISOString(),
      },
      {
        type: "sell",
        amountSol: "0.1",
        userAddress: coin.creator,
        timestamp: new Date().toISOString(),
        baseAmount: "500",
      },
    ];
    const snap = snapshotFromMarket({
      coin: { ...coin, complete: true },
      trades,
      now: Date.now(),
      smartHas: (a) => a === "smart1",
    });
    assert.equal(snap.graduated, true);
    assert.equal(snap.liquidity_gone, false);
    assert.ok(snap.buy_sol >= 0.4);
    assert.ok(snap.sell_sol >= 0.1);
    assert.equal(snap.unique_buyers, 1);
    assert.ok(snap.dev_token_balance < 1_000_000_000);
  });

  it("smart net sell is an exit hint, not an entry", () => {
    const trades: PumpTrade[] = [
      { type: "sell", amountSol: 2, userAddress: "smart1", timestamp: new Date().toISOString() },
      { type: "buy", amountSol: 0.1, userAddress: "smart1", timestamp: new Date().toISOString() },
    ];
    const snap = snapshotFromMarket({
      coin,
      trades,
      now: Date.now(),
      smartHas: (a) => a === "smart1",
    });
    assert.equal(snap.smart_net_sell, true);
  });
});
