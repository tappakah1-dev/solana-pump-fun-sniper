import type { BotEngine } from "./engine.ts";
import type { MarketSnapshot } from "./models.ts";
import { hasSocials } from "./models.ts";
import {
  coinToCreate,
  snapshotFromMarket,
  type PumpCoin,
  type TapeRow,
} from "./pump-map.ts";
import { LiveSwapAdapter, type SwapTransport } from "./executor.ts";
import {
  fetchRecentCoins,
  fetchCoin,
  fetchTrades,
  fetchSolPrice,
  executeSwap,
  fetchWalletBalance,
} from "@/lib/pump/server.ts";

export const DEFAULT_RPC = "https://solana-rpc.publicnode.com";

export function resolveRpc(url: string | undefined | null): string {
  const t = (url ?? "").trim();
  return t || DEFAULT_RPC;
}

export interface LiveRunnerHooks {
  getEngine: () => BotEngine;
  bump: () => void;
  setMcap: (mint: string, mcap: number) => void;
  setStatus: (s: {
    feed?: TapeRow[];
    lastPoll?: number;
    listenerError?: string | null;
    coinsSeen?: number;
  }) => void;
  getOperatorSession?: () => string | undefined;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let posTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = true;
let inFlight = false;
let posInFlight = false;
const seen = new Set<string>();
const prevUnique = new Map<string, number>();
const prevDev = new Map<string, number>();
let consecutiveErrors = 0;
let coinsSeen = 0;
let solUsd = 0;
let solUsdAt = 0;

function makeTransport(getEngine: () => BotEngine, getSession?: () => string | undefined): SwapTransport {
  return {
    async execute(req) {
      const engine = getEngine();
      const pos = engine.positions.get(req.mint);
      return executeSwap({
        data: {
          ...req,
          slippagePct: engine.config.slippage_pct,
          jitoTipSol: engine.config.jito_tip_sol,
          complete: req.complete || pos?.venue === "pump-amm",
          operatorSession: getSession?.(),
        },
      });
    },
  };
}

async function refreshWallet(engine: BotEngine) {
  if (!engine.walletPublicKey) return;
  try {
    const r = await fetchWalletBalance({
      data: { publicKey: engine.walletPublicKey, rpcUrl: resolveRpc(engine.config.rpc_url) },
    });
    if (typeof r.sol === "number" && Number.isFinite(r.sol)) engine.walletSol = r.sol;
  } catch {
    /* keep simulated wallet */
  }
}

async function refreshSolPrice() {
  if (Date.now() - solUsdAt < 15_000 && solUsd > 0) return solUsd;
  try {
    const r = await fetchSolPrice();
    if (r.usd > 0) {
      solUsd = r.usd;
      solUsdAt = Date.now();
    }
  } catch {
    /* keep last */
  }
  return solUsd;
}

async function snapshotMint(engine: BotEngine, mint: string, coinHint?: PumpCoin): Promise<MarketSnapshot | null> {
  const [coin, trades] = await Promise.all([
    coinHint ? Promise.resolve(coinHint) : fetchCoin({ data: { mint } }),
    fetchTrades({ data: { mint, limit: 40 } }).catch(() => [] as Awaited<ReturnType<typeof fetchTrades>>),
  ]);
  const now = Date.now();
  const snap = snapshotFromMarket({
    coin,
    trades,
    now,
    smartHas: (a) => engine.smart.has(a),
    prevUnique: prevUnique.get(mint),
    prevDevBalance: prevDev.get(mint),
    solUsd,
  });
  prevUnique.set(mint, snap.unique_buyers);
  prevDev.set(mint, snap.dev_token_balance);
  return snap;
}

function paperUniverse(engine: BotEngine): boolean {
  const c = engine.config;
  return Boolean(c.dry_run && c.dry_run_any_socials && !c.live);
}

function liveAnyUniverse(engine: BotEngine): boolean {
  const c = engine.config;
  return Boolean(c.live && c.live_any_socials && !c.dry_run);
}

function toTape(coin: PumpCoin, engine: BotEngine): TapeRow {
  const allow = engine.allow.has(coin.creator);
  const socials = hasSocials({
    twitter: coin.twitter || undefined,
    telegram: coin.telegram || undefined,
    website: coin.website || undefined,
  });
  const paper = paperUniverse(engine) && socials && !allow;
  const anyOpen = liveAnyUniverse(engine) && socials && !allow;
  return {
    mint: coin.mint,
    name: coin.name || "TOKEN",
    symbol: coin.symbol || "TKN",
    creator: coin.creator,
    mcap: coin.usd_market_cap ?? coin.market_cap_usd ?? 0,
    ts: coin.created_timestamp,
    allow,
    hasSocials: socials,
    complete: Boolean(coin.complete),
    tag: allow || anyOpen ? "buy" : paper ? "paper" : "skip",
  };
}

async function tick(hooks: LiveRunnerHooks) {
  if (stopped || inFlight) return;
  inFlight = true;
  const engine = hooks.getEngine();
  try {
    await refreshSolPrice();
    if (engine.isLiveArmed() && engine.hasKeyLoaded()) {
      engine.swap = new LiveSwapAdapter(
        () => resolveRpc(engine.config.rpc_url),
        makeTransport(() => hooks.getEngine(), hooks.getOperatorSession),
        {
          getComplete: (mint) => hooks.getEngine().positions.get(mint)?.venue === "pump-amm",
          getTip: () => hooks.getEngine().config.jito_tip_sol,
          getSession: hooks.getOperatorSession,
        },
      );
    }

    const coins = await fetchRecentCoins({ data: { limit: 40 } });
    consecutiveErrors = 0;
    engine.marketAlive = true;
    engine.listenerConnected = true;

    const tape = coins.slice(0, 24).map((c) => toTape(c, engine));
    hooks.setStatus({ feed: tape, lastPoll: Date.now(), listenerError: null, coinsSeen });

    const now = Date.now();
    // Paper-any only takes brand-new creates so the first poll does not dump
    // 3 minutes of Pump inventory into DETECTED. Trusted DEVs keep a longer window.
    const PAPER_WINDOW = 45_000;
    const ALLOW_WINDOW = 12 * 60_000;
    const paper = paperUniverse(engine);
    const anyOpen = liveAnyUniverse(engine);

    for (const coin of coins) {
      if (seen.has(coin.mint)) continue;
      seen.add(coin.mint);
      coinsSeen += 1;
      const age = now - (coin.created_timestamp < 1e12 ? coin.created_timestamp * 1000 : coin.created_timestamp);
      const allow = engine.allow.has(coin.creator);
      const socials = hasSocials({
        twitter: coin.twitter || undefined,
        telegram: coin.telegram || undefined,
        website: coin.website || undefined,
      });

      let ingest = false;
      if (allow && age <= ALLOW_WINDOW) ingest = true;
      else if (
        (paper || anyOpen) &&
        socials &&
        age <= PAPER_WINDOW &&
        engine.openCount() < engine.config.max_open_positions
      ) {
        ingest = true;
      }
      if (!ingest) continue;

      engine.setNow(Date.now());
      engine.onCreate(coinToCreate(coin, Date.now()));

      const snap = await snapshotMint(engine, coin.mint, coin);
      if (snap) {
        engine.setNow(Date.now());
        engine.onSnapshot(snap);
        await engine.settleUnsettled();
        hooks.setMcap(coin.mint, snap.mcap);
        hooks.bump();
      }
    }

    await refreshWallet(engine);
    hooks.setStatus({ lastPoll: Date.now(), coinsSeen, listenerError: null });
    hooks.bump();
  } catch (e) {
    consecutiveErrors += 1;
    if (consecutiveErrors >= 3) engine.marketAlive = false;
    hooks.setStatus({
      listenerError: e instanceof Error ? e.message : "poll_failed",
      lastPoll: Date.now(),
    });
    hooks.bump();
  } finally {
    inFlight = false;
    if (!stopped) {
      const wait = consecutiveErrors ? Math.min(15_000, 2500 * consecutiveErrors) : 2500;
      timer = setTimeout(() => void tick(hooks), wait);
    }
  }
}

async function tickPositions(hooks: LiveRunnerHooks) {
  if (stopped || posInFlight) return;
  posInFlight = true;
  const engine = hooks.getEngine();
  try {
    await refreshSolPrice();
    const open = engine.positionList().filter((p) => p.phase !== "CLOSED" && p.phase !== "DETECTED");
    const fetched = await Promise.all(
      open.map(async (pos) => {
        try {
          const snap = await snapshotMint(engine, pos.mint);
          return { mint: pos.mint, snap };
        } catch {
          return { mint: pos.mint, snap: null };
        }
      }),
    );
    for (const { mint, snap } of fetched) {
      if (!snap || snap.mcap <= 0) continue;
      engine.setNow(Date.now());
      engine.onSnapshot(snap);
      await engine.settleUnsettled();
      hooks.setMcap(mint, snap.mcap);
    }
    if (fetched.some((f) => f.snap)) {
      hooks.setStatus({ lastPoll: Date.now(), listenerError: null });
      hooks.bump();
    }
  } catch {
    /* discovery loop reports listener errors */
  } finally {
    posInFlight = false;
    if (!stopped) {
      posTimer = setTimeout(() => void tickPositions(hooks), 1000);
    }
  }
}

export function startLiveRunner(hooks: LiveRunnerHooks) {
  stopLiveRunner();
  stopped = false;
  const engine = hooks.getEngine();
  engine.running = true;
  engine.listenerConnected = true;
  engine.setNow(Date.now());
  void tick(hooks);
  void tickPositions(hooks);
}

export function stopLiveRunner() {
  stopped = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (posTimer) {
    clearTimeout(posTimer);
    posTimer = null;
  }
}

export function resetLiveSeen() {
  seen.clear();
  prevUnique.clear();
  prevDev.clear();
  coinsSeen = 0;
  consecutiveErrors = 0;
}
