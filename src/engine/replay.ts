import type { MarketSnapshot, TokenCreate } from "./models.ts";
import { BotEngine } from "./engine.ts";

export const ALLOW_CREATOR = "BizCreator1111111111111111111111111111111";
export const FLOP_CREATOR = "FlopCreator11111111111111111111111111111";
export const RUG_CREATOR = "RugCreator111111111111111111111111111111";
export const DUMP_CREATOR = "DumpCreator11111111111111111111111111111";
export const OTHER_CREATOR = "RandomDev9999999999999999999999999999999";
export const FADE_CREATOR = "FadeCreator11111111111111111111111111111";

export interface ReplayKeyframe {
  t: number;
  mcap: number;
  dev_balance?: number;
  unique_buyers?: number;
  unique_buyers_prev?: number;
  buy_sol?: number;
  sell_sol?: number;
  liquidity_gone?: boolean;
  graduated?: boolean;
  smart_net_sell?: boolean;
  label?: string;
}

export interface ReplayPreset {
  id: string;
  name: string;
  blurb: string;
  token: { name: string; symbol: string; mint: string };
  createMcap: number;
  socials: { twitter?: string; telegram?: string; website?: string };
  creator?: string;
  frames: ReplayKeyframe[];
}

const healthy = {
  unique_buyers: 48,
  unique_buyers_prev: 40,
  buy_sol: 9,
  sell_sol: 3,
  dev_balance: 1_000_000_000,
};

