import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideRent, trailFractionOfRemaining, rentTapeRipping } from "./rent-agent.ts";
import { DEFAULT_CONFIG } from "./settings.ts";
import { emptyPosition, type MarketSnapshot, type Position } from "./models.ts";

const cfg = { ...DEFAULT_CONFIG };

function seeking(partial: Partial<Position> = {}): Position {
  return emptyPosition({
    mint: "MintBiz111111111111111111111111111111111",
    name: "Biz",
    symbol: "BIZ",
    creator: "BizCreator1111111111111111111111111111111",
    fill_ts: 1,
    fill_mcap: 5600,
    fill_sol: 0.05,
    tokens_bought: 1_000_000,
    tokens_left: 1_000_000,
    realized_sol: 0,
    phase: "SEEK_RENT",
    local_high: 5600,
    base_low: 4800,
    ...partial,
  });
}

function snap(mcap: number, extra: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    ts: 2,
    mint: "MintBiz111111111111111111111111111111111",
    mcap,
    unique_buyers: extra.unique_buyers ?? 48,
    unique_buyers_prev: extra.unique_buyers_prev ?? 40,
    buy_sol: extra.buy_sol ?? 9,
    sell_sol: extra.sell_sol ?? 3,
    dev_token_balance: extra.dev_token_balance ?? 800,
    liquidity_gone: false,
    graduated: false,
    smart_net_sell: false,
    ...extra,
  };
}

describe("rent agent", () => {
  it("trail fraction of remaining is 37.5% so original sold is 50%", () => {
    const f = trailFractionOfRemaining(cfg);
    assert.ok(Math.abs(f - 0.375) < 1e-9);
    assert.ok(Math.abs(0.2 + 0.8 * f - 0.5) < 1e-9);
  });

  it("below 2.1× does not peel", () => {
    const d = decideRent(seeking(), snap(8000), cfg);
    assert.equal(d.action.type, "HOLD");
    assert.equal(d.why, "wait");
  });

  it("2.1× ripping tape peels 20% and stays in SEEK_RENT", () => {
    const d = decideRent(seeking({ mcap_trail: [5600, 9000, 11000] }), snap(12600), cfg);
    assert.equal(d.action.type, "PEEL");
    if (d.action.type === "PEEL") assert.equal(d.action.fraction, 0.2);
    assert.equal(d.fields.phase, "SEEK_RENT");
    assert.equal(d.fields.did_rent_peel, true);
    assert.equal(d.fields.did_rent, undefined);
  });

  it("gapped 2.1× and 3× in one print sells the full 50%", () => {
    const d = decideRent(seeking(), snap(18000), cfg);
    assert.equal(d.action.type, "TRAIL");
    if (d.action.type === "TRAIL") {
      assert.equal(d.action.fraction, 0.5);
      assert.equal(d.action.mark3x, true);
    }
    assert.equal(d.fields.did_rent, true);
    assert.equal(d.fields.did_trim_3x, true);
  });

  it("armed ripping tape holds the trail", () => {
    const pos = seeking({
      rent_armed: true,
      did_rent_peel: true,
      tokens_left: 800_000,
      rent_peak_mcap: 12600,
      rent_peak_buy_sol: 9,
      rent_ticks_since_arm: 2,
      mcap_trail: [9000, 11000, 12600],
      unique_buyers: 40,
    });
    const s = snap(14000, { unique_buyers: 52, unique_buyers_prev: 40, buy_sol: 11, sell_sol: 2 });
    assert.equal(rentTapeRipping(pos, s, cfg), true);
    const d = decideRent(pos, s, cfg);
    assert.equal(d.action.type, "HOLD");
    assert.equal(d.why, "hold");
  });

  it("12% giveback from post-tag high fires the trail", () => {
    const pos = seeking({
      rent_armed: true,
      did_rent_peel: true,
      tokens_left: 800_000,
      rent_peak_mcap: 14000,
      rent_peak_buy_sol: 11,
      rent_ticks_since_arm: 3,
    });
    const s = snap(14000 * 0.87, { buy_sol: 8, sell_sol: 4, unique_buyers: 40, unique_buyers_prev: 48 });
    const d = decideRent(pos, s, cfg);
    assert.equal(d.action.type, "TRAIL");
    assert.equal(d.why, "giveback");
    if (d.action.type === "TRAIL") assert.ok(Math.abs(d.action.fraction - 0.375) < 1e-9);
    assert.equal(d.fields.did_rent, true);
    assert.equal(d.fields.phase, "STUB");
  });

  it("sell print fires the trail even under the cap", () => {
    const pos = seeking({
      rent_armed: true,
      did_rent_peel: true,
      tokens_left: 800_000,
      rent_peak_mcap: 12600,
      rent_peak_buy_sol: 9,
      rent_ticks_since_arm: 1,
    });
    const d = decideRent(pos, snap(12500, { buy_sol: 2, sell_sol: 6, unique_buyers: 30, unique_buyers_prev: 48 }), cfg);
    assert.equal(d.action.type, "TRAIL");
    assert.equal(d.why, "fade_sell");
  });

  it("3× cap fires the trail on ripping tape and marks 3×", () => {
    const pos = seeking({
      rent_armed: true,
      did_rent_peel: true,
      tokens_left: 800_000,
      rent_peak_mcap: 14000,
      rent_peak_buy_sol: 11,
      rent_ticks_since_arm: 4,
      mcap_trail: [11000, 12600, 14000],
      unique_buyers: 50,
    });
    const d = decideRent(
      pos,
      snap(16800, { unique_buyers: 62, unique_buyers_prev: 50, buy_sol: 14, sell_sol: 2 }),
      cfg,
    );
    assert.equal(d.action.type, "TRAIL");
    assert.equal(d.why, "cap");
    assert.equal(d.fields.did_trim_3x, true);
    assert.ok(d.fields.hit_rungs?.includes("3x"));
  });

  it("buy-volume pause vs post-tag peak fires the trail", () => {
    const pos = seeking({
      rent_armed: true,
      did_rent_peel: true,
      tokens_left: 800_000,
      rent_peak_mcap: 14000,
      rent_peak_buy_sol: 12,
      rent_ticks_since_arm: 3,
      unique_buyers: 48,
    });
    const d = decideRent(
      pos,
      snap(13800, { buy_sol: 4, sell_sol: 3.5, unique_buyers: 40, unique_buyers_prev: 48 }),
      cfg,
    );
    assert.equal(d.action.type, "TRAIL");
    assert.equal(d.why, "fade_pause");
    assert.equal(d.fields.did_rent, true);
  });

  it("rent cannot be cancelled once armed", () => {
    const pos = seeking({
      rent_armed: true,
      did_rent_peel: true,
      tokens_left: 800_000,
      rent_peak_mcap: 12600,
      rent_peak_buy_sol: 9,
      rent_ticks_since_arm: 2,
    });
    const d = decideRent(pos, snap(20000, { buy_sol: 20, sell_sol: 1, unique_buyers: 80, unique_buyers_prev: 40 }), cfg);
    assert.notEqual(d.action.type, "HOLD");
    assert.equal(d.fields.did_rent, true);
  });
});
