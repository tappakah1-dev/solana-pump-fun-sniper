import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BotEngine } from "./engine.ts";
import { DEFAULT_CONFIG } from "./settings.ts";
import { DEFAULT_ALLOW_TXT, EMPTY_ALLOW_TXT } from "./allowlist.ts";
import { leftoverValueSol } from "./models.ts";
import {
  ALLOW_CREATOR,
  OTHER_CREATOR,
  PRESETS,
  runPreset,
} from "./replay.ts";
import type { MarketSnapshot, TokenCreate } from "./models.ts";

const ORIGIN = Date.parse("2026-08-27T10:00:00Z");

function engine(cfg: Partial<typeof DEFAULT_CONFIG> = {}, allowText = DEFAULT_ALLOW_TXT) {
  return new BotEngine({
    config: { ...DEFAULT_CONFIG, ...cfg },
    allowText,
    now: ORIGIN,
  });
}

function create(partial: Partial<TokenCreate> = {}): TokenCreate {
  return {
    mint: "MintBiz111111111111111111111111111111111",
    creator: ALLOW_CREATOR,
    name: "Biz",
    symbol: "BIZ",
    ts: ORIGIN,
    socials: { twitter: "https://x.com/biz" },
    ...partial,
  };
}

function snap(e: BotEngine, mint: string, mcap: number, extra: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    ts: e.now,
    mint,
    mcap,
    unique_buyers: extra.unique_buyers ?? 40,
    unique_buyers_prev: extra.unique_buyers_prev ?? 36,
    buy_sol: extra.buy_sol ?? 8,
    sell_sol: extra.sell_sol ?? 3,
    dev_token_balance: extra.dev_token_balance ?? 1_000_000_000,
    liquidity_gone: extra.liquidity_gone ?? false,
    graduated: extra.graduated ?? false,
    smart_net_sell: extra.smart_net_sell ?? false,
    name: "Biz",
    symbol: "BIZ",
    creator: ALLOW_CREATOR,
    socials: { twitter: "https://x.com/biz" },
    ...extra,
  };
}

function buyAt(e: BotEngine, mcap = 5600, mint = "MintBiz111111111111111111111111111111111") {
  e.onCreate(create({ mint }));
  e.onSnapshot(snap(e, mint, mcap));
  return e.positions.get(mint)!;
}

describe("allow-list entry", () => {
  it("not on allow-list → no buy", () => {
    const e = engine({ dry_run_any_socials: false });
    e.onCreate(create({ creator: OTHER_CREATOR, symbol: "XYZ", name: "Xyz" }));
    e.onSnapshot(snap(e, "MintBiz111111111111111111111111111111111", 5600, { creator: OTHER_CREATOR }));
    const pos = [...e.positions.values()].find((p) => p.phase !== "CLOSED" && p.phase !== "DETECTED");
    assert.equal(pos, undefined);
    assert.ok(e.logs.some((l) => l.level === "SKIP" && l.reason === "not_on_allowlist"));
    assert.ok(!e.logs.some((l) => l.level === "BUY"));
  });

  it("dry-run paper-any-socials buys a non-allow coin that has socials", () => {
    const e = engine({ dry_run: true, live: false, dry_run_any_socials: true });
    const mint = "MintPaper11111111111111111111111111111111";
    e.onCreate(
      create({
        mint,
        creator: OTHER_CREATOR,
        symbol: "PAPER",
        name: "Paper",
        socials: { twitter: "https://x.com/paper" },
      }),
    );
    e.onSnapshot(
      snap(e, mint, 5600, {
        creator: OTHER_CREATOR,
        socials: { twitter: "https://x.com/paper" },
        name: "Paper",
        symbol: "PAPER",
      }),
    );
    const pos = e.positions.get(mint);
    assert.ok(pos);
    assert.notEqual(pos!.phase, "CLOSED");
    assert.ok(e.logs.some((l) => l.level === "BUY" && l.reason === "paper_any_socials"));
  });

  it("live ignores paper-any-socials and still requires the allow-list", () => {
    const e = engine({ dry_run: false, live: true, dry_run_any_socials: true });
    e.onCreate(create({ creator: OTHER_CREATOR, symbol: "XYZ", name: "Xyz" }));
    e.onSnapshot(snap(e, "MintBiz111111111111111111111111111111111", 5600, { creator: OTHER_CREATOR }));
    assert.ok(e.logs.some((l) => l.reason === "not_on_allowlist"));
    assert.ok(!e.logs.some((l) => l.level === "BUY"));
  });

  it("no socials → no buy", () => {
    const e = engine();
    e.onCreate(create({ socials: {} }));
    e.onSnapshot(snap(e, create().mint, 5600, { socials: {} }));
    assert.ok(!e.logs.some((l) => l.level === "BUY"));
    assert.ok(e.logs.some((l) => l.reason === "no_socials"));
  });

  it("mcap 15k at decision → skip chase", () => {
    const e = engine();
    const c = create();
    e.onCreate(c);
    e.onSnapshot(snap(e, c.mint, 15000));
    assert.ok(!e.logs.some((l) => l.level === "BUY"));
    assert.ok(e.logs.some((l) => l.reason === "chase_mcap"));
  });
});

