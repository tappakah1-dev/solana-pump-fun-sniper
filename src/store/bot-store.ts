import { create } from "zustand";
import { BotEngine } from "@/engine/engine.ts";
import {
  loadPersistedConfig,
  persistConfig,
} from "@/engine/settings.ts";
import type { BotConfig } from "@/engine/models.ts";
import { DEFAULT_SMART_TXT, EMPTY_ALLOW_TXT, parseAddressFile } from "@/engine/allowlist.ts";
import {
  ALLOW_CREATOR,
  MCAP_SLIDER_MAX,
  MCAP_SLIDER_MIN,
  PRESETS,
  frameToSnapshot,
  interpolatePath,
  makeCreate,
  makeSkipCreate,
  runPreset,
  type ReplayPreset,
} from "@/engine/replay.ts";
import { syntheticSnapshot } from "@/engine/market.ts";
import type { LogEvent, Position } from "@/engine/models.ts";
import { leftoverValueSol, isOpenPhase } from "@/engine/models.ts";
import { startLiveRunner, stopLiveRunner } from "@/engine/live-runner.ts";
import { walletStatus, operatorStatus, operatorChallenge, operatorVerify } from "@/lib/pump/server.ts";
import { deleteAllowDev, listAllowDevs, saveAllowDev } from "@/lib/allow-dev/server.ts";
import type { TapeRow } from "@/engine/pump-map.ts";
import { listInjectedWallets, connectInjected, signOperatorMessage, explainWalletError } from "@/lib/solana-wallet.ts";

const LS_ALLOW = "allow-exec-devs-v2";
const LS_SMART = "allow-exec-smart-v1";
const SS_OPERATOR = "allow-exec-op-session";

