import type { BotConfig, Intent, LogEvent, LogLevel, Position } from "./models.ts";
import { fmtTime } from "../lib/utils.ts";

const SECRET_RE =
  /(private[_\s-]?key|secret[_\s-]?key|BOT_PRIVATE_KEY|seed[_\s-]?phrase|mnemonic|begin[a-z ]*private|HELIUS_API_KEY|api-key=)/i;

export function redact(s: string): string {
  if (!s) return s;
  if (SECRET_RE.test(s)) return "[redacted]";
  return s;
}

export function looksLikeSecret(s: string): boolean {
  return SECRET_RE.test(s);
}

export function levelPad(level: LogLevel): string {
  return level.padEnd(6, " ");
}

export function humanLine(tsMs: number, level: LogLevel, msg: string): string {
  return `${fmtTime(tsMs)} ${levelPad(level)} ${msg}`;
}

export function intentToLog(
  intent: Intent,
  now: number,
  cfg: BotConfig,
  pos?: Position | null,
): LogEvent {
  const mcap = intent.mcap ?? null;
  const fill = intent.fill_mcap ?? pos?.fill_mcap ?? null;
  const multiple =
    intent.multiple ?? (mcap && fill ? mcap / fill : null);
  const iso = new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z");
  const msg = redact(intent.msg);
  return {
    ts: iso,
    ts_ms: now,
    level: intent.level,
    mint: intent.mint ?? pos?.mint ?? "",
    creator: intent.creator ?? pos?.creator ?? "",
    token: intent.token ?? pos?.symbol ?? pos?.name ?? "",
    phase: intent.phase ?? pos?.phase ?? "",
    msg,
    reason: intent.reason,
    mcap,
    fill_mcap: fill,
    multiple,
    realized_sol: intent.realized_sol ?? pos?.realized_sol ?? null,
    tokens_left: intent.tokens_left ?? pos?.tokens_left ?? null,
    base_low: intent.base_low ?? pos?.base_low ?? null,
    dry_run: cfg.dry_run || !cfg.live,
    human: humanLine(now, intent.level, msg),
  };
}

export function toJsonl(e: LogEvent): string {
  const { human: _h, ts_ms: _t, ...rest } = e;
  void _h;
  void _t;
  return JSON.stringify(rest);
}

export const LOG_TONE: Record<LogLevel, string> = {
  SEEN: "seen",
  SKIP: "skip",
  BUY: "buy",
  OPEN: "open",
  SHAKE: "shake",
  RENT: "rent",
  WICK: "wick",
  KEEP: "keep",
  TRIM: "trim",
  THINK: "think",
  DEAD: "dead",
  SELL: "dead",
  MOON: "moon",
  MOONBAG: "moon",
  ERROR: "error",
  INFO: "seen",
  SMART: "wick",
  PANIC: "dead",
};