describe("live any-socials universe", () => {
  it("live with the toggle buys a non-allow coin that has socials", async () => {
    const e = engine({ dry_run: false, live: true, dry_run_any_socials: false, live_any_socials: true });
    e.setWalletStatus({ keyConfigured: true, liveEnabled: true, publicKey: "BotWallet" });
    const mint = "MintAnyLive1111111111111111111111111111111";
    e.onCreate(
      create({
        mint,
        creator: OTHER_CREATOR,
        symbol: "ANY",
        name: "Any",
        socials: { twitter: "https://x.com/any" },
      }),
    );
    e.onSnapshot(
      snap(e, mint, 5600, {
        creator: OTHER_CREATOR,
        socials: { twitter: "https://x.com/any" },
        name: "Any",
        symbol: "ANY",
      }),
    );
    await e.settleUnsettled();
    assert.ok(e.logs.some((l) => l.level === "BUY" && l.reason === "live_any_socials"));
  });

  it("live without the toggle still skips non-allow coins", () => {
    const e = engine({ dry_run: false, live: true, live_any_socials: false });
    e.onCreate(create({ creator: OTHER_CREATOR, symbol: "XYZ", name: "Xyz" }));
    e.onSnapshot(snap(e, "MintBiz111111111111111111111111111111111", 5600, { creator: OTHER_CREATOR }));
    assert.ok(!e.logs.some((l) => l.level === "BUY"));
    assert.ok(e.logs.some((l) => l.reason === "not_on_allowlist"));
  });

  it("live with the toggle still requires socials", () => {
    const e = engine({ dry_run: false, live: true, live_any_socials: true });
    e.onCreate(create({ socials: {} }));
    e.onSnapshot(snap(e, create().mint, 5600, { socials: {} }));
    assert.ok(!e.logs.some((l) => l.level === "BUY"));
    assert.ok(e.logs.some((l) => l.reason === "no_socials"));
  });

  it("dry-run ignores live_any_socials", () => {
    const e = engine({ dry_run: true, live: false, dry_run_any_socials: false, live_any_socials: true });
    e.onCreate(create({ creator: OTHER_CREATOR, symbol: "XYZ", name: "Xyz" }));
    e.onSnapshot(snap(e, "MintBiz111111111111111111111111111111111", 5600, { creator: OTHER_CREATOR }));
    assert.ok(!e.logs.some((l) => l.level === "BUY"));
    assert.ok(e.logs.some((l) => l.reason === "not_on_allowlist"));
  });

  it("empty allow-list + toggle → still buys any coin with socials", async () => {
    const e = engine(
      { dry_run: false, live: true, live_any_socials: true },
      EMPTY_ALLOW_TXT,
    );
    e.setWalletStatus({ keyConfigured: true, liveEnabled: true, publicKey: "BotWallet" });
    const mint = "MintNoList11111111111111111111111111111111";
    e.onCreate(
      create({
        mint,
        creator: OTHER_CREATOR,
        symbol: "FREE",
        name: "Free",
        socials: { twitter: "https://x.com/free" },
      }),
    );
    e.onSnapshot(
      snap(e, mint, 5600, {
        creator: OTHER_CREATOR,
        socials: { twitter: "https://x.com/free" },
        name: "Free",
        symbol: "FREE",
      }),
    );
    await e.settleUnsettled();
    assert.ok(e.logs.some((l) => l.level === "BUY" && l.reason === "live_any_socials"));
    assert.ok(!e.logs.some((l) => l.reason === "not_on_allowlist"));
  });

  it("live + dry_run + toggle (half-armed) still skips non-allow coins", () => {
    const e = engine(
      { dry_run: true, live: true, dry_run_any_socials: false, live_any_socials: true },
      EMPTY_ALLOW_TXT,
    );
    const mint = "MintHalf111111111111111111111111111111111";
    e.onCreate(create({ mint, creator: OTHER_CREATOR, symbol: "HALF", name: "Half" }));
    e.onSnapshot(snap(e, mint, 5600, { creator: OTHER_CREATOR, name: "Half", symbol: "HALF" }));
    assert.ok(!e.logs.some((l) => l.level === "BUY"));
    assert.ok(e.logs.some((l) => l.reason === "not_on_allowlist"));
  });
});

