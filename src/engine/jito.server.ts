import { PublicKey, SystemProgram, Transaction, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";

/** Official Jito tip accounts. Pick one at random per tx. */
export const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiAdgGHtoAae4h5AwBrYq",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yf6jQ6ys6bk7Ud92H6xkivSfnPjSWQKFqtKu",
  "DfXygSm4jCyNCyb6YYYDCaoNFhFfELhyp375oSKgbVTY",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDc4D",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jL",
].map((k) => new PublicKey(k));

const JITO_SEND = "https://mainnet.block-engine.jito.wtf/api/v1/transactions";

export function jitoTipLamports(sol: number | undefined): number {
  if (!sol || !Number.isFinite(sol) || sol <= 0) return 0;
  return Math.max(1, Math.round(sol * 1e9));
}

export function jitoTipIx(from: PublicKey, tipSol: number | undefined): TransactionInstruction | null {
  const lamports = jitoTipLamports(tipSol);
  if (lamports <= 0) return null;
  const dest = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]!;
  return SystemProgram.transfer({ fromPubkey: from, toPubkey: dest, lamports });
}

export async function sendViaJito(signedBase64: string): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(JITO_SEND, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [signedBase64, { encoding: "base64" }],
      }),
    });
    const json = (await res.json()) as { result?: string; error?: { message?: string } };
    if (json.error || !json.result) {
      return { ok: false, error: json.error?.message || `jito_${res.status}` };
    }
    // json.result is the bundle id, not a tx signature. Callers confirm on-chain.
    return { ok: true, signature: json.result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "jito_failed" };
  } finally {
    clearTimeout(t);
  }
}

/** The real tx signature, recovered from the signed tx bytes. Jito returns a bundle id instead. */
export function signatureFromSignedTx(signedBase64: string): string | null {
  try {
    const buf = Buffer.from(signedBase64, "base64");
    if (buf.length < 65) return null;
    if (buf[0] === 0x80) {
      const v = VersionedTransaction.deserialize(buf);
      const sig = v.signatures[0];
      return sig ? bs58.encode(sig) : null;
    }
    const t = Transaction.from(buf);
    return t.signature ? bs58.encode(t.signature) : null;
  } catch {
    return null;
  }
}

export type ConfirmStatus = "confirmed" | "landed_err" | "not_found";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll getSignatureStatuses until the tx confirms, errors on-chain, or the window closes. */
export async function confirmSignature(rpcUrl: string, signature: string, timeoutMs = 12_000): Promise<ConfirmStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getSignatureStatuses",
          params: [[signature], { searchTransactionHistory: true }],
        }),
      });
      const json = (await res.json()) as {
        result?: { value?: ({ err?: unknown; confirmationStatus?: string } | null)[] };
      };
      const v = json.result?.value?.[0];
      if (v) {
        if (v.err) return "landed_err";
        if (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized") return "confirmed";
      }
    } catch {
      /* poll again */
    }
    await sleep(1500);
  }
  return "not_found";
}
