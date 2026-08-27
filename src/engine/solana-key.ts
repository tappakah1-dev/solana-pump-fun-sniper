import { Buffer } from "buffer";
import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

if (typeof globalThis.Buffer === "undefined") {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

export function parseKeypair(raw: string): Keypair {
  const t = raw.trim();
  if (!t) throw new Error("key_empty");
  if (t.startsWith("[")) {
    const arr = JSON.parse(t) as number[];
    if (!Array.isArray(arr) || arr.length < 32) throw new Error("key_json_invalid");
    const bytes = Uint8Array.from(arr);
    if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
    if (bytes.length === 32) return Keypair.fromSeed(bytes);
    throw new Error("key_json_len");
  }
  const hex = t.startsWith("0x") ? t.slice(2) : t;
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length >= 64 && hex.length % 2 === 0) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
    if (bytes.length === 32) return Keypair.fromSeed(bytes);
  }
  const decoded = bs58.decode(t);
  if (decoded.length === 64) return Keypair.fromSecretKey(decoded);
  if (decoded.length === 32) return Keypair.fromSeed(decoded);
  throw new Error("unrecognized_key_format");
}

export function publicKeyFromMaterial(raw: string): string {
  return parseKeypair(raw).publicKey.toBase58();
}

export function signEncodedTx(encodedBase64: string, rawKey: string): string {
  const kp = parseKeypair(rawKey);
  const raw = Buffer.from(encodedBase64, "base64");
  try {
    const vtx = VersionedTransaction.deserialize(raw);
    vtx.sign([kp]);
    return Buffer.from(vtx.serialize()).toString("base64");
  } catch {
    const tx = Transaction.from(raw);
    tx.partialSign(kp);
    return tx.serialize().toString("base64");
  }
}
