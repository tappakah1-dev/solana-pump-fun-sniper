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
      cache: "no-store",
      headers: { accept: "application/json", "cache-control": "no-cache" },
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
      `${PUMP_COINS}/coins?offset=0&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false&_=${Date.now()}`,
    );
    const list = Array.isArray(json) ? json : [];
    return list as PumpCoin[];
  });

export const fetchCoin = createServerFn({ method: "POST" })
  .validator(z.object({ mint: z.string().min(32).max(48) }))
  .handler(async ({ data }) => {
    const json = await getJson(`${PUMP_COINS}/coins/${encodeURIComponent(data.mint)}?_=${Date.now()}`);
    if (!json || typeof json !== "object") throw new Error("coin_not_found");
    return json as PumpCoin;
  });

export const fetchTrades = createServerFn({ method: "POST" })
  .validator(z.object({ mint: z.string().min(32).max(48), limit: z.number().min(1).max(50).optional() }))
  .handler(async ({ data }) => {
    const limit = data.limit ?? 40;
    const json = (await getJson(
      `${PUMP_TRADES}/v2/coins/${encodeURIComponent(data.mint)}/trades?limit=${limit}&_=${Date.now()}`,
    )) as { trades?: PumpTrade[] };
    return Array.isArray(json?.trades) ? json.trades : [];
  });

export const fetchSolPrice = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const json = (await getJson(`${PUMP_COINS}/sol-price?_=${Date.now()}`, 6_000)) as {
      solPrice?: number;
      price?: number;
    };
    const n = Number(json?.solPrice ?? json?.price);
    return { usd: Number.isFinite(n) && n > 0 ? n : 0 };
  } catch {
    return { usd: 0 };
  }
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
  skipPreflight = false,
): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const { signatureFromSignedTx, confirmSignature } = await import("@/engine/jito.server.ts");
  if (jitoTipSol && jitoTipSol > 0) {
    const { sendViaJito } = await import("@/engine/jito.server.ts");
    const jito = await sendViaJito(signed);
    if (jito.ok) {
      const sig = signatureFromSignedTx(signed);
      if (!sig) return jito;
      const status = await confirmSignature(rpcUrl, sig, 12_000);
      if (status === "confirmed") return { ok: true, signature: sig };
      if (status === "landed_err") return { ok: false, error: "tx_landed_error" };
      // Bundle accepted but never landed — send the same signed tx straight to
      // the RPC while the blockhash is still fresh.
    }
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
          { encoding: "base64", skipPreflight, preflightCommitment: "confirmed" },
        ],
      }),
    });
    const json = (await res.json()) as { result?: string; error?: { message?: string } };
    if (json.error || !json.result) {
      const msg = json.error?.message || "";
      const sig = signatureFromSignedTx(signed);
      // The Jito bundle landed while we were polling — that is not a failure.
      if (sig && /already processed/i.test(msg)) return { ok: true, signature: sig };
      return { ok: false, error: msg.slice(0, 180) || "send_failed" };
    }
    // The RPC accepted the tx — but accepted is not landed. Confirm it before
    // reporting success, otherwise the desk books a phantom fill (the buy-side
    // curve estimate would fabricate tokens for a tx that never landed).
    const sig = signatureFromSignedTx(signed) ?? json.result;
    const status = await confirmSignature(rpcUrl, sig, 20_000);
    if (status === "confirmed") return { ok: true, signature: sig };
    if (status === "landed_err") return { ok: false, error: "tx_landed_error" };
    return { ok: false, error: "tx_not_confirmed" };
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
      const sent = await sendSignedTx(rpcUrl, signed, data.jitoTipSol, Boolean(built.simUnverified));
      if (!sent.ok) {
        return { ok: false as const, tokens: 0, sol: 0, error: sent.error };
      }
      let tokens = 0;
      let solProceeds = 0;
      let estimated = false;
      if (data.action === "buy") {
        const bt = await tokenBalanceAfterBuy(rpcUrl, publicKey, data.mint, data.amount);
        tokens = bt.tokens;
        estimated = bt.estimated;
        solProceeds = data.denominatedInSol ? data.amount : 0;
      } else {
        // Sells: the desk must book what actually came back — read the tx's
        // balance delta (net of the Jito tip and fees) from the RPC.
        solProceeds = await solDeltaFromTx(rpcUrl, sent.signature, publicKey);
      }
      return {
        ok: true as const,
        tokens,
        estimated,
        sol: solProceeds,
        signature: sent.signature,
        via: built.via,
      };
    } catch (e) {
      return { ok: false as const, tokens: 0, sol: 0, error: safeSwapError(e) };
    }
  });

