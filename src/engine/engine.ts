import type {
  BotConfig,
  Intent,
  LogEvent,
  MarketSnapshot,
  Position,
  StrategyEvent,
  TokenCreate,
} from "./models.ts";
import { emptyPosition, isOpenPhase, leftoverValueSol } from "./models.ts";
import { AllowList } from "./allowlist.ts";
import { DEFAULT_CONFIG } from "./settings.ts";
import { createRiskState, openPositionCount, type RiskState } from "./risk.ts";
import { decide, moonbagReady } from "./strategy.ts";
import { applyIntent, liveArmed, DryRunAdapter, type SwapAdapter } from "./executor.ts";
import { looksLikeSecret } from "./logger.ts";

export interface EngineOpts {
  config?: BotConfig;
  allowText?: string;
  smartText?: string;
  now?: number;
}

export class BotEngine {
  config: BotConfig;
  allow: AllowList;
  smart: AllowList;
  positions = new Map<string, Position>();
  logs: LogEvent[] = [];
  now: number;
  running = false;
  marketAlive = true;
  listenerConnected = false;
  walletSol: number;
  risk: RiskState;
  /** Server env wallet. Secret never stored here. */
  keyConfigured = false;
  liveEnvEnabled = false;
  walletPublicKey: string | null = null;
  rpcProvider: "helius" | "custom" | "public" = "public";
  operatorRequired = false;
  operatorWalletCount = 0;
  swap: SwapAdapter = new DryRunAdapter();
  private unsettled: { intent: Intent; snap?: MarketSnapshot }[] = [];

  constructor(opts: EngineOpts = {}) {
    this.config = opts.config ?? { ...DEFAULT_CONFIG };
    this.allow = new AllowList(opts.allowText ?? "");
    this.smart = new AllowList(opts.smartText ?? "");
    this.now = opts.now ?? Date.now();
    this.walletSol = this.config.starting_wallet_sol;
    this.risk = createRiskState();
  }

  setNow(ts: number) {
    this.now = ts;
  }

  setConfig(cfg: BotConfig) {
    this.config = cfg;
  }

  setAllow(text: string) {
    this.allow.reload(text);
  }

  setSmart(text: string) {
    this.smart.reload(text);
  }

  setWalletStatus(s: {
    keyConfigured: boolean;
    liveEnabled: boolean;
    publicKey: string | null;
    rpcProvider?: "helius" | "custom" | "public";
    operatorRequired?: boolean;
    operatorWalletCount?: number;
  }) {
    this.keyConfigured = s.keyConfigured;
    this.liveEnvEnabled = s.liveEnabled;
    this.walletPublicKey = s.publicKey;
    if (s.rpcProvider) this.rpcProvider = s.rpcProvider;
    if (s.operatorRequired != null) this.operatorRequired = s.operatorRequired;
    if (s.operatorWalletCount != null) this.operatorWalletCount = s.operatorWalletCount;
  }

  setKeyMaterial(_value: string) {
    /* Keys live in Vercel env only. */
  }

  getKeyMaterial(): string | null {
    return null;
  }

  hasKeyLoaded(): boolean {
    return this.keyConfigured && this.liveEnvEnabled;
  }

  clearKey() {
    /* env-only */
  }

  isLiveArmed(): boolean {
    return liveArmed({
      liveFlag: this.config.live,
      dryRun: this.config.dry_run,
    });
  }

  openCount(): number {
    return openPositionCount(this.positions.values());
  }

  positionList(): Position[] {
    return [...this.positions.values()].sort((a, b) => b.fill_ts - a.fill_ts);
  }

  patchPosition(mint: string, fields: Partial<Position>) {
    const pos = this.positions.get(mint);
    if (!pos) return;
    this.positions.set(mint, { ...pos, ...fields });
  }

  private mintFromEvent(ev: StrategyEvent): string | undefined {
    if (ev.type === "CREATE") return ev.create.mint;
    if (ev.type === "SNAPSHOT") return ev.snapshot.mint;
    if (ev.type === "PANIC_FLATTEN") return undefined;
    return ev.mint;
  }