export const PRESETS: ReplayPreset[] = [
  {
    id: "Runner_Biz_like",
    name: "Runner_Biz_like",
    blurb: "6k fill → peel 20% at 2.1× → trail on tape → wick KEEP → clips to 100k+ moonbag",
    token: { name: "Biz", symbol: "BIZ", mint: "BizMintRunner11111111111111111111111111" },
    createMcap: 4200,
    socials: { twitter: "https://x.com/biz", website: "https://biz.example" },
    creator: ALLOW_CREATOR,
    frames: [
      { t: 0, mcap: 5600, ...healthy, label: "fill pause" },
      { t: 8, mcap: 7600, ...healthy, dev_balance: 420_000_000, label: "first dev sell" },
      { t: 15, mcap: 6400, ...healthy, dev_balance: 420_000_000, label: "T+15s" },
      { t: 40, mcap: 5800, ...healthy, dev_balance: 420_000_000, label: "shakeout chop" },
      { t: 90, mcap: 4800, unique_buyers: 36, unique_buyers_prev: 40, buy_sol: 4, sell_sol: 5, dev_balance: 420_000_000, label: "shakeout low" },
      { t: 135, mcap: 5200, ...healthy, dev_balance: 420_000_000, label: "shakeout end" },
      { t: 150, mcap: 12200, ...healthy, dev_balance: 420_000_000, label: "rent print" },
      { t: 165, mcap: 14500, ...healthy, dev_balance: 420_000_000, label: "local high" },
      { t: 180, mcap: 7250, unique_buyers: 44, unique_buyers_prev: 48, buy_sol: 5, sell_sol: 6, dev_balance: 420_000_000, label: "−50% wick" },
      { t: 255, mcap: 8000, ...healthy, dev_balance: 420_000_000, label: "reclaim" },
      { t: 280, mcap: 17400, ...healthy, dev_balance: 420_000_000, label: "3×" },
      { t: 310, mcap: 29000, ...healthy, dev_balance: 420_000_000, label: "5×" },
      { t: 350, mcap: 80000, ...healthy, dev_balance: 420_000_000, label: "runner" },
      { t: 420, mcap: 190000, ...healthy, dev_balance: 420_000_000, label: "ATH stretch" },
      { t: 480, mcap: 155000, ...healthy, dev_balance: 420_000_000, label: "give-back" },
    ],
  },
  {
    id: "NonRunner_no_rent",
    name: "NonRunner_no_rent",
    blurb: "6k → 8k → 5k, sit until 600s DEAD_NO_RENT",
    token: { name: "Flop", symbol: "FLOP", mint: "FlopMint11111111111111111111111111111111" },
    createMcap: 4100,
    socials: { telegram: "https://t.me/flop" },
    creator: FLOP_CREATOR,
    frames: [
      { t: 0, mcap: 6000, ...healthy, label: "fill" },
      { t: 15, mcap: 7400, ...healthy, label: "open ignore end" },
      { t: 80, mcap: 8000, ...healthy, label: "local" },
      { t: 135, mcap: 5200, unique_buyers: 22, unique_buyers_prev: 30, buy_sol: 2, sell_sol: 3, label: "seek rent" },
      { t: 300, mcap: 5000, unique_buyers: 18, unique_buyers_prev: 22, buy_sol: 1, sell_sol: 2, label: "chop" },
      { t: 600, mcap: 5000, unique_buyers: 12, unique_buyers_prev: 18, buy_sol: 0.4, sell_sol: 1.2, label: "timeout" },
    ],
  },
  {
    id: "Shakeout_death",
    name: "Shakeout_death",
    blurb: "6k → 12k → 2.8k dead during shakeout",
    token: { name: "Rug", symbol: "RUG", mint: "RugMint111111111111111111111111111111111" },
    createMcap: 4500,
    socials: { website: "https://rug.example" },
    creator: RUG_CREATOR,
    frames: [
      { t: 0, mcap: 6000, ...healthy, label: "fill" },
      { t: 15, mcap: 9000, ...healthy, label: "ignore end" },
      { t: 25, mcap: 12000, ...healthy, label: "spike" },
      { t: 40, mcap: 2800, unique_buyers: 8, unique_buyers_prev: 40, buy_sol: 0.2, sell_sol: 4, label: "dead" },
    ],
  },
  {
    id: "Second_dev_sell",
    name: "Second_dev_sell",
    blurb: "DEV dumps in the first 2 min are ignored; a dump after 2 min flattens",
    token: { name: "Dump", symbol: "DMP", mint: "DumpMint1111111111111111111111111111111" },
    createMcap: 4300,
    socials: { twitter: "https://x.com/dump" },
    creator: DUMP_CREATOR,
    frames: [
      { t: 0, mcap: 6000, ...healthy, label: "fill" },
      { t: 10, mcap: 8800, ...healthy, dev_balance: 500_000_000, label: "first sell ignored" },
      { t: 40, mcap: 7000, ...healthy, dev_balance: 200_000_000, label: "more DEV sells ignored" },
      { t: 90, mcap: 6500, ...healthy, dev_balance: 120_000_000, label: "still inside 2 min" },
      { t: 135, mcap: 7200, ...healthy, dev_balance: 120_000_000, label: "2 min baseline" },
      { t: 160, mcap: 13000, ...healthy, dev_balance: 120_000_000, label: "rent" },
      { t: 190, mcap: 11000, unique_buyers: 30, unique_buyers_prev: 40, buy_sol: 3, sell_sol: 3, dev_balance: 20_000_000, label: "DEV sell after 2 min" },
    ],
  },
  {
    id: "Death_zone_fade",
    name: "Death_zone_fade",
    blurb: "Rents at 12.6k, stalls and dies around 30k — agent sells remaining",
    token: { name: "Fade", symbol: "FADE", mint: "FadeMint1111111111111111111111111111111" },
    createMcap: 4400,
    socials: { twitter: "https://x.com/fade" },
    creator: FADE_CREATOR,
    frames: [
      { t: 0, mcap: 5600, ...healthy, label: "fill" },
      { t: 15, mcap: 6000, ...healthy, label: "ignore end" },
      { t: 135, mcap: 5200, ...healthy, label: "shakeout end" },
      { t: 150, mcap: 12600, ...healthy, label: "rent" },
      { t: 170, mcap: 32000, ...healthy, label: "30k print" },
      { t: 190, mcap: 28000, unique_buyers: 30, unique_buyers_prev: 48, buy_sol: 1, sell_sol: 6, label: "roll over" },
      { t: 210, mcap: 24000, unique_buyers: 22, unique_buyers_prev: 30, buy_sol: 0.6, sell_sol: 5, label: "fade 1" },
      { t: 230, mcap: 21000, unique_buyers: 16, unique_buyers_prev: 22, buy_sol: 0.4, sell_sol: 4, label: "fade 2" },
      { t: 250, mcap: 18000, unique_buyers: 10, unique_buyers_prev: 16, buy_sol: 0.2, sell_sol: 4, label: "death zone" },
    ],
  },
  {
    id: "Fake_rip_2.1x",
    name: "Fake_rip_2.1x",
    blurb: "Peel 20% at 2.1×, then a sell print banks the rest of initials — no 3× hold",
    token: { name: "FakeRip", symbol: "FAKE", mint: "FakeRipMint1111111111111111111111111111" },
    createMcap: 4300,
    socials: { twitter: "https://x.com/fakerip" },
    creator: ALLOW_CREATOR,
    frames: [
      { t: 0, mcap: 5600, ...healthy, label: "fill" },
      { t: 15, mcap: 6400, ...healthy, label: "ignore end" },
      { t: 135, mcap: 5200, ...healthy, label: "shakeout end" },
      { t: 150, mcap: 12200, ...healthy, label: "2.1× peel" },
      { t: 165, mcap: 12000, unique_buyers: 36, unique_buyers_prev: 48, buy_sol: 2, sell_sol: 7, label: "sell print" },
      { t: 220, mcap: 9800, unique_buyers: 22, unique_buyers_prev: 36, buy_sol: 1, sell_sol: 4, label: "fade" },
    ],
  },
  {
    id: "Rip_hold_to_3x",
    name: "Rip_hold_to_3x",
    blurb: "Peel 20% at 2.1×, hold the trail through 2.4× / 2.7×, bank remaining initials at the 3× cap",
    token: { name: "RipHold", symbol: "RIP", mint: "RipHoldMint111111111111111111111111111" },
    createMcap: 4300,
    socials: { twitter: "https://x.com/riphold" },
    creator: ALLOW_CREATOR,
    frames: [
      { t: 0, mcap: 5600, ...healthy, label: "fill" },
      { t: 15, mcap: 6400, ...healthy, label: "ignore end" },
      { t: 135, mcap: 5200, ...healthy, label: "shakeout end" },
      { t: 150, mcap: 12200, unique_buyers: 40, unique_buyers_prev: 32, buy_sol: 9, sell_sol: 2, dev_balance: 1_000_000_000, label: "2.1× peel" },
      { t: 160, mcap: 14500, unique_buyers: 52, unique_buyers_prev: 40, buy_sol: 11, sell_sol: 2, dev_balance: 1_000_000_000, label: "2.5× hold" },
      { t: 168, mcap: 15900, unique_buyers: 58, unique_buyers_prev: 52, buy_sol: 12, sell_sol: 2, dev_balance: 1_000_000_000, label: "2.75× hold" },
      { t: 176, mcap: 17400, unique_buyers: 64, unique_buyers_prev: 58, buy_sol: 13, sell_sol: 2, dev_balance: 1_000_000_000, label: "3× cap" },
    ],
  },
  {
    id: "Cheshire_70_dump",
    name: "Cheshire_70_dump",
    blurb: "Runner to ~120k, moonbag armed, then a 70% dump — dust rides, fat stub would have died",
    token: { name: "Cheshire", symbol: "CHSH", mint: "CheshireMint11111111111111111111111111" },
    createMcap: 4400,
    socials: { twitter: "https://x.com/cheshire" },
    creator: ALLOW_CREATOR,
    frames: [
      { t: 0, mcap: 5600, ...healthy, label: "fill" },
      { t: 15, mcap: 6000, ...healthy, label: "ignore end" },
      { t: 135, mcap: 5200, ...healthy, label: "shakeout end" },
      { t: 150, mcap: 12600, ...healthy, label: "2.1× peel" },
      { t: 155, mcap: 12400, unique_buyers: 36, unique_buyers_prev: 48, buy_sol: 2, sell_sol: 6, label: "rent complete" },
      { t: 180, mcap: 18000, ...healthy, label: "3×" },
      { t: 210, mcap: 30000, ...healthy, label: "5×" },
      { t: 250, mcap: 56000, ...healthy, label: "10×" },
      { t: 300, mcap: 120000, ...healthy, label: "moon print" },
      { t: 360, mcap: 90000, unique_buyers: 44, unique_buyers_prev: 48, buy_sol: 4, sell_sol: 6, label: "roll" },
      { t: 480, mcap: 60000, unique_buyers: 28, unique_buyers_prev: 44, buy_sol: 1, sell_sol: 8, label: "distribution" },
      { t: 600, mcap: 36000, unique_buyers: 16, unique_buyers_prev: 28, buy_sol: 0.4, sell_sol: 7, label: "−70% dump" },
    ],
  },
];