describe("flat / dump kill", () => {
  it("still at fill after 20s → sell 100%", () => {
    const e = engine();
    const pos = buyAt(e, 5600);
    e.setNow(ORIGIN + 20_000);
    e.onSnapshot(snap(e, pos.mint, 5600));
    const p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "CLOSED");
    assert.ok(e.logs.some((l) => l.reason === "flat_kill"));
  });

  it("dropped below fill at 20s with no print → sell 100%", () => {
    const e = engine();
    const pos = buyAt(e, 5600);
    e.setNow(ORIGIN + 10_000);
    e.onSnapshot(snap(e, pos.mint, 5200));
    e.setNow(ORIGIN + 20_000);
    e.onSnapshot(snap(e, pos.mint, 4800));
    const p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "CLOSED");
    assert.ok(e.logs.some((l) => l.reason === "dump_kill"));
  });

  it("printed above 1.05× before 20s → keep, even if it chops", () => {
    const e = engine();
    const pos = buyAt(e, 5600);
    e.setNow(ORIGIN + 8_000);
    e.onSnapshot(snap(e, pos.mint, 7200));
    e.setNow(ORIGIN + 20_000);
    e.onSnapshot(snap(e, pos.mint, 5800));
    const p = e.positions.get(pos.mint)!;
    assert.notEqual(p.phase, "CLOSED");
    assert.ok(!e.logs.some((l) => l.reason === "flat_kill" || l.reason === "dump_kill"));
  });

  it("t+10s still flat → do not sell yet", () => {
    const e = engine();
    const pos = buyAt(e, 5600);
    e.setNow(ORIGIN + 10_000);
    e.onSnapshot(snap(e, pos.mint, 5600));
    const p = e.positions.get(pos.mint)!;
    assert.notEqual(p.phase, "CLOSED");
    assert.ok(!e.logs.some((l) => l.reason === "flat_kill"));
  });
});

describe("flatline dead band", () => {
  it("stuck at 3.5k for 25s in shakeout → sell 100%", () => {
    const e = engine();
    const pos = buyAt(e, 5600);
    e.setNow(ORIGIN + 16_000);
    e.onSnapshot(snap(e, pos.mint, 6000));
    e.setNow(ORIGIN + 20_000);
    e.onSnapshot(snap(e, pos.mint, 3500));
    let p = e.positions.get(pos.mint)!;
    assert.notEqual(p.phase, "CLOSED");
    assert.ok(e.logs.some((l) => l.reason === "flatline_start"));
    e.setNow(ORIGIN + 45_000);
    e.onSnapshot(snap(e, pos.mint, 3500));
    p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "CLOSED");
    assert.ok(e.logs.some((l) => l.reason === "flatline_stuck"));
  });

  it("wiggling inside the 3k–4k band still counts as stuck", () => {
    const e = engine();
    const pos = buyAt(e, 5600);
    e.setNow(ORIGIN + 16_000);
    e.onSnapshot(snap(e, pos.mint, 6000));
    e.setNow(ORIGIN + 20_000);
    e.onSnapshot(snap(e, pos.mint, 3500));
    e.setNow(ORIGIN + 27_000);
    e.onSnapshot(snap(e, pos.mint, 3800));
    e.setNow(ORIGIN + 34_000);
    e.onSnapshot(snap(e, pos.mint, 3200));
    e.setNow(ORIGIN + 41_000);
    e.onSnapshot(snap(e, pos.mint, 3600));
    e.setNow(ORIGIN + 48_000);
    e.onSnapshot(snap(e, pos.mint, 3400));
    const p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "CLOSED");
    assert.ok(e.logs.some((l) => l.reason === "flatline_stuck"));
  });

  it("escaping above the band resets the flatline timer", () => {
    const e = engine();
    const pos = buyAt(e, 5600);
    e.setNow(ORIGIN + 16_000);
    e.onSnapshot(snap(e, pos.mint, 6000));
    e.setNow(ORIGIN + 20_000);
    e.onSnapshot(snap(e, pos.mint, 3500));
    e.setNow(ORIGIN + 40_000);
    e.onSnapshot(snap(e, pos.mint, 3500));
    e.setNow(ORIGIN + 41_000);
    e.onSnapshot(snap(e, pos.mint, 5000));
    let p = e.positions.get(pos.mint)!;
    assert.equal(p.flatline_started_ts, null);
    assert.notEqual(p.phase, "CLOSED");
    e.setNow(ORIGIN + 60_000);
    e.onSnapshot(snap(e, pos.mint, 3500));
    e.setNow(ORIGIN + 80_000);
    e.onSnapshot(snap(e, pos.mint, 3500));
    p = e.positions.get(pos.mint)!;
    assert.notEqual(p.phase, "CLOSED");
    e.setNow(ORIGIN + 86_000);
    e.onSnapshot(snap(e, pos.mint, 3500));
    p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "CLOSED");
    assert.ok(e.logs.some((l) => l.reason === "flatline_stuck"));
  });

  it("stuck at 3.5k in seek-rent before rent arms → sell 100%", () => {
    const e = engine();
    const pos = buyAt(e, 5600);
    e.setNow(ORIGIN + 16_000);
    e.onSnapshot(snap(e, pos.mint, 6000));
    e.setNow(ORIGIN + 135_000);
    e.onSnapshot(snap(e, pos.mint, 5600));
    let p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "SEEK_RENT");
    e.setNow(ORIGIN + 140_000);
    e.onSnapshot(snap(e, pos.mint, 3500));
    e.setNow(ORIGIN + 165_000);
    e.onSnapshot(snap(e, pos.mint, 3500));
    p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "CLOSED");
    assert.ok(e.logs.some((l) => l.reason === "flatline_stuck"));
  });
});