/** Read the bot wallet's token balance for a mint (used to repair positions whose fill size was lost). */
export const tokenBalance = createServerFn({ method: "POST" })
  .validator(
    z.object({
      mint: z.string().min(32).max(48),
      publicKey: z.string().min(32).max(48),
      rpcUrl: z.string().min(8).max(400).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { readRpcUrl } = await import("@/engine/wallet-env.server.ts");
    const rpcUrl = readRpcUrl(data.rpcUrl || "https://solana-rpc.publicnode.com");
    return { tokens: await tokenBalanceUi(rpcUrl, data.publicKey, data.mint) };
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * SOL the wallet actually received for a sell — the tx's balance delta, net of
 * the Jito tip and priority fees. Retried briefly: the RPC-send path can land
 * a moment after the signature is returned.
 */
async function solDeltaFromTx(rpcUrl: string, signature: string, userPubkey: string): Promise<number> {
  const url = assertHttpUrl(rpcUrl, "rpc");
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
        }),
      });
      const json = (await res.json()) as {
        result?: {
          meta?: { preBalances?: number[]; postBalances?: number[] };
          transaction?: { message?: { accountKeys?: ({ pubkey: string } | string)[] } };
        } | null;
      };
      const tx = json.result;
      if (tx?.meta?.preBalances && tx.meta.postBalances) {
        const keys = tx.transaction?.message?.accountKeys ?? [];
        const idx = keys.findIndex((k) => (typeof k === "string" ? k : k.pubkey) === userPubkey);
        if (idx >= 0 && tx.meta.preBalances[idx] != null && tx.meta.postBalances[idx] != null) {
          return (tx.meta.postBalances[idx]! - tx.meta.preBalances[idx]!) / 1e9;
        }
      }
    } catch {
      /* retry */
    }
    await sleep(1500);
  }
  return 0;
}

/**
 * Fill size after a live buy. The RPC-send path returns before confirmation,
 * so the first balance read can be 0 (the ATA does not exist yet). Poll until
 * the balance appears, then fall back to a curve estimate so the desk never
 * tracks a real position as zero tokens (which would kill the manual sells).
 */
async function tokenBalanceAfterBuy(
  rpcUrl: string,
  owner: string,
  mint: string,
  solIn: number,
): Promise<{ tokens: number; estimated: boolean }> {
  for (let i = 0; i < 6; i++) {
    const tokens = await tokenBalanceUi(rpcUrl, owner, mint);
    if (tokens > 0) return { tokens, estimated: false };
    await sleep(2_000);
  }
  return { tokens: await curveTokensEstimate(mint, solIn), estimated: true };
}

/** Approximate tokens from the bonding curve state, shaved 3% so a sell never exceeds the real balance. */
async function curveTokensEstimate(mint: string, solIn: number): Promise<number> {
  try {
    const coin = (await fetchCoin({ data: { mint } })) as PumpCoin;
    const vs = Number(coin.virtual_sol_reserves);
    const supply = Number(coin.total_supply) || 1_000_000_000_000_000;
    if (!(vs > 0)) return 0;
    const tokens = supply * ((solIn * 1e9) / vs);
    return Math.max(0, Math.floor(tokens * 0.97));
  } catch {
    return 0;
  }
}
