import type { BotConfig, Intent, LogEvent, MarketSnapshot, Position } from "./models.ts";
import { TOKEN_UNIT, emptyPosition, leftoverValueSol } from "./models.ts";
import { applyRealizedDelta, recordBuy, slicePnl, type RiskState } from "./risk.ts";
import { intentToLog } from "./logger.ts";
import { moonbagReady } from "./strategy.ts";

export interface ExecResult {
  logs: LogEvent[];
  position?: Position;
  removed?: boolean;
  walletDelta: number;
}

export function applyIntent(
  intent: Intent,
  cfg: BotConfig,
  now: number,
  risk: RiskState,
  pos: Position | null,
  snap: MarketSnapshot | undefined,
  walletSol: { value: number },
): ExecResult {
  const logs: LogEvent[] = [];
  const silent =
    (intent.reason.endsWith("_tick") && intent.kind === "PATCH") ||
    intent.reason === "detected" ||
    intent.reason === "venue_pumpswap";
  if (!silent && intent.kind !== "PATCH") {
    logs.push(intentToLog(intent, now, cfg, pos));
  } else if (intent.kind === "LOG_ONLY") {
    logs.push(intentToLog(intent, now, cfg, pos));
  }

  if (intent.kind === "LOG_ONLY" || intent.kind === "SKIP") {
    return { logs, walletDelta: 0, position: pos ?? undefined };
  }

  if (intent.kind === "BUY") {
    const mint = intent.mint!;
    const mcap = intent.mcap ?? snap?.mcap ?? 0;
    const fillSol = intent.fillSol ?? intent.fields?.fill_sol ?? cfg.ticket_sol;
    const tokens = intent.fields?.tokens_bought || TOKEN_UNIT;
    const next = emptyPosition({
      mint,
      name: intent.fields?.name ?? intent.token ?? "TOKEN",
      symbol: intent.fields?.symbol ?? intent.token ?? "TKN",
      creator: intent.creator ?? "",
      fill_ts: now,
      fill_mcap: mcap,
      fill_sol: fillSol,
      tokens_bought: tokens,
      tokens_left: intent.fields?.tokens_left || tokens,
      realized_sol: 0,
      phase: "OPEN_IGNORE",
      local_high: mcap,
      last_dev_balance: snap?.dev_token_balance ?? 0,
      socials: intent.fields?.socials ?? {},
      last_reason: intent.reason,
      last_action: "BUY",
      unique_buyers: snap?.unique_buyers ?? 0,
      buy_sol: snap?.buy_sol ?? 0,
      sell_sol: snap?.sell_sol ?? 0,
      venue: snap?.graduated ? "pump-amm" : "curve",
    });
    recordBuy(risk, next.creator, mint, now);
    walletSol.value -= fillSol;
    return { logs, position: next, walletDelta: -fillSol };
  }

  if (!pos) return { logs, walletDelta: 0 };

  if (intent.kind === "PATCH" || intent.kind === "SET_PHASE") {
    const next: Position = {
      ...pos,
      ...intent.fields,
      phase: intent.phase ?? intent.fields?.phase ?? pos.phase,
      last_reason: intent.reason === "open_ignore_tick" || intent.reason.endsWith("_tick")
        ? pos.last_reason
        : intent.reason,
    };
    if (intent.kind === "SET_PHASE" && intent.phase === "MOONBAG") {
      logs.push(
        intentToLog(
          {
            ...intent,
            level: "MOON",
            msg:
              intent.msg ||
              `realized=${next.realized_sol.toFixed(2)} leftover forgotten`,
          },
          now,
          cfg,
          next,
        ),
      );
    }
    return { logs, position: next, walletDelta: 0 };
  }

  if (intent.kind === "SELL_FRACTION" || intent.kind === "SELL_ALL") {
    const mcap = snap?.mcap ?? intent.mcap ?? pos.local_high ?? pos.fill_mcap;
    const fraction = intent.kind === "SELL_ALL" ? 1 : Math.min(1, Math.max(0, intent.fraction ?? 0));
    const soldTokens = pos.tokens_left * fraction;
    const fullVal = leftoverValueSol(pos, mcap);
    const soldSol = intent.soldSol ?? fullVal * fraction;
    const next: Position = {
      ...pos,
      ...intent.fields,
      tokens_left: pos.tokens_left - soldTokens,
      realized_sol: pos.realized_sol + soldSol,
      last_reason: intent.reason,
      last_action: intent.level,
      phase: intent.phase ?? intent.fields?.phase ?? pos.phase,
    };
    const pnl = slicePnl(pos.fill_sol, pos.tokens_bought, soldTokens, soldSol);
    applyRealizedDelta(risk, pnl);
    walletSol.value += soldSol;

    if (intent.kind === "SELL_ALL" || next.tokens_left <= 1e-9) {
      next.tokens_left = 0;
      next.phase = "CLOSED";
      next.last_action = intent.reason;
      const logEvent = logs[logs.length - 1];
      if (logEvent) {
        logEvent.realized_sol = next.realized_sol;
        logEvent.tokens_left = 0;
        logEvent.phase = "CLOSED";
      }
      return { logs, position: next, removed: false, walletDelta: soldSol };
    }

    if (intent.reason === "rent_peel") {
      next.phase = "SEEK_RENT";
      next.did_rent_peel = true;
      next.rent_armed = true;
    }

    if (intent.reason === "rent_110") {
      next.phase = "STUB";
      next.did_rent = true;
      next.did_rent_peel = true;
      next.rent_armed = true;
    }

    if (moonbagReady(next, mcap, cfg) && next.phase !== "MOONBAG") {
      next.phase = "MOONBAG";
      next.last_reason = "moonbag_armed";
      next.last_action = "MOONBAG";
      const leftover = leftoverValueSol(next, mcap);
      logs.push(
        intentToLog(
          {
            kind: "SET_PHASE",
            level: "MOON",
            reason: "moonbag_armed",
            msg: `realized=${next.realized_sol.toFixed(2)} leftover=${leftover.toFixed(2)} forgotten`,
            mint: next.mint,
            creator: next.creator,
            token: next.symbol,
            phase: "MOONBAG",
            mcap,
            fill_mcap: next.fill_mcap,
            realized_sol: next.realized_sol,
            tokens_left: next.tokens_left,
            base_low: next.base_low,
          },
          now,
          cfg,
          next,
        ),
      );
    }

    const last = logs[logs.length - 1];
    if (last && last.level !== "MOON") {
      last.realized_sol = next.realized_sol;
      last.tokens_left = next.tokens_left;
      last.phase = next.phase;
      last.multiple = pos.fill_mcap ? mcap / pos.fill_mcap : last.multiple;
    }
    return { logs, position: next, walletDelta: soldSol };
  }

  return { logs, position: pos, walletDelta: 0 };
}