export function makeCreate(preset: ReplayPreset, ts: number): TokenCreate {
  return {
    mint: preset.token.mint,
    creator: preset.creator ?? ALLOW_CREATOR,
    name: preset.token.name,
    symbol: preset.token.symbol,
    ts,
    socials: preset.socials,
    mcap: preset.createMcap,
  };
}

export function makeSkipCreate(ts: number): TokenCreate {
  return {
    mint: `SkipMint${ts}`,
    creator: OTHER_CREATOR,
    name: "Noise",
    symbol: "NOISE",
    ts,
    socials: { twitter: "https://x.com/noise" },
    mcap: 5200,
  };
}

export function frameToSnapshot(
  preset: ReplayPreset,
  frame: ReplayKeyframe,
  origin: number,
): MarketSnapshot {
  return {
    ts: origin + frame.t * 1000,
    mint: preset.token.mint,
    mcap: frame.mcap,
    unique_buyers: frame.unique_buyers ?? 40,
    unique_buyers_prev: frame.unique_buyers_prev ?? 36,
    buy_sol: frame.buy_sol ?? 6,
    sell_sol: frame.sell_sol ?? 3,
    dev_token_balance: frame.dev_balance ?? 1_000_000_000,
    liquidity_gone: Boolean(frame.liquidity_gone),
    graduated: Boolean(frame.graduated),
    smart_net_sell: Boolean(frame.smart_net_sell),
    name: preset.token.name,
    symbol: preset.token.symbol,
    creator: preset.creator ?? ALLOW_CREATOR,
    socials: preset.socials,
  };
}