  dispatch(event: StrategyEvent): Intent[] {
    const mint = this.mintFromEvent(event);
    const position = mint ? this.positions.get(mint) ?? null : null;
    const snap = event.type === "SNAPSHOT" ? event.snapshot : undefined;
    const isReplay =
      (event.type === "CREATE" && Boolean(event.replay)) ||
      (event.type === "SNAPSHOT" && Boolean(event.replay));
    const intents = decide({
      now: this.now,
      event,
      config: this.config,
      allowHas: (c) => this.allow.has(c),
      position,
      allPositions: this.positionList(),
      risk: this.risk,
      marketAlive: this.marketAlive,
      allowUnstarted: isReplay,
      isReplay,
    });
    this.applyAll(intents, snap);
    return intents;
  }

  onCreate(create: TokenCreate, replay = false): Intent[] {
    return this.dispatch({ type: "CREATE", create, replay });
  }

  onSnapshot(snapshot: MarketSnapshot, replay = false): Intent[] {
    return this.dispatch({ type: "SNAPSHOT", snapshot, replay });
  }

  sell25(mint: string) {
    return this.dispatch({ type: "MANUAL_SELL_25", mint });
  }

  sell50(mint: string) {
    return this.dispatch({ type: "MANUAL_SELL_50", mint });
  }

  sellAll(mint: string) {
    return this.dispatch({ type: "MANUAL_SELL_ALL", mint });
  }

  forceMoonbag(mint: string) {
    return this.dispatch({ type: "FORCE_MOONBAG", mint });
  }

  panic(includeMoonbags: boolean) {
    return this.dispatch({ type: "PANIC_FLATTEN", includeMoonbags });
  }

  applyAll(intents: Intent[], snap?: MarketSnapshot) {
    const wallet = { value: this.walletSol };
    for (const intent of intents) {
      if (
        this.isLiveArmed() &&
        (intent.kind === "BUY" || intent.kind === "SELL_ALL" || intent.kind === "SELL_FRACTION")
      ) {
        if (!this.hasKeyLoaded()) {
          this.pushError("live_key_missing", intent.mint ?? "");
          continue;
        }
        this.unsettled.push({ intent, snap });
        continue;
      }
      const mint = intent.mint;
      const pos = mint ? this.positions.get(mint) ?? null : null;

      if (intent.kind === "SET_PHASE" && intent.phase === "DETECTED" && mint && !pos) {
        const p = emptyPosition({
          mint,
          name: intent.fields?.name ?? intent.token ?? "TOKEN",
          symbol: intent.fields?.symbol ?? intent.token ?? "TKN",
          creator: intent.creator ?? "",
          socials: intent.fields?.socials ?? {},
          last_reason: "detected",
          last_action: "DETECTED",
          local_high: intent.mcap ?? 0,
        });
        this.positions.set(mint, p);
        this.appendLogs(applyIntent(intent, this.config, this.now, this.risk, p, snap, wallet).logs);
        continue;
      }

      const result = applyIntent(intent, this.config, this.now, this.risk, pos, snap, wallet);
      this.appendLogs(result.logs);
      if (result.position && mint) {
        if (intent.kind === "SKIP" && (pos?.phase === "DETECTED" || result.position.phase === "DETECTED")) {
          this.positions.delete(mint);
          continue;
        }
        this.positions.set(mint, result.position);
        this.maybeArmMoonbag(result.position, snap);
      }
    }
    this.walletSol = wallet.value;
  }