describe("rent tag during shakeout", () => {
  it("2.1× during shakeout → SEEK_RENT now, peel fires on next tick", () => {
    const e = engine();
    const pos = buyAt(e, 5600);
    e.setNow(ORIGIN + 16_000);
    e.onSnapshot(snap(e, pos.mint, 6000));
    let p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "SHAKEOUT");
    e.setNow(ORIGIN + 30_000);
    e.onSnapshot(snap(e, pos.mint, 11800));
    p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "SEEK_RENT");
    assert.ok(e.logs.some((l) => l.reason === "rent_tag_in_shakeout"));
    e.setNow(ORIGIN + 31_000);
    e.onSnapshot(snap(e, pos.mint, 11800));
    p = e.positions.get(pos.mint)!;
    assert.equal(p.did_rent_peel, true);
    assert.equal(p.rent_armed, true);
    assert.ok(Math.abs(p.tokens_left / p.tokens_bought - 0.8) < 1e-6);
  });

  it("gapped to 3.5× during shakeout → cap banks 50% initials and goes STUB", () => {
    const e = engine();
    const pos = buyAt(e, 5600);
    e.setNow(ORIGIN + 16_000);
    e.onSnapshot(snap(e, pos.mint, 6000));
    e.setNow(ORIGIN + 40_000);
    e.onSnapshot(snap(e, pos.mint, 19600));
    let p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "SEEK_RENT");
    e.setNow(ORIGIN + 41_000);
    e.onSnapshot(snap(e, pos.mint, 19600));
    p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "STUB");
    assert.equal(p.did_rent, true);
    assert.equal(p.did_trim_3x, true);
    assert.ok(Math.abs(p.tokens_left / p.tokens_bought - 0.5) < 1e-6);
    assert.ok(e.logs.some((l) => l.reason === "rent_110"));
  });

  it("below the tag during shakeout → stays in shakeout, no early jump", () => {
    const e = engine();
    const pos = buyAt(e, 5600);
    e.setNow(ORIGIN + 16_000);
    e.onSnapshot(snap(e, pos.mint, 6000));
    e.setNow(ORIGIN + 60_000);
    e.onSnapshot(snap(e, pos.mint, 7000));
    const p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "SHAKEOUT");
    assert.ok(!e.logs.some((l) => l.reason === "rent_tag_in_shakeout"));
  });
});

describe("open ignore", () => {
  it("first 10s dev sell → no flatten", () => {
    const e = engine();
    const pos = buyAt(e, 5600);
    e.setNow(ORIGIN + 10_000);
    e.onSnapshot(
      snap(e, pos.mint, 4800, { dev_token_balance: 100 }),
    );
    const p = e.positions.get(pos.mint)!;
    assert.notEqual(p.phase, "CLOSED");
    assert.ok(p.phase === "OPEN_IGNORE" || p.phase === "SHAKEOUT");
    assert.ok(!e.logs.some((l) => l.level === "DEAD"));
    assert.ok(!e.logs.some((l) => l.reason === "second_dev_sell"));
    assert.ok(e.logs.some((l) => l.reason === "first_dev_sell_ignored" || l.msg.includes("first_dev_sell")));
  });
});

