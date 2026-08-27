import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyTape, decideStubExit, mcapZone } from "./exit-agent.ts";
import { DEFAULT_CONFIG } from "./settings.ts";
import { leftoverValueSol, emptyPosition, type MarketSnapshot, type Position } from "./models.ts";

const cfg = { ...DEFAULT_CONFIG };

function stub(partial: Partial<Position> = {}) {
  return emptyPosition({
    mint: "MintBiz111111111111111111111111111111111",
    name: "Biz",
    symbol: "BIZ",
    creator: "BizCreator1111111111111111111111111111111",
    fill_ts: 1,
    fill_mcap: 5600,
    fill_sol: 0.05,
    tokens_bought: 1_000_000,
    tokens_left: 500_000,
    realized_sol: 0.11,
    phase: "STUB",
    did_rent: true,
    local_high: 12600,
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
    graduated: extra.graduated ?? false,
    smart_net_sell: false,
    ...extra,
  };
}

describe("exit agent", () => {
  it("zones: 30k death, 80k runner, 120k moon", () => {
    assert.equal(mcapZone(30_000), "death");
    assert.equal(mcapZone(80_000), "runner");
    assert.equal(mcapZone(120_000), "moon");
  });

  it("ripping 100k+ clips a small slice, does not flatten", () => {
    const pos = stub({
      local_high: 90_000,
      mcap_trail: [70_000, 82_000, 95_000],
      unique_buyers: 40,
    });
    const s = snap(120_000, { unique_buyers: 55, unique_buyers_prev: 40, buy_sol: 12, sell_sol: 2 });
    const d = decideStubExit(pos, s, cfg, { keep: true });
    assert.notEqual(d.action.type, "SELL_ALL");
    assert.ok(d.action.type === "CLIP" || d.action.type === "HOLD" || d.action.type === "MOONBAG");
    if (d.action.type === "CLIP") {
      assert.ok(d.action.fraction <= 0.45);
    }
    assert.equal(classifyTape(pos, s, cfg), "RIPPING");
  });

  it("20–50k fade after a stall flattens remaining", () => {
    const pos = stub({
      local_high: 32_000,
      mcap_trail: [32_000, 28_000, 24_000, 21_000],
      stall_bars: 4,
      unique_buyers: 30,
      unique_buyers_prev: 48,
    });
    const s = snap(18_000, {
      unique_buyers: 10,
      unique_buyers_prev: 16,
      buy_sol: 0.2,
      sell_sol: 4,
    });
    const d = decideStubExit(pos, s, cfg, { keep: true });
    assert.equal(d.action.type, "SELL_ALL");
    assert.ok(d.reason === "death_zone_fade" || d.reason === "death_zone_stall");
    assert.ok(d.think.includes("SELL_ALL"));
  });

  it("healthy 30k print clips a rung instead of dumping", () => {
    const pos = stub({ local_high: 12_600, mcap_trail: [12_600, 18_000, 24_000] });
    const s = snap(18_000, { unique_buyers: 50, unique_buyers_prev: 44, buy_sol: 8, sell_sol: 3 });
    const d = decideStubExit(pos, s, cfg, { keep: true });
    assert.notEqual(d.action.type, "SELL_ALL");
    assert.equal(d.action.type, "CLIP");
  });

  it("70% dump on a paid moonbag-sized leftover is not a stub flatten signal", () => {
    const pos = stub({
      tokens_left: 40_000,
      realized_sol: 0.6,
      did_trim_3x: true,
      did_trim_5x: true,
      did_trim_10x: true,
      hit_rungs: ["3x", "5x", "6p5x", "8x", "10x", "16x"],
      local_high: 120_000,
      last_regime: "RIPPING",
    });
    const s = snap(36_000, {
      unique_buyers: 16,
      unique_buyers_prev: 48,
      buy_sol: 0.4,
      sell_sol: 7,
    });
    const leftover = leftoverValueSol(pos, 36_000);
    assert.ok(leftover <= cfg.moonbag_leftover_sol);
    const d = decideStubExit(pos, s, cfg, { keep: true });
    assert.equal(d.action.type, "MOONBAG");
  });
});