  async settleUnsettled(): Promise<void> {
    const batch = this.unsettled.splice(0);
    if (!batch.length) return;
    const wallet = { value: this.walletSol };
    for (const { intent, snap } of batch) {
      const mint = intent.mint ?? "";
      const pos = mint ? this.positions.get(mint) ?? null : null;
      try {
        if (intent.kind === "BUY") {
          const r = await this.swap.buy(mint, this.config.ticket_sol);
          if (!r.ok) {
            this.risk.buyAttempted.add(mint);
            this.pushError(r.error || "live_buy_failed", mint);
            continue;
          }
          intent.fillSol = r.sol ?? this.config.ticket_sol;
          intent.fields = {
            ...intent.fields,
            tokens_bought: r.tokens,
            tokens_left: r.tokens,
            fill_sol: intent.fillSol,
          };
        } else if (intent.kind === "SELL_ALL" || intent.kind === "SELL_FRACTION") {
          const fraction = intent.kind === "SELL_ALL" ? 1 : Math.min(1, Math.max(0, intent.fraction ?? 0));
          const r = await this.swap.sell(mint, fraction, pos?.tokens_left);
          if (!r.ok) {
            this.pushError(r.error || "live_sell_failed", mint);
            continue;
          }
          intent.soldSol = r.sol;
        }
        const result = applyIntent(intent, this.config, this.now, this.risk, pos, snap, wallet);
        this.appendLogs(result.logs);
        if (result.position && mint) {
          this.positions.set(mint, result.position);
          this.maybeArmMoonbag(result.position, snap);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "live_exec_failed";
        this.pushError(looksLikeSecret(msg) ? "live_exec_failed" : msg, mint);
      }
    }
    this.walletSol = wallet.value;
  }

  private maybeArmMoonbag(pos: Position, snap?: MarketSnapshot) {
    if (pos.phase !== "STUB") return;
    const mcap = snap?.mcap ?? pos.local_high;
    if (!moonbagReady(pos, mcap, this.config)) return;
    pos.phase = "MOONBAG";
    pos.last_reason = "moonbag_armed";
    pos.last_action = "MOONBAG";
    const leftover = leftoverValueSol(pos, mcap);
    const already = this.logs.some(
      (l) => l.mint === pos.mint && l.level === "MOON" && l.reason === "moonbag_armed" && Math.abs(l.ts_ms - this.now) < 2,
    );
    if (!already) {
      this.appendLogs(
        applyIntent(
          {
            kind: "SET_PHASE",
            level: "MOON",
            reason: "moonbag_armed",
            msg: `realized=${pos.realized_sol.toFixed(2)} leftover=${leftover.toFixed(2)} forgotten`,
            mint: pos.mint,
            phase: "MOONBAG",
            mcap,
          },
          this.config,
          this.now,
          this.risk,
          pos,
          snap,
          { value: this.walletSol },
        ).logs,
      );
    }
  }

  private appendLogs(logs: LogEvent[]) {
    for (const e of logs) {
      if (looksLikeSecret(e.msg) || looksLikeSecret(e.human)) continue;
      this.logs.push(e);
    }
    if (this.logs.length > 4000) this.logs = this.logs.slice(-3000);
  }

  private pushError(reason: string, mint: string) {
    this.appendLogs(
      applyIntent(
        {
          kind: "LOG_ONLY",
          level: "ERROR",
          reason,
          msg: reason,
          mint,
        },
        this.config,
        this.now,
        this.risk,
        this.positions.get(mint) ?? null,
        undefined,
        { value: this.walletSol },
      ).logs,
    );
  }

  resetBook() {
    this.positions.clear();
    this.risk = createRiskState();
    this.walletSol = this.config.starting_wallet_sol;
  }

  resetLogs() {
    this.logs = [];
  }

  unrealizedSol(pos: Position, mcap: number): number {
    return leftoverValueSol(pos, mcap) - pos.fill_sol * (pos.tokens_left / (pos.tokens_bought || 1));
  }

  snapshotView(pos: Position, mcap: number) {
    return {
      ...pos,
      now_mcap: mcap,
      multiple: pos.fill_mcap ? mcap / pos.fill_mcap : 0,
      leftover: leftoverValueSol(pos, mcap),
      unrealized: this.unrealizedSol(pos, mcap),
      open: isOpenPhase(pos.phase),
    };
  }
}