describe("rent", () => {
  it("fill 5600, mcap 12600 ripping → peel 20%, still SEEK_RENT", () => {
    const e = engine();
    const pos = buyAt(e, 5600);
    e.setNow(ORIGIN + 15_000);
    e.onSnapshot(snap(e, pos.mint, 6000, { dev_token_balance: 500 }));
    e.setNow(ORIGIN + 135_000);
    e.onSnapshot(snap(e, pos.mint, 5500, { dev_token_balance: 500 }));
    e.setNow(ORIGIN + 150_000);
    e.onSnapshot(
      snap(e, pos.mint, 12600, {
        dev_token_balance: 500,
        buy_sol: 9,
        sell_sol: 3,
        unique_buyers: 48,
        unique_buyers_prev: 40,
      }),
    );
    const p = e.positions.get(pos.mint)!;
    assert.equal(p.did_rent_peel, true);
    assert.equal(p.rent_armed, true);
    assert.equal(p.did_rent, false);
    assert.equal(p.phase, "SEEK_RENT");
    assert.ok(Math.abs(p.tokens_left / p.tokens_bought - 0.8) < 1e-6);
    assert.ok(e.logs.some((l) => l.level === "RENT" && l.reason === "rent_peel"));
  });

  it("after peel, sell print completes the 50% initials and goes STUB", () => {
    const e = engine();
    const pos = buyAt(e, 5600);
    e.setNow(ORIGIN + 15_000);
    e.onSnapshot(snap(e, pos.mint, 6000, { dev_token_balance: 500 }));
    e.setNow(ORIGIN + 135_000);
    e.onSnapshot(snap(e, pos.mint, 5500, { dev_token_balance: 500 }));
    e.setNow(ORIGIN + 150_000);
    e.onSnapshot(
      snap(e, pos.mint, 12600, {
        dev_token_balance: 500,
        buy_sol: 9,
        sell_sol: 3,
        unique_buyers: 48,
        unique_buyers_prev: 40,
      }),
    );
    e.setNow(ORIGIN + 155_000);
    e.onSnapshot(
      snap(e, pos.mint, 12400, {
        dev_token_balance: 500,
        buy_sol: 2,
        sell_sol: 6,
        unique_buyers: 36,
        unique_buyers_prev: 48,
      }),
    );
    const p = e.positions.get(pos.mint)!;
    assert.equal(p.did_rent, true);
    assert.equal(p.phase, "STUB");
    assert.ok(Math.abs(p.tokens_left / p.tokens_bought - 0.5) < 1e-6);
    assert.ok(e.logs.some((l) => l.reason === "rent_110"));
  });

  it("ripping tape holds the trail through 2.4× then 3× cap fires", () => {
    const e = engine();
    const pos = buyAt(e, 5600);
    e.setNow(ORIGIN + 15_000);
    e.onSnapshot(snap(e, pos.mint, 6000, { dev_token_balance: 500 }));
    e.setNow(ORIGIN + 135_000);
    e.onSnapshot(snap(e, pos.mint, 5500, { dev_token_balance: 500 }));
    e.setNow(ORIGIN + 150_000);
    e.onSnapshot(
      snap(e, pos.mint, 12600, {
        dev_token_balance: 500,
        buy_sol: 9,
        sell_sol: 2,
        unique_buyers: 40,
        unique_buyers_prev: 32,
      }),
    );
    e.setNow(ORIGIN + 160_000);
    e.onSnapshot(
      snap(e, pos.mint, 14000, {
        dev_token_balance: 500,
        buy_sol: 11,
        sell_sol: 2,
        unique_buyers: 52,
        unique_buyers_prev: 40,
      }),
    );
    let p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "SEEK_RENT");
    assert.equal(p.did_rent, false);
    e.setNow(ORIGIN + 170_000);
    e.onSnapshot(
      snap(e, pos.mint, 16800, {
        dev_token_balance: 500,
        buy_sol: 12,
        sell_sol: 2,
        unique_buyers: 60,
        unique_buyers_prev: 52,
      }),
    );
    p = e.positions.get(pos.mint)!;
    assert.equal(p.did_rent, true);
    assert.equal(p.phase, "STUB");
    assert.equal(p.did_trim_3x, true);
    assert.ok(Math.abs(p.tokens_left / p.tokens_bought - 0.5) < 1e-6);
    assert.ok(e.logs.some((l) => l.msg.includes("cap")));
  });
});

describe("stub wick", () => {
  function rented(e: BotEngine, fill = 5600) {
    const pos = buyAt(e, fill);
    e.setNow(ORIGIN + 15_000);
    e.onSnapshot(snap(e, pos.mint, fill, { dev_token_balance: 800 }));
    e.setNow(ORIGIN + 135_000);
    e.onSnapshot(snap(e, pos.mint, 4800, { dev_token_balance: 800 }));
    e.setNow(ORIGIN + 150_000);
    e.onSnapshot(
      snap(e, pos.mint, 12600, {
        dev_token_balance: 800,
        buy_sol: 9,
        sell_sol: 3,
        unique_buyers: 48,
        unique_buyers_prev: 40,
      }),
    );
    e.setNow(ORIGIN + 152_000);
    e.onSnapshot(
      snap(e, pos.mint, 12400, {
        dev_token_balance: 800,
        buy_sol: 2,
        sell_sol: 6,
        unique_buyers: 36,
        unique_buyers_prev: 48,
      }),
    );
    return e.positions.get(pos.mint)!;
  }

  it("after rent, wick 15600 → 7600 then reclaim 8000 → KEEP", () => {
    const e = engine();
    const pos = rented(e);
    e.setNow(ORIGIN + 160_000);
    e.onSnapshot(snap(e, pos.mint, 15600, { dev_token_balance: 800 }));
    e.setNow(ORIGIN + 165_000);
    e.onSnapshot(snap(e, pos.mint, 7600, { dev_token_balance: 800 }));
    assert.ok(e.logs.some((l) => l.level === "WICK"));
    e.setNow(ORIGIN + 165_000 + 75_000);
    e.onSnapshot(snap(e, pos.mint, 8000, { dev_token_balance: 800, buy_sol: 8, sell_sol: 3 }));
    const p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "STUB");
    assert.ok(e.logs.some((l) => l.level === "KEEP"));
    assert.notEqual(p.phase, "CLOSED");
  });

  it("after rent, break base_low with no reclaim → SELL remaining", () => {
    const e = engine();
    const pos = rented(e);
    const p0 = e.positions.get(pos.mint)!;
    const base = p0.base_low;
    assert.ok(base > 0);
    e.setNow(ORIGIN + 160_000);
    e.onSnapshot(snap(e, pos.mint, 15600, { dev_token_balance: 800 }));
    e.setNow(ORIGIN + 170_000);
    e.onSnapshot(snap(e, pos.mint, 7600, { dev_token_balance: 800 }));
    e.setNow(ORIGIN + 170_000 + 75_000);
    e.onSnapshot(
      snap(e, pos.mint, Math.min(3000, base - 200), {
        dev_token_balance: 800,
        buy_sol: 1,
        sell_sol: 4,
      }),
    );
    const p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "CLOSED");
    assert.ok(
      e.logs.some(
        (l) =>
          l.reason === "wick_no_reclaim" ||
          l.reason === "base_low_break" ||
          l.reason === "sell_flow",
      ),
    );
  });
});

