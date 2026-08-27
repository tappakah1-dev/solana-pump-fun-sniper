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
let stopped = true;
let inFlight = false;
const seen = new Set<string>();
const prevUnique = new Map<string, number>();
const prevDev = new Map<string, number>();
let consecutiveErrors = 0;
let coinsSeen = 0;

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

async function snapshotMint(engine: BotEngine, mint: string, coinHint?: PumpCoin): Promise<MarketSnapshot | null> {
  const coin = coinHint ?? (await fetchCoin({ data: { mint } }));
  const trades = await fetchTrades({ data: { mint, limit: 40 } });
  const now = Date.now();
  const snap = snapshotFromMarket({
    coin,
    trades,
    now,
    smartHas: (a) => engine.smart.has(a),
    prevUnique: prevUnique.get(mint),
    prevDevBalance: prevDev.get(mint),
  });
  prevUnique.set(mint, snap.unique_buyers);
  prevDev.set(mint, snap.dev_token_balance);
  return snap;
}

function paperUniverse(engine: BotEngine): boolean {
  const c = engine.config;
  return Boolean(c.dry_run && c.dry_run_any_socials && !c.live);
}

function toTape(coin: PumpCoin, engine: BotEngine): TapeRow {
  const allow = engine.allow.has(coin.creator);
  const socials = hasSocials({
    twitter: coin.twitter || undefined,
    telegram: coin.telegram || undefined,
    website: coin.website || undefined,
  });
  const paper = paperUniverse(engine) && socials && !allow;
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
    tag: allow ? "buy" : paper ? "paper" : "skip",
  };
}

async function tick(hooks: LiveRunnerHooks) {
  if (stopped || inFlight) return;
  inFlight = true;
  const engine = hooks.getEngine();
  try {
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
        paper &&
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
      }
    }

    for (const pos of engine.positionList()) {
      if (pos.phase === "CLOSED") continue;
      try {
        const snap = await snapshotMint(engine, pos.mint);
        if (!snap) continue;
        engine.setNow(Date.now());
        engine.onSnapshot(snap);
        await engine.settleUnsettled();
        hooks.setMcap(pos.mint, snap.mcap);
      } catch {
        /* keep going */
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

export function startLiveRunner(hooks: LiveRunnerHooks) {
  stopLiveRunner();
  stopped = false;
  const engine = hooks.getEngine();
  engine.running = true;
  engine.listenerConnected = true;
  engine.setNow(Date.now());
  void tick(hooks);
}

export function stopLiveRunner() {
  stopped = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

export function resetLiveSeen() {
  seen.clear();
  prevUnique.clear();
  prevDev.clear();
  coinsSeen = 0;
  consecutiveErrors = 0;
}