export interface LiveGate {
  liveFlag: boolean;
  understood: boolean;
  dryRun: boolean;
}

export function liveArmed(g: LiveGate): boolean {
  return g.liveFlag && g.understood && !g.dryRun;
}

export interface SwapAdapter {
  buy(mint: string, sol: number): Promise<{ ok: boolean; tokens: number; sol?: number; error?: string }>;
  sell(mint: string, fraction: number, tokens?: number): Promise<{ ok: boolean; sol: number; error?: string }>;
}

export class DryRunAdapter implements SwapAdapter {
  async buy(_mint: string, _sol: number) {
    return { ok: true, tokens: TOKEN_UNIT };
  }
  async sell(_mint: string, _fraction: number) {
    return { ok: true, sol: 0 };
  }
}

export interface SwapTransport {
  execute(req: {
    action: "buy" | "sell";
    mint: string;
    amount: number;
    denominatedInSol: boolean;
    rpcUrl: string;
    complete?: boolean;
    jitoTipSol?: number;
    operatorSession?: string;
  }): Promise<{ ok: boolean; tokens?: number; sol?: number; error?: string }>;
}

export class LiveSwapAdapter implements SwapAdapter {
  private readonly getRpc: () => string;
  private readonly transport: SwapTransport;
  private readonly extras: {
    getComplete?: (mint: string) => boolean;
    getTip?: () => number;
    getSession?: () => string | undefined;
  };
  constructor(
    getRpc: () => string,
    transport: SwapTransport,
    extras: LiveSwapAdapter["extras"] = {},
  ) {
    this.getRpc = getRpc;
    this.transport = transport;
    this.extras = extras;
  }

  async buy(mint: string, sol: number) {
    const rpc = this.getRpc();
    if (!rpc) return { ok: false, tokens: 0, error: "live_rpc_unconfigured" };
    const r = await this.transport.execute({
      action: "buy",
      mint,
      amount: sol,
      denominatedInSol: true,
      rpcUrl: rpc,
      complete: this.extras.getComplete?.(mint),
      jitoTipSol: this.extras.getTip?.(),
      operatorSession: this.extras.getSession?.(),
    });
    return { ok: r.ok, tokens: r.tokens ?? 0, sol: r.sol, error: r.error };
  }

  async sell(mint: string, fraction: number, tokens?: number) {
    const rpc = this.getRpc();
    if (!rpc) return { ok: false, sol: 0, error: "live_rpc_unconfigured" };
    let amount = tokens ?? 0;
    if (amount > 0) amount = amount * fraction;
    if (amount <= 0) return { ok: false, sol: 0, error: "live_zero_tokens" };
    const r = await this.transport.execute({
      action: "sell",
      mint,
      amount,
      denominatedInSol: false,
      rpcUrl: rpc,
      complete: this.extras.getComplete?.(mint),
      jitoTipSol: this.extras.getTip?.(),
      operatorSession: this.extras.getSession?.(),
    });
    return { ok: r.ok, sol: r.sol ?? 0, error: r.error };
  }
}