describe("timeouts and second dump", () => {
  it("600s never 2.1× → SELL all NO_RENT", () => {
    const e = engine();
    const pos = buyAt(e, 5600);
    e.setNow(ORIGIN + 15_000);
    e.onSnapshot(snap(e, pos.mint, 6000));
    e.setNow(ORIGIN + 135_000);
    e.onSnapshot(snap(e, pos.mint, 5000));
    e.setNow(ORIGIN + 600_000);
    e.onSnapshot(snap(e, pos.mint, 5000));
    const p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "CLOSED");
    assert.ok(e.logs.some((l) => l.reason === "DEAD_NO_RENT"));
  });

  it("ten DEV sells inside 2 min are not an exit", () => {
    const e = engine();
    const pos = buyAt(e, 6000);
    e.setNow(ORIGIN + 8_000);
    e.onSnapshot(snap(e, pos.mint, 7200, { dev_token_balance: 1_000_000_000 }));
    let bal = 1_000_000_000;
    for (let i = 1; i <= 10; i++) {
      bal = Math.floor(bal * 0.7);
      e.setNow(ORIGIN + i * 10_000);
      e.onSnapshot(snap(e, pos.mint, 6500 + i * 40, { dev_token_balance: bal }));
    }
    const p = e.positions.get(pos.mint)!;
    assert.notEqual(p.phase, "CLOSED");
    assert.ok(!e.logs.some((l) => l.reason === "second_dev_sell"));
    assert.ok(e.logs.some((l) => l.reason === "first_dev_sell_ignored" || l.reason === "dev_sell_ignored"));
  });

  it("DEV sell after 2 min flattens remaining", () => {
    const e = engine();
    const pos = buyAt(e, 6000);
    e.setNow(ORIGIN + 10_000);
    e.onSnapshot(snap(e, pos.mint, 8000, { dev_token_balance: 500 }));
    e.setNow(ORIGIN + 15_000);
    e.onSnapshot(snap(e, pos.mint, 7000, { dev_token_balance: 500 }));
    e.setNow(ORIGIN + 90_000);
    e.onSnapshot(snap(e, pos.mint, 6800, { dev_token_balance: 120 }));
    e.setNow(ORIGIN + 135_000);
    e.onSnapshot(snap(e, pos.mint, 7200, { dev_token_balance: 120 }));
    e.setNow(ORIGIN + 160_000);
    e.onSnapshot(
      snap(e, pos.mint, 13000, {
        dev_token_balance: 120,
        buy_sol: 9,
        sell_sol: 3,
        unique_buyers: 48,
        unique_buyers_prev: 40,
      }),
    );
    e.setNow(ORIGIN + 162_000);
    e.onSnapshot(
      snap(e, pos.mint, 12800, {
        dev_token_balance: 120,
        buy_sol: 2,
        sell_sol: 6,
        unique_buyers: 36,
        unique_buyers_prev: 48,
      }),
    );
    const stub = e.positions.get(pos.mint)!;
    assert.equal(stub.phase, "STUB");
    e.setNow(ORIGIN + 190_000);
    e.onSnapshot(snap(e, pos.mint, 11000, { dev_token_balance: 20 }));
    const p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "CLOSED");
    assert.ok(e.logs.some((l) => l.reason === "second_dev_sell"));
  });

  it("second dev sell after T+15s → SELL remaining", () => {
    const e = engine();
    const pos = buyAt(e, 6000);
    e.setNow(ORIGIN + 10_000);
    e.onSnapshot(snap(e, pos.mint, 8000, { dev_token_balance: 500 }));
    e.setNow(ORIGIN + 15_000);
    e.onSnapshot(snap(e, pos.mint, 7000, { dev_token_balance: 500 }));
    e.setNow(ORIGIN + 135_000);
    e.onSnapshot(snap(e, pos.mint, 7200, { dev_token_balance: 500 }));
    e.setNow(ORIGIN + 160_000);
    e.onSnapshot(
      snap(e, pos.mint, 13000, {
        dev_token_balance: 500,
        buy_sol: 9,
        sell_sol: 3,
        unique_buyers: 48,
        unique_buyers_prev: 40,
      }),
    );
    e.setNow(ORIGIN + 162_000);
    e.onSnapshot(
      snap(e, pos.mint, 12800, {
        dev_token_balance: 500,
        buy_sol: 2,
        sell_sol: 6,
        unique_buyers: 36,
        unique_buyers_prev: 48,
      }),
    );
    const stub = e.positions.get(pos.mint)!;
    assert.equal(stub.phase, "STUB");
    e.setNow(ORIGIN + 190_000);
    e.onSnapshot(snap(e, pos.mint, 11000, { dev_token_balance: 80 }));
    const p = e.positions.get(pos.mint)!;
    assert.equal(p.phase, "CLOSED");
    assert.ok(e.logs.some((l) => l.reason === "second_dev_sell"));
  });
});

