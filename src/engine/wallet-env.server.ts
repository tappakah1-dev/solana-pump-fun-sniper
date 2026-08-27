import { looksLikeSecret } from "./logger.ts";

export function readBotPrivateKey(): string | null {
  const raw =
    (typeof process !== "undefined" &&
      (process.env.BOT_PRIVATE_KEY || process.env.SOLANA_PRIVATE_KEY)) ||
    "";
  const v = raw.trim();
  return v ? v : null;
}

export function readHeliusApiKey(): string | null {
  const v = (typeof process !== "undefined" && process.env.HELIUS_API_KEY) || "";
  const t = v.trim();
  return t ? t : null;
}

export type RpcProvider = "helius" | "custom" | "public";

export function rpcProvider(): RpcProvider {
  if (readHeliusApiKey()) return "helius";
  const custom = (typeof process !== "undefined" && process.env.SOLANA_RPC_URL) || "";
  if (custom.trim()) return "custom";
  return "public";
}

export function readRpcUrl(fallback: string): string {
  const helius = readHeliusApiKey();
  if (helius) return `https://mainnet.helius-rpc.com/?api-key=${helius}`;
  const raw = (typeof process !== "undefined" && process.env.SOLANA_RPC_URL) || "";
  const v = raw.trim();
  return v || fallback;
}

export function liveSendsEnabled(): boolean {
  const v = ((typeof process !== "undefined" && process.env.BOT_LIVE_ENABLED) || "").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

export function safeSwapError(e: unknown): string {
  const msg = e instanceof Error ? e.message : "swap_failed";
  if (looksLikeSecret(msg) || /private|secret|seed|mnemonic|BOT_PRIVATE|helius|api-key/i.test(msg)) {
    return "swap_failed";
  }
  return msg.slice(0, 180);
}
