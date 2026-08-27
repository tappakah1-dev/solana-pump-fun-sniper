import { PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";

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
    return { ok: true, signature: json.result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "jito_failed" };
  } finally {
    clearTimeout(t);
  }
}