describe("graduation", () => {
  it("complete/graduated is PumpSwap venue, not a flatten", () => {
    const e = engine();
    const pos = buyAt(e, 5600);
    e.setNow(ORIGIN + 20_000);
    e.onSnapshot(
      snap(e, pos.mint, 9000, {
        graduated: true,
        liquidity_gone: true,
        dev_token_balance: 800,
      }),
    );
    const p = e.positions.get(pos.mint)!;
    assert.notEqual(p.phase, "CLOSED");
    assert.equal(p.venue, "pump-amm");
    assert.ok(!e.logs.some((l) => l.reason === "liquidity_gone"));
    assert.ok(e.logs.some((l) => l.reason === "graduated_pumpswap"));
  });
});

describe("moonbag", () => {
  it("realized ≥ 10× ticket and leftover ≤ 0.20 → phase MOONBAG and no further trims", () => {
    const e = engine();
    const pos = buyAt(e, 5000);
    e.setNow(ORIGIN + 15_000);
    e.onSnapshot(snap(e, pos.mint, 5000, { dev_token_balance: 900 }));
    e.setNow(ORIGIN + 135_000);
    e.onSnapshot(snap(e, pos.mint, 4800, { dev_token_balance: 900 }));
    e.setNow(ORIGIN + 150_000);
    e.onSnapshot(snap(e, pos.mint, 11000, { dev_token_balance: 900 }));
    // Jump through trim ladder at a high multiple so realized is large, then
    // sell down leftover via 10× at a moderate reprint? Directly patch after sells.
    e.setNow(ORIGIN + 180_000);
    e.onSnapshot(snap(e, pos.mint, 15000, { dev_token_balance: 900 }));
    e.setNow(ORIGIN + 200_000);
    e.onSnapshot(snap(e, pos.mint, 25000, { dev_token_balance: 900 }));
    e.setNow(ORIGIN + 220_000);
    e.onSnapshot(snap(e, pos.mint, 50000, { dev_token_balance: 900 }));
    let p = e.positions.get(pos.mint)!;
    // Force the accounting condition: inject a large realized + small leftover.
    p.realized_sol = 0.55;
    p.did_trim_3x = true;
    p.did_trim_5x = true;
    p.did_trim_10x = true;
    p.tokens_left = p.tokens_bought * 0.02;
    p.phase = "STUB";
    e.positions.set(pos.mint, p);
    e.setNow(ORIGIN + 240_000);
    e.onSnapshot(snap(e, pos.mint, 12000, { dev_token_balance: 900 }));
    p = e.positions.get(pos.mint)!;
    const leftover = leftoverValueSol(p, 12000);
    assert.ok(p.realized_sol >= 0.5);
    assert.ok(leftover <= 0.2);
    assert.equal(p.phase, "MOONBAG");
    const trimsBefore = e.logs.filter((l) => l.level === "TRIM").length;
    e.setNow(ORIGIN + 260_000);
    e.onSnapshot(snap(e, pos.mint, 60000, { dev_token_balance: 900 }));
    const trimsAfter = e.logs.filter((l) => l.level === "TRIM").length;
    assert.equal(trimsAfter, trimsBefore);
    assert.equal(e.positions.get(pos.mint)!.phase, "MOONBAG");
  });
});

describe("risk", () => {
  it("daily loss limit blocks new buys", () => {
    const e = engine();
    e.risk.dailyPnl = -0.25;
    const c = create({ mint: "MintTwo111111111111111111111111111111111" });
    e.onCreate(c);
    e.onSnapshot(snap(e, c.mint, 5600));
    assert.ok(!e.logs.some((l) => l.level === "BUY"));
    assert.ok(e.logs.some((l) => l.reason === "daily_loss_limit"));
  });
});

