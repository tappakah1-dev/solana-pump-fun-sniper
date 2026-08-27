import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import bs58 from "bs58";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const SESSION_HOURS = 12;
const CHALLENGE_MS = 5 * 60_000;

function env(name: string): string {
  if (typeof process === "undefined") return "";
  return (process.env[name] || "").trim();
}

export function parseOperatorWallets(raw?: string): string[] {
  const src = raw ?? (env("OPERATOR_WHITELIST") || env("BOT_OPERATOR_WALLETS") || env("BOT_OPERATOR_WHITELIST"));
  if (!src) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of src.split(/[\s,]+/)) {
    const t = part.trim();
    if (!t || t.startsWith("#")) continue;
    if (t.length < 32 || t.length > 48) continue;
    const key = t;
    if (seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    out.push(key);
  }
  return out;
}

export function operatorRequired(): boolean {
  return parseOperatorWallets().length > 0;
}

export function isOperator(pubkey: string): boolean {
  const list = parseOperatorWallets();
  if (!list.length) return true;
  const k = pubkey.trim();
  return list.some((w) => w === k);
}

function sessionSecret(): string {
  return env("BOT_OPERATOR_SECRET") || env("BOT_PRIVATE_KEY") || "allow-exec-preview-secret";
}

export function makeChallengeMessage(pubkey: string): { message: string; ts: number; nonce: string } {
  const ts = Date.now();
  const nonce = randomBytes(16).toString("hex");
  const message = `Allow-Exec operator\nwallet:${pubkey}\nts:${ts}\nnonce:${nonce}`;
  return { message, ts, nonce };
}

export function parseChallengeMessage(message: string): { pubkey: string; ts: number } | null {
  const lines = message.trim().split(/\n/);
  if (lines[0] !== "Allow-Exec operator") return null;
  const wallet = lines.find((l) => l.startsWith("wallet:"))?.slice(7);
  const tsRaw = lines.find((l) => l.startsWith("ts:"))?.slice(3);
  if (!wallet || !tsRaw) return null;
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) return null;
  return { pubkey: wallet, ts };
}

export function verifyEd25519(pubkeyB58: string, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    const raw = Buffer.from(bs58.decode(pubkeyB58));
    if (raw.length !== 32) return false;
    if (signature.length !== 64) return false;
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(message), key, Buffer.from(signature));
  } catch {
    return false;
  }
}

export function issueSession(pubkey: string): string {
  const exp = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const body = `${pubkey}.${exp}`;
  const mac = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifySession(token: string | undefined | null): { ok: boolean; pubkey?: string } {
  if (!token) return { ok: false };
  const parts = token.split(".");
  if (parts.length < 3) return { ok: false };
  const pubkey = parts[0] ?? "";
  const expStr = parts[1] ?? "";
  const mac = parts.slice(2).join(".");
  const body = `${pubkey}.${expStr}`;
  const expect = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
  if (Date.now() > Number(expStr)) return { ok: false };
  if (!isOperator(pubkey)) return { ok: false };
  return { ok: true, pubkey };
}

export function verifyOperatorProof(input: {
  pubkey: string;
  message: string;
  signatureB58: string;
}): { ok: true; session: string; pubkey: string } | { ok: false; error: string } {
  if (!operatorRequired()) {
    return { ok: false, error: "operator_not_required" };
  }
  if (!isOperator(input.pubkey)) {
    return { ok: false, error: "wallet_not_whitelisted" };
  }
  const parsed = parseChallengeMessage(input.message);
  if (!parsed) return { ok: false, error: "challenge_invalid" };
  if (parsed.pubkey !== input.pubkey) return { ok: false, error: "wallet_mismatch" };
  if (Math.abs(Date.now() - parsed.ts) > CHALLENGE_MS) return { ok: false, error: "challenge_expired" };
  let sig: Uint8Array;
  try {
    sig = bs58.decode(input.signatureB58);
  } catch {
    return { ok: false, error: "signature_invalid" };
  }
  const msg = new TextEncoder().encode(input.message);
  if (!verifyEd25519(input.pubkey, msg, sig)) return { ok: false, error: "signature_invalid" };
  return { ok: true, session: issueSession(input.pubkey), pubkey: input.pubkey };
}

export function assertOperatorSession(token: string | undefined | null): { ok: true; pubkey: string } | { ok: false; error: string } {
  if (!operatorRequired()) return { ok: true, pubkey: "" };
  const v = verifySession(token);
  if (!v.ok || !v.pubkey) return { ok: false, error: "operator_required" };
  return { ok: true, pubkey: v.pubkey };
}
