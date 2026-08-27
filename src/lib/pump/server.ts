import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PumpCoin, PumpTrade } from "@/engine/pump-map.ts";

const PUMP_COINS = "https://frontend-api-v3.pump.fun";
const PUMP_TRADES = "https://swap-api.pump.fun";

function assertHttpUrl(raw: string, kind: "rpc" | "any"): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${kind}_url_invalid`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`${kind}_url_invalid`);
  return u;
}

async function getJson(url: string, timeoutMs = 12_000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export const fetchRecentCoins = createServerFn({ method: "POST" })
  .validator(z.object({ limit: z.number().min(1).max(50).optional() }))
  .handler(async ({ data }) => {
    const limit = data.limit ?? 40;
    const json = await getJson(
      `${PUMP_COINS}/coins?offset=0&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false`,
    );
    const list = Array.isArray(json) ? json : [];
    return list as PumpCoin[];
  });

export const fetchCoin = createServerFn({ method: "POST" })
  .validator(z.object({ mint: z.string().min(32).max(48) }))
  .handler(async ({ data }) => {
    const json = await getJson(`${PUMP_COINS}/coins/${encodeURIComponent(data.mint)}`);
    if (!json || typeof json !== "object") throw new Error("coin_not_found");
    return json as PumpCoin;
  });

export const fetchTrades = createServerFn({ method: "POST" })
  .validator(z.object({ mint: z.string().min(32).max(48), limit: z.number().min(1).max(50).optional() }))
  .handler(async ({ data }) => {
    const limit = data.limit ?? 40;
    const json = (await getJson(
      `${PUMP_TRADES}/v2/coins/${encodeURIComponent(data.mint)}/trades?limit=${limit}`,
    )) as { trades?: PumpTrade[] };
    return Array.isArray(json?.trades) ? json.trades : [];
  });

export const rpcCall = createServerFn({ method: "POST" })
  .validator(
    z.object({
      rpcUrl: z.string().min(8).max(400),
      method: z.string().min(1).max(64),
      params: z.array(z.unknown()).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { readRpcUrl } = await import("@/engine/wallet-env.server.ts");
    const resolved = readRpcUrl(data.rpcUrl);
    const url = assertHttpUrl(resolved, "rpc");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetch(url.toString(), {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: data.method,
          params: data.params ?? [],
        }),
      });
      const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (json.error) throw new Error(json.error.message || "rpc_error");
      return { payload: JSON.stringify(json.result ?? null) };
    } finally {
      clearTimeout(t);
    }
  });

export const operatorStatus = createServerFn({ method: "POST" })
  .validator(z.object({ session: z.string().max(400).optional() }).optional())
  .handler(async ({ data }) => {
    const { operatorRequired, parseOperatorWallets, verifySession } = await import(
      "@/engine/operator.server.ts"
    );
    const required = operatorRequired();
    const session = verifySession(data?.session);
    return {
      required,
      walletCount: parseOperatorWallets().length,
      connected: session.ok,
      pubkey: session.pubkey ?? null,
    };
  });

export const operatorChallenge = createServerFn({ method: "POST" })
  .validator(z.object({ pubkey: z.string().min(32).max(48) }))
  .handler(async ({ data }) => {
    const { isOperator, operatorRequired, makeChallengeMessage } = await import(
      "@/engine/operator.server.ts"
    );
    if (!operatorRequired()) return { ok: false as const, error: "operator_not_required" };
    if (!isOperator(data.pubkey)) return { ok: false as const, error: "wallet_not_whitelisted" };
    const { message } = makeChallengeMessage(data.pubkey);
    return { ok: true as const, message };
  });

export const operatorVerify = createServerFn({ method: "POST" })
  .validator(
    z.object({
      pubkey: z.string().min(32).max(48),
      message: z.string().min(16).max(500),
      signatureB58: z.string().min(32).max(128),
    }),
  )
  .handler(async ({ data }) => {
    const { verifyOperatorProof } = await import("@/engine/operator.server.ts");
    return verifyOperatorProof(data);
  });

export const walletStatus = createServerFn({ method: "POST" }).handler(async () => {
  const { readBotPrivateKey, liveSendsEnabled, rpcProvider } = await import("@/engine/wallet-env.server.ts");
  const { operatorRequired, parseOperatorWallets } = await import("@/engine/operator.server.ts");
  const key = readBotPrivateKey();
  let publicKey: string | null = null;
  if (key) {
    try {
      const { publicKeyFromMaterial } = await import("@/engine/solana-key.ts");
      publicKey = publicKeyFromMaterial(key);
    } catch {
      publicKey = null;
    }
  }
  return {
    keyConfigured: Boolean(key) && Boolean(publicKey),
    liveEnabled: liveSendsEnabled(),
    publicKey,
    rpcFromEnv: rpcProvider() !== "public",
    rpcProvider: rpcProvider(),
    operatorRequired: operatorRequired(),
    operatorWalletCount: parseOperatorWallets().length,
  };
});

export const fetchWalletBalance = createServerFn({ method: "POST" })
  .validator(z.object({ publicKey: z.string().min(32).max(48), rpcUrl: z.string().min(8).max(400).optional() }))
  .handler(async ({ data }) => {
    const { readRpcUrl } = await import("@/engine/wallet-env.server.ts");
    const rpcUrl = readRpcUrl(data.rpcUrl || "https://solana-rpc.publicnode.com");
    const url = assertHttpUrl(rpcUrl, "rpc");
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [data.publicKey],
      }),
    });
    const json = (await res.json()) as { result?: number | { value?: number } };
    const lamports = typeof json.result === "number" ? json.result : json.result?.value;
    return { sol: typeof lamports === "number" ? lamports / 1e9 : 0 };
  });

async function sendSignedTx(
  rpcUrl: string,
  signed: string,
  jitoTipSol: number | undefined,
): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  if (jitoTipSol && jitoTipSol > 0) {
    const { sendViaJito } = await import("@/engine/jito.server.ts");
    const jito = await sendViaJito(signed);
    if (jito.ok) return jito;
  }
  const url = assertHttpUrl(rpcUrl, "rpc");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [
          signed,
          { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" },
        ],
      }),
    });
    const json = (await res.json()) as { result?: string; error?: { message?: string } };
    if (json.error || !json.result) {
      return { ok: false, error: json.error?.message || "send_failed" };
    }
    return { ok: true, signature: json.result };
  } finally {
    clearTimeout(t);
  }
}

export const executeSwap = createServerFn({ method: "POST" })
  .validator(
    z.object({
      action: z.enum(["buy", "sell"]),
      mint: z.string().min(32).max(48),
      amount: z.number().positive(),
      denominatedInSol: z.boolean(),
      rpcUrl: z.string().min(8).max(400),
      slippagePct: z.number().min(1).max(90).optional(),
      complete: z.boolean().optional(),
      jitoTipSol: z.number().min(0).max(0.05).optional(),
      operatorSession: z.string().max(400).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { readBotPrivateKey, readRpcUrl, liveSendsEnabled, safeSwapError } = await import(
      "@/engine/wallet-env.server.ts"
    );
    const { assertOperatorSession } = await import("@/engine/operator.server.ts");
    const op = assertOperatorSession(data.operatorSession);
    if (!op.ok) return { ok: false as const, tokens: 0, sol: 0, error: op.error };
    if (!liveSendsEnabled()) {
      return { ok: false as const, tokens: 0, sol: 0, error: "live_env_disabled" };
    }
    const key = readBotPrivateKey();
    if (!key) return { ok: false as const, tokens: 0, sol: 0, error: "live_key_missing" };

    try {
      const { publicKeyFromMaterial, signEncodedTx } = await import("@/engine/solana-key.ts");
      const publicKey = publicKeyFromMaterial(key);
      const rpcUrl = readRpcUrl(data.rpcUrl);
      const { buildSwapTransaction } = await import("@/engine/pump-ix.server.ts");
      const built = await buildSwapTransaction({
        action: data.action,
        mint: data.mint,
        publicKey,
        amount: data.amount,
        denominatedInSol: data.denominatedInSol,
        rpcUrl,
        slippagePct: data.slippagePct,
        complete: data.complete,
        jitoTipSol: data.jitoTipSol,
      });
      if (!built.ok || !built.tx) {
        return { ok: false as const, tokens: 0, sol: 0, error: built.error || "swap_build_failed" };
      }
      const signed = signEncodedTx(built.tx, key);
      const sent = await sendSignedTx(rpcUrl, signed, data.jitoTipSol);
      if (!sent.ok) {
        return { ok: false as const, tokens: 0, sol: 0, error: sent.error };
      }
      let tokens = 0;
      if (data.action === "buy") {
        tokens = await tokenBalanceUi(rpcUrl, publicKey, data.mint);
      }
      return {
        ok: true as const,
        tokens,
        sol: data.denominatedInSol ? data.amount : 0,
        signature: sent.signature,
        via: built.via,
      };
    } catch (e) {
      return { ok: false as const, tokens: 0, sol: 0, error: safeSwapError(e) };
    }
  });

async function tokenBalanceUi(rpcUrl: string, owner: string, mint: string): Promise<number> {
  try {
    const url = assertHttpUrl(rpcUrl, "rpc");
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [owner, { mint }, { encoding: "jsonParsed" }],
      }),
    });
    const json = (await res.json()) as {
      result?: {
        value?: {
          account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null; amount: string } } } } };
        }[];
      };
    };
    const amt = json.result?.value?.[0]?.account?.data?.parsed?.info?.tokenAmount;
    if (amt?.uiAmount != null) return amt.uiAmount;
    if (amt?.amount) return Number(amt.amount);
  } catch {
    /* ignore */
  }
  return 0;
}