describe("presets", () => {
  it("Runner_Biz_like walks BUY → ignore → shakeout → RENT → KEEP → trims → MOONBAG", () => {
    const e = engine();
    const preset = PRESETS.find((p) => p.id === "Runner_Biz_like")!;
    runPreset(e, preset, ORIGIN);
    const levels = e.logs.map((l) => l.level);
    assert.ok(levels.includes("SEEN"));
    assert.ok(levels.includes("BUY"));
    assert.ok(levels.includes("OPEN"));
    assert.ok(levels.includes("SHAKE"));
    assert.ok(levels.includes("RENT"));
    assert.ok(levels.includes("WICK"));
    assert.ok(levels.includes("KEEP"));
    assert.ok(levels.includes("TRIM"));
    assert.ok(levels.includes("MOON") || levels.includes("MOONBAG"));
    const pos = e.positions.get(preset.token.mint)!;
    assert.equal(pos.phase, "MOONBAG");
    assert.ok(pos.did_rent);
    assert.ok(pos.did_trim_3x);
  });

  it("NonRunner_no_rent → DEAD_NO_RENT", () => {
    const e = engine();
    const preset = PRESETS.find((p) => p.id === "NonRunner_no_rent")!;
    runPreset(e, preset, ORIGIN);
    assert.ok(e.logs.some((l) => l.reason === "DEAD_NO_RENT"));
    assert.equal(e.positions.get(preset.token.mint)!.phase, "CLOSED");
  });

  it("Shakeout_death → full exit during shakeout", () => {
    const e = engine();
    const preset = PRESETS.find((p) => p.id === "Shakeout_death")!;
    runPreset(e, preset, ORIGIN);
    assert.ok(e.logs.some((l) => l.reason === "shakeout_dead_mcap" || l.reason === "hard_death_from_fill"));
    assert.equal(e.positions.get(preset.token.mint)!.phase, "CLOSED");
  });

  it("Second_dev_sell → stub flattened", () => {
    const e = engine();
    const preset = PRESETS.find((p) => p.id === "Second_dev_sell")!;
    runPreset(e, preset, ORIGIN);
    assert.ok(e.logs.some((l) => l.reason === "second_dev_sell"));
    assert.equal(e.positions.get(preset.token.mint)!.phase, "CLOSED");
  });

  it("Death_zone_fade → remaining flattened in 20–50k band", () => {
    const e = engine();
    const preset = PRESETS.find((p) => p.id === "Death_zone_fade")!;
    if (!e.allow.has(preset.creator!)) {
      e.allow.entries.push({ original: preset.creator!, key: preset.creator!.toLowerCase(), label: "fade" });
    }
    runPreset(e, preset, ORIGIN);
    assert.ok(e.logs.some((l) => l.reason === "rent_110"));
    assert.ok(
      e.logs.some(
        (l) =>
          l.reason === "death_zone_fade" ||
          l.reason === "death_zone_stall" ||
          l.level === "THINK",
      ),
    );
    assert.equal(e.positions.get(preset.token.mint)!.phase, "CLOSED");
  });

  it("Fake_rip_2.1x peels then banks remaining initials on the sell print", () => {
    const e = engine();
    const preset = PRESETS.find((p) => p.id === "Fake_rip_2.1x")!;
    runPreset(e, preset, ORIGIN);
    assert.ok(e.logs.some((l) => l.reason === "rent_peel"));
    assert.ok(e.logs.some((l) => l.reason === "rent_110"));
    const pos = e.positions.get(preset.token.mint)!;
    assert.equal(pos.did_rent, true);
    assert.equal(pos.phase, "STUB");
    assert.ok(Math.abs(pos.tokens_left / pos.tokens_bought - 0.5) < 1e-6);
    assert.equal(pos.did_trim_3x, false);
  });

  it("Rip_hold_to_3x peels then banks remaining initials at the 3× cap", () => {
    const e = engine();
    const preset = PRESETS.find((p) => p.id === "Rip_hold_to_3x")!;
    runPreset(e, preset, ORIGIN);
    assert.ok(e.logs.some((l) => l.reason === "rent_peel"));
    assert.ok(e.logs.some((l) => l.reason === "rent_110" && l.msg.includes("cap")));
    const pos = e.positions.get(preset.token.mint)!;
    assert.equal(pos.did_rent, true);
    assert.equal(pos.phase, "STUB");
    assert.equal(pos.did_trim_3x, true);
    assert.ok(Math.abs(pos.tokens_left / pos.tokens_bought - 0.5) < 1e-6);
  });

  it("Cheshire_70_dump arms a moonbag and does not flatten the 70% dump", () => {
    const e = engine();
    const preset = PRESETS.find((p) => p.id === "Cheshire_70_dump")!;
    runPreset(e, preset, ORIGIN);
    const pos = e.positions.get(preset.token.mint)!;
    assert.equal(pos.phase, "MOONBAG");
    assert.ok(pos.did_rent);
    assert.notEqual(pos.phase, "CLOSED");
    assert.ok(!e.logs.some((l) => l.reason === "death_zone_fade" || l.reason === "death_zone_stall"));
  });
});