function readLs(key: string, fallback: string): string {
  if (typeof localStorage === "undefined") return fallback;
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function readSs(key: string): string {
  if (typeof sessionStorage === "undefined") return "";
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeSs(key: string, value: string) {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export interface RowView {
  pos: Position;
  nowMcap: number;
  multiple: number;
  leftover: number;
  unrealized: number;
}

export interface HistoryView {
  pos: Position;
  peakMult: number;
  net: number;
}

export interface PnlPoint {
  ts: number;
  net: number;
  total: number;
  symbol: string;
  reason: string;
}

interface BotState {
  engine: BotEngine;
  tick: number;
  config: BotConfig;
  allowText: string;
  smartText: string;
  understood: boolean;
  livePhrase: string;
  running: boolean;
  mcapSlider: number;
  replayT: number;
  replayPlaying: boolean;
  activePresetId: string | null;
  replayMint: string | null;
  replayOrigin: number;
  logPaused: boolean;
  logFilter: string;
  settingsOpen: boolean;
  panicOpen: boolean;
  mcaps: Record<string, number>;
  feed: TapeRow[];
  lastPoll: number;
  listenerError: string | null;
  coinsSeen: number;
  operatorSession: string;
  operatorPubkey: string;
  operatorError: string;
  bump: () => void;
  start: () => void;
  stop: () => void;
  persistAll: () => void;
  setConfigField: <K extends keyof BotConfig>(key: K, value: BotConfig[K]) => void;
  setAllowText: (t: string) => void;
  reloadAllow: () => void;
  setSmartText: (t: string) => void;
  setLivePhrase: (t: string) => void;
  confirmLive: () => void;
  refreshWalletStatus: () => Promise<void>;
  connectOperator: () => Promise<void>;
  disconnectOperator: () => void;
  addDevWallet: (addr: string, label?: string) => void;
  addDevWallets: (text: string) => number;
  removeDevWallet: (addr: string) => void;
  setMcapSlider: (n: number) => void;
  simulateAllowCreate: () => void;
  simulateSkipCreate: () => void;
  runNamedPreset: (id: string) => void;
  playReplay: () => void;
  pauseReplay: () => void;
  setReplayT: (t: number) => void;
  sell50: (mint: string) => void;
  sellAll: (mint: string) => void;
  forceMoonbag: (mint: string) => void;
  panic: (includeMoonbags: boolean) => void;
  setLogPaused: (v: boolean) => void;
  setLogFilter: (t: string) => void;
  setSettingsOpen: (v: boolean) => void;
  setPanicOpen: (v: boolean) => void;
  rows: () => RowView[];
  historyRows: () => HistoryView[];
  pnlSeries: () => PnlPoint[];
  allowSynced: boolean;
  syncAllowDevs: () => Promise<void>;
  logs: () => LogEvent[];
  filteredLogs: () => LogEvent[];
  downloadJsonl: () => void;
}

function seedEngine(): { engine: BotEngine; allowText: string; smartText: string; config: BotConfig } {
  const config = loadPersistedConfig();
  const allowText = readLs(LS_ALLOW, EMPTY_ALLOW_TXT);
  const smartText = readLs(LS_SMART, DEFAULT_SMART_TXT);
  const engine = new BotEngine({
    config,
    allowText,
    smartText,
    now: Date.now(),
  });
  return { engine, allowText, smartText, config };
}

function info(engine: BotEngine, reason: string, msg: string) {
  engine.setNow(Date.now());
  engine.applyAll([
    {
      kind: "LOG_ONLY",
      level: "INFO",
      reason,
      msg,
    },
  ]);
}

export const useBotStore = create<BotState>((set, get) => {
  const seeded = seedEngine();
  return {
    engine: seeded.engine,
    tick: 0,
    config: seeded.config,
    allowText: seeded.allowText,
    allowSynced: false,
    smartText: seeded.smartText,
    understood: false,
    livePhrase: "",
    running: false,
    mcapSlider: 6000,
    replayT: 0,
    replayPlaying: false,
    activePresetId: null,
    replayMint: null,
    replayOrigin: Date.now(),
    logPaused: false,
    logFilter: "",
    settingsOpen: false,
    panicOpen: false,

    mcaps: {},
    feed: [],
    lastPoll: 0,
    listenerError: null,
    coinsSeen: 0,
    operatorSession: readSs(SS_OPERATOR),
    operatorPubkey: "",
    operatorError: "",

    bump: () => set({ tick: get().tick + 1, config: get().engine.config }),

    persistAll: () => {
      persistConfig(get().config);
      try {
        localStorage.setItem(LS_ALLOW, get().allowText);
        localStorage.setItem(LS_SMART, get().smartText);
      } catch {
        /* ignore */
      }
    },

    start: () => {
      const { engine, operatorSession } = get();
      if (engine.operatorRequired && !operatorSession) {
        info(engine, "operator_required", "Connect a whitelisted wallet before Start");
        set({ operatorError: "Connect a whitelisted wallet first" });
        get().bump();
        return;
      }
      engine.running = true;
      engine.listenerConnected = true;
      engine.marketAlive = true;
      info(
        engine,
        "listener_started",
        engine.isLiveArmed()
          ? "Pump.fun listener up · live swaps armed"
          : "Pump.fun listener up · dry-run against live mcap",
      );
      set({ running: true, listenerError: null, operatorError: "" });
      startLiveRunner({
        getEngine: () => get().engine,
        bump: () => get().bump(),
        setMcap: (mint, mcap) => {
          set((s) => ({ mcaps: { ...s.mcaps, [mint]: mcap }, tick: s.tick + 1 }));
        },
        setStatus: (s) => {
          set((prev) => ({
            feed: s.feed ?? prev.feed,
            lastPoll: s.lastPoll ?? prev.lastPoll,
            listenerError: s.listenerError === undefined ? prev.listenerError : s.listenerError,
            coinsSeen: s.coinsSeen ?? prev.coinsSeen,
          }));
        },
        getOperatorSession: () => get().operatorSession || undefined,
      });
      get().bump();
    },
    stop: () => {
      const { engine } = get();
      stopLiveRunner();
      engine.running = false;
      engine.listenerConnected = false;
      info(engine, "listener_stopped", "Pump.fun listener down");
      set({ running: false, replayPlaying: false });
      get().bump();
    },

    setConfigField: (key, value) => {
      const cfg = { ...get().config, [key]: value };
      get().engine.setConfig(cfg);
      set({ config: cfg });
      get().persistAll();
      get().bump();
    },

    setAllowText: (t) => set({ allowText: t }),
    reloadAllow: () => {
      get().engine.setAllow(get().allowText);
      get().persistAll();
      get().bump();
    },
    setSmartText: (t) => {
      set({ smartText: t });
      get().engine.setSmart(t);
      get().persistAll();
    },

    setLivePhrase: (t) => set({ livePhrase: t }),
    confirmLive: () => {
      const ok = get().livePhrase.trim() === "I UNDERSTAND";
      get().engine.understood = ok;
      if (ok) {
        if (get().engine.operatorRequired && !get().operatorSession) {
          set({ understood: false, operatorError: "Connect a whitelisted wallet before arming live" });
          get().engine.understood = false;
          get().bump();
          return;
        }
        const cfg = { ...get().config, live: true, dry_run: false };
        get().engine.setConfig(cfg);
        // Fresh live book: paper positions must not occupy live ticket slots
        // or carry paper risk (daily loss, cooldowns) into live trading.
        get().engine.resetBook();
        set({ understood: true, config: cfg });
        get().persistAll();
        void get().refreshWalletStatus();
      } else {
        get().engine.understood = false;
        set({ understood: false });
      }
      get().bump();
    },
    refreshWalletStatus: async () => {
      try {
        const s = await walletStatus();
        get().engine.setWalletStatus(s);
        const session = get().operatorSession;
        const op = await operatorStatus({ data: { session: session || undefined } });
        get().engine.operatorRequired = op.required;
        get().engine.operatorWalletCount = op.walletCount;
        if (op.required && session && !op.connected) {
          writeSs(SS_OPERATOR, "");
          set({ operatorSession: "", operatorPubkey: "", operatorError: "operator session expired" });
        } else if (op.connected && op.pubkey) {
          set({ operatorPubkey: op.pubkey, operatorError: "" });
        }
        get().bump();
      } catch {
        get().engine.setWalletStatus({ keyConfigured: false, liveEnabled: false, publicKey: null });
        get().bump();
      }
    },
    connectOperator: async () => {
      const providers = listInjectedWallets();
      if (!providers.length) {
        set({
          operatorError:
            "No Solana wallet found. Install Phantom or Solflare, unlock it, and refresh. If MetaMask is also installed, disable it on this tab.",
        });
        get().bump();
        return;
      }
      let lastErr = "";
      for (const provider of providers) {
        try {
          const pubkey = await connectInjected(provider);
          if (!pubkey) {
            lastErr = "Wallet did not return a public key";
            continue;
          }
          const ch = await operatorChallenge({ data: { pubkey } });
          if (!ch.ok) {
            set({
              operatorError:
                ch.error === "wallet_not_whitelisted"
                  ? `Connected ${pubkey.slice(0, 4)}…${pubkey.slice(-4)} is not on OPERATOR_WHITELIST. Use the same Phantom you listed, or add this address on Vercel.`
                  : ch.error || "challenge failed",
            });
            get().bump();
            return;
          }
          const signatureB58 = await signOperatorMessage(provider, ch.message);
          const verified = await operatorVerify({ data: { pubkey, message: ch.message, signatureB58 } });
          if (!verified.ok) {
            set({ operatorError: verified.error || "signature rejected" });
            get().bump();
            return;
          }
          writeSs(SS_OPERATOR, verified.session);
          set({ operatorSession: verified.session, operatorPubkey: verified.pubkey, operatorError: "" });
          info(get().engine, "operator_connected", `operator ${pubkey.slice(0, 4)}… connected`);
          get().bump();
          return;
        } catch (e) {
          lastErr = explainWalletError(e);
        }
      }
      set({ operatorError: lastErr || "wallet_connect_failed" });
      get().bump();
    },
    disconnectOperator: () => {
      writeSs(SS_OPERATOR, "");
      set({ operatorSession: "", operatorPubkey: "", operatorError: "" });
      get().bump();
    },
    addDevWallet: (addr, label) => {
      get().addDevWallets(label ? `${addr}  # ${label}` : addr);
    },
    addDevWallets: (text) => {
      const parsed = parseAddressFile(text);
      if (!parsed.length) return 0;
      const existing = new Set(get().engine.allow.entries.map((e) => e.key));
      let next = get().allowText.replace(/\s+$/, "");
      let added = 0;
      for (const e of parsed) {
        if (existing.has(e.key)) continue;
        existing.add(e.key);
        next += `\n${e.label ? `${e.original}  # ${e.label}` : e.original}`;
        added += 1;
        void saveAllowDev({ data: { address: e.key, original: e.original, label: e.label } }).catch(() => {
          /* signed out — browser copy only */
        });
      }
      if (!added) return 0;
      next += "\n";
      get().engine.setAllow(next);
      set({ allowText: next });
      get().persistAll();
      get().bump();
      return added;
    },
    removeDevWallet: (addr) => {
      const key = addr.toLowerCase();
      const next = get()
        .allowText.split(/\r?\n/)
        .filter((line) => {
          const t = line.trim();
          if (!t || t.startsWith("#")) return true;
          const token = (t.split(/[\s#]/)[0] ?? "").toLowerCase();
          return token !== key;
        })
        .join("\n");
      get().engine.setAllow(next);
      set({ allowText: next });
      get().persistAll();
      get().bump();
      void deleteAllowDev({ data: { address: key } }).catch(() => {
        /* signed out — browser copy only */
      });
    },
    syncAllowDevs: async () => {
      try {
        const rows = await listAllowDevs();
        if (!rows) return; // no session — keep the browser copy
        const lines = rows.map((r) => (r.label ? `${r.original ?? r.address}  # ${r.label}` : r.original ?? r.address));
        const allowText = lines.length
          ? `# Trusted DEV wallets — synced from your account.\n${lines.join("\n")}\n`
          : EMPTY_ALLOW_TXT;
        get().engine.setAllow(allowText);
        set({ allowText, allowSynced: true });
        get().persistAll();
        get().bump();
      } catch {
        /* offline — keep the browser copy */
      }
    },

    setMcapSlider: (n) => {
      const mcap = Math.min(MCAP_SLIDER_MAX, Math.max(MCAP_SLIDER_MIN, n));
      const { engine, replayMint } = get();
      set({ mcapSlider: mcap });
      if (replayMint) {
        const pos = engine.positions.get(replayMint);
        if (pos && pos.phase !== "CLOSED") {
          engine.setNow(engine.now + engine.config.hold_poll_seconds * 1000);
          engine.onSnapshot(
            syntheticSnapshot(replayMint, mcap, engine.now, {
              name: pos.name,
              symbol: pos.symbol,
              creator: pos.creator,
              socials: pos.socials,
              unique_buyers: pos.unique_buyers || 40,
              unique_buyers_prev: pos.unique_buyers_prev || 36,
              buy_sol: pos.buy_sol || 6,
              sell_sol: pos.sell_sol || 3,
              dev_token_balance: pos.last_dev_balance || 1_000_000_000,
            }),
            true,
          );
        }
        set((s) => ({ mcaps: { ...s.mcaps, [replayMint]: mcap } }));
      }
      get().bump();
    },

    simulateAllowCreate: () => {
      const { engine, mcapSlider, allowText } = get();
      engine.setAllow(allowText);
      const mint = `SimMint${Date.now()}`;
      const ts = Date.now();
      engine.setNow(ts);
      engine.onCreate(
        {
          mint,
          creator: ALLOW_CREATOR,
          name: "Sim",
          symbol: "SIM",
          ts,
          socials: { twitter: "https://x.com/sim" },
          mcap: mcapSlider,
        },
        true,
      );
      engine.onSnapshot(
        syntheticSnapshot(mint, mcapSlider, ts, {
          name: "Sim",
          symbol: "SIM",
          creator: ALLOW_CREATOR,
          socials: { twitter: "https://x.com/sim" },
        }),
        true,
      );
      set({ replayMint: mint, replayOrigin: ts, replayT: 0, mcaps: { ...get().mcaps, [mint]: mcapSlider } });
      get().bump();
    },

    simulateSkipCreate: () => {
      const { engine } = get();
      const ts = Date.now();
      engine.setNow(ts);
      engine.onCreate(makeSkipCreate(ts), true);
      get().bump();
    },

    runNamedPreset: (id) => {
      const preset = PRESETS.find((p) => p.id === id);
      if (!preset) return;
      const { engine } = get();
      engine.resetBook();
      engine.resetLogs();
      const creator = preset.creator ?? ALLOW_CREATOR;
      if (!engine.allow.has(creator)) {
        engine.allow.entries.push({
          original: creator,
          key: creator.toLowerCase(),
          label: preset.name,
        });
      }
      const origin = Date.now();
      engine.setNow(origin);
      runPreset(engine, preset, origin);
      const last = preset.frames[preset.frames.length - 1];
      set({
        activePresetId: id,
        replayMint: preset.token.mint,
        replayOrigin: origin,
        replayT: last?.t ?? 0,
        mcapSlider: last?.mcap ?? 6000,
        replayPlaying: false,
        mcaps: { ...get().mcaps, [preset.token.mint]: last?.mcap ?? 6000 },
      });
      get().bump();
    },

    playReplay: () => set({ replayPlaying: true }),
    pauseReplay: () => set({ replayPlaying: false }),

    setReplayT: (t) => {
      const { activePresetId, engine, replayOrigin } = get();
      const preset = PRESETS.find((p) => p.id === activePresetId);
      set({ replayT: t });
      if (!preset) return;
      const frame = interpolatePath(preset.frames, t);
      engine.setNow(replayOrigin + t * 1000);
      engine.onSnapshot(frameToSnapshot(preset, frame, replayOrigin), true);
      set((s) => ({
        mcapSlider: frame.mcap,
        mcaps: { ...s.mcaps, [preset.token.mint]: frame.mcap },
      }));
      get().bump();
    },

    sell50: (mint) => {
      const { engine } = get();
      engine.sell50(mint);
      void engine.settleUnsettled().then(() => get().bump());
      get().bump();
    },
    sellAll: (mint) => {
      const { engine } = get();
      engine.sellAll(mint);
      void engine.settleUnsettled().then(() => get().bump());
      get().bump();
    },
    forceMoonbag: (mint) => {
      get().engine.forceMoonbag(mint);
      get().bump();
    },
    panic: (includeMoonbags) => {
      const { engine } = get();
      engine.panic(includeMoonbags);
      void engine.settleUnsettled().then(() => get().bump());
      set({ panicOpen: false });
      get().bump();
    },

    setLogPaused: (v) => set({ logPaused: v }),
    setLogFilter: (t) => set({ logFilter: t }),
    setSettingsOpen: (v) => set({ settingsOpen: v }),
    setPanicOpen: (v) => set({ panicOpen: v }),

    rows: () => {
      const { engine, mcaps, mcapSlider, replayMint } = get();
      return engine
        .positionList()
        .filter((pos) => isOpenPhase(pos.phase))
        .map((pos) => {
        const nowMcap =
          mcaps[pos.mint] ??
          (pos.mint === replayMint ? mcapSlider : pos.last_mcap || pos.fill_mcap);
        const leftover = leftoverValueSol(pos, nowMcap);
        const costLeft = pos.fill_sol * (pos.tokens_left / (pos.tokens_bought || 1));
        return {
          pos,
          nowMcap,
          multiple: pos.fill_mcap ? nowMcap / pos.fill_mcap : 0,
          leftover,
          unrealized: leftover - costLeft,
        };
      });
    },
    historyRows: () => {
      const { engine } = get();
      return engine
        .positionList()
        .filter((pos) => pos.phase === "CLOSED")
        .map((pos) => {
          const peakMult = pos.fill_mcap > 0 ? pos.local_high / pos.fill_mcap : 0;
          return { pos, peakMult, net: pos.realized_sol - pos.fill_sol };
        });
    },
    pnlSeries: () => {
      const { engine } = get();
      const rows = engine
        .positionList()
        .filter((pos) => pos.phase === "CLOSED")
        .map((pos) => ({
          ts: pos.closed_ts || pos.fill_ts,
          net: pos.realized_sol - pos.fill_sol,
          symbol: pos.symbol,
          reason: pos.last_reason || pos.last_action,
        }))
        .filter((r) => r.ts > 0)
        .sort((a, b) => a.ts - b.ts);
      let total = 0;
      return rows.map((r) => {
        total += r.net;
        return { ...r, total };
      });
    },
    logs: () => get().engine.logs,
    filteredLogs: () => {
      const q = get().logFilter.trim().toLowerCase();
      const logs = get().engine.logs;
      if (!q) return logs;
      return logs.filter(
        (l) =>
          l.human.toLowerCase().includes(q) ||
          l.level.toLowerCase().includes(q) ||
          l.reason.toLowerCase().includes(q) ||
          l.token.toLowerCase().includes(q) ||
          l.mint.toLowerCase().includes(q),
      );
    },
    downloadJsonl: () => {
      const { engine } = get();
      const body = engine.logs
        .map((e) => {
          const { human: _h, ts_ms: _t, ...rest } = e;
          void _h;
          void _t;
          return JSON.stringify(rest);
        })
        .join("\n");
      const blob = new Blob([body], { type: "application/jsonl" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "events.jsonl";
      a.click();
      URL.revokeObjectURL(url);
    },
  };
});

export function advanceReplayClock(dtSec: number) {
  const s = useBotStore.getState();
  if (!s.replayPlaying) return;
  const preset: ReplayPreset | undefined = PRESETS.find((p) => p.id === s.activePresetId);
  const maxT = preset ? (preset.frames[preset.frames.length - 1]?.t ?? 600) : 600;
  const next = Math.min(maxT, s.replayT + dtSec);
  s.setReplayT(next);
  if (next >= maxT) useBotStore.setState({ replayPlaying: false });
}

export { makeCreate };
export type { TapeRow };