export function runPreset(engine: BotEngine, preset: ReplayPreset, origin = engine.now): void {
  engine.setNow(origin);
  const create = makeCreate(preset, origin);
  engine.onCreate(create, true);
  for (const frame of preset.frames) {
    engine.setNow(origin + frame.t * 1000);
    engine.onSnapshot(frameToSnapshot(preset, frame, origin), true);
  }
}

export function interpolatePath(frames: ReplayKeyframe[], t: number): ReplayKeyframe {
  if (!frames.length) return { t, mcap: 6000 };
  if (t <= (frames[0]?.t ?? 0)) return { ...frames[0]!, t };
  const last = frames[frames.length - 1]!;
  if (t >= last.t) return { ...last, t };
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!;
    const b = frames[i]!;
    if (t <= b.t) {
      const u = (t - a.t) / Math.max(0.0001, b.t - a.t);
      return {
        t,
        mcap: a.mcap + (b.mcap - a.mcap) * u,
        dev_balance: b.dev_balance ?? a.dev_balance,
        unique_buyers: b.unique_buyers ?? a.unique_buyers,
        unique_buyers_prev: b.unique_buyers_prev ?? a.unique_buyers_prev,
        buy_sol: b.buy_sol ?? a.buy_sol,
        sell_sol: b.sell_sol ?? a.sell_sol,
        liquidity_gone: b.liquidity_gone ?? a.liquidity_gone,
        graduated: b.graduated ?? a.graduated,
        smart_net_sell: b.smart_net_sell ?? a.smart_net_sell,
      };
    }
  }
  return { ...last, t };
}

export const MCAP_SLIDER_MIN = 2000;
export const MCAP_SLIDER_MAX = 300000;
