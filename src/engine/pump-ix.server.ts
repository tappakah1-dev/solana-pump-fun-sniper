import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import { jitoTipIx } from "./jito.server.ts";

const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const BUY_EXACT_SOL_IN = Buffer.from([56, 252, 116, 8, 158, 223, 205, 95]);
const SELL_DISC = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);
const INIT_USER_VOL = Buffer.from([94, 6, 202, 115, 255, 96, 232, 183]);

const FEE_CONFIG_CONST = Buffer.from([
  1, 86, 224, 246, 147, 102, 90, 207, 68, 219, 21, 104, 191, 23, 91, 170, 81, 137, 203, 151, 245, 210,
  255, 59, 101, 93, 43, 182, 253, 109, 24, 176,
]);

function pda(seeds: Buffer[], program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, program)[0];
}

export const PUMP_GLOBAL = pda([Buffer.from("global")], PUMP);
export const PUMP_EVENT_AUTH = pda([Buffer.from("__event_authority")], PUMP);
export const PUMP_GLOBAL_VOL = pda([Buffer.from("global_volume_accumulator")], PUMP);
export const PUMP_FEE_CONFIG = pda([Buffer.from("fee_config"), FEE_CONFIG_CONST], FEE_PROGRAM);

function bondingCurvePda(mint: PublicKey) {
  return pda([Buffer.from("bonding-curve"), mint.toBuffer()], PUMP);
}
function creatorVaultPda(creator: PublicKey) {
  return pda([Buffer.from("creator-vault"), creator.toBuffer()], PUMP);
}
function userVolPda(user: PublicKey) {
  return pda([Buffer.from("user_volume_accumulator"), user.toBuffer()], PUMP);
}
function bondingCurveV2Pda(mint: PublicKey) {
  return pda([Buffer.from("bonding-curve-v2"), mint.toBuffer()], PUMP);
}
function ataPda(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey) {
  return pda([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROGRAM);
}

function u64(n: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(typeof n === "bigint" ? n : BigInt(Math.floor(n)));
  return b;
}

function parseBondingCurve(data: Buffer): { creator: PublicKey; complete: boolean; isCashback: boolean } {
  let o = 8;
  o += 8 * 5;
  const complete = data[o] !== 0;
  o += 1;
  const creator = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  o += 1; // mayhem
  const isCashback = data.length > o ? data[o] !== 0 : false;
  return { creator, complete, isCashback };
}

function parseFeeRecipient(data: Buffer): PublicKey {
  return new PublicKey(data.subarray(41, 73));
}

function createAtaIdempotentIx(payer: PublicKey, ata: PublicKey, owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey) {
  return new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

function initUserVolIx(user: PublicKey, vol: PublicKey) {
  return new TransactionInstruction({
    programId: PUMP,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: user, isSigner: false, isWritable: false },
      { pubkey: vol, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: PUMP_EVENT_AUTH, isSigner: false, isWritable: false },
      { pubkey: PUMP, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(INIT_USER_VOL),
  });
}

export interface BuildSwapInput {
  action: "buy" | "sell";
  mint: string;
  publicKey: string;
  amount: number;
  denominatedInSol: boolean;
  rpcUrl: string;
  complete?: boolean;
  slippagePct?: number;
  jitoTipSol?: number;
}

export interface BuildSwapResult {
  ok: boolean;
  tx?: string;
  error?: string;
  via?: "native" | "portal" | "pump-amm";
}

async function buildPortal(input: BuildSwapInput): Promise<BuildSwapResult> {
  const tip = input.jitoTipSol && input.jitoTipSol > 0 ? String(input.jitoTipSol) : "0.0002";
  const pool = input.complete ? "pump-amm" : "auto";
  const body = new URLSearchParams({
    publicKey: input.publicKey,
    action: input.action,
    mint: input.mint,
    amount: String(input.amount),
    denominatedInSol: input.denominatedInSol ? "true" : "false",
    slippage: String(Math.round(input.slippagePct ?? 25)),
    priorityFee: tip,
    pool,
  });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const asText = buf.toString("utf8");
    if (!res.ok) {
      return { ok: false, error: asText.slice(0, 180) || `portal_${res.status}` };
    }
    if (asText.startsWith("{") || asText.startsWith("error") || asText.toLowerCase().includes("bad request")) {
      return { ok: false, error: asText.slice(0, 180) };
    }
    return { ok: true, tx: buf.toString("base64"), via: input.complete ? "pump-amm" : "portal" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "portal_failed" };
  } finally {
    clearTimeout(t);
  }
}

async function buildNative(input: BuildSwapInput): Promise<BuildSwapResult> {
  if (input.complete) return { ok: false, error: "curve_complete" };
  const connection = new Connection(input.rpcUrl, "confirmed");
  const user = new PublicKey(input.publicKey);
  const mint = new PublicKey(input.mint);
  const curve = bondingCurvePda(mint);

  const mintInfo = await connection.getAccountInfo(mint, "confirmed");
  if (!mintInfo) return { ok: false, error: "mint_missing" };
  const tokenProgram = mintInfo.owner.equals(TOKEN_2022) ? TOKEN_2022 : TOKEN;

  const [curveInfo, globalInfo, volInfo] = await Promise.all([
    connection.getAccountInfo(curve, "confirmed"),
    connection.getAccountInfo(PUMP_GLOBAL, "confirmed"),
    connection.getAccountInfo(userVolPda(user), "confirmed"),
  ]);
  if (!curveInfo) return { ok: false, error: "curve_missing" };
  if (!globalInfo) return { ok: false, error: "global_missing" };

  const curveState = parseBondingCurve(Buffer.from(curveInfo.data));
  if (curveState.complete) return { ok: false, error: "curve_complete" };
  const feeRecipient = parseFeeRecipient(Buffer.from(globalInfo.data));
  const creatorVault = creatorVaultPda(curveState.creator);
  const associatedBonding = ataPda(curve, mint, tokenProgram);
  const associatedUser = ataPda(user, mint, tokenProgram);
  const userVol = userVolPda(user);

  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }),
  ];
  const tip = jitoTipIx(user, input.jitoTipSol);
  if (tip) ixs.push(tip);
  if (!volInfo) ixs.push(initUserVolIx(user, userVol));
  ixs.push(createAtaIdempotentIx(user, associatedUser, user, mint, tokenProgram));

  if (input.action === "buy") {
    const lamports = BigInt(Math.round(input.amount * 1e9));
    const data = Buffer.concat([BUY_EXACT_SOL_IN, u64(lamports), u64(1n), Buffer.from([1])]);
    ixs.push(
      new TransactionInstruction({
        programId: PUMP,
        keys: [
          { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
          { pubkey: feeRecipient, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: curve, isSigner: false, isWritable: true },
          { pubkey: associatedBonding, isSigner: false, isWritable: true },
          { pubkey: associatedUser, isSigner: false, isWritable: true },
          { pubkey: user, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: tokenProgram, isSigner: false, isWritable: false },
          { pubkey: creatorVault, isSigner: false, isWritable: true },
          { pubkey: PUMP_EVENT_AUTH, isSigner: false, isWritable: false },
          { pubkey: PUMP, isSigner: false, isWritable: false },
          { pubkey: PUMP_GLOBAL_VOL, isSigner: false, isWritable: false },
          { pubkey: userVol, isSigner: false, isWritable: true },
          { pubkey: PUMP_FEE_CONFIG, isSigner: false, isWritable: false },
          { pubkey: FEE_PROGRAM, isSigner: false, isWritable: false },
        ],
        data,
      }),
    );
  } else {
    const amountTokens = BigInt(Math.max(1, Math.floor(input.amount)));
    const data = Buffer.concat([SELL_DISC, u64(amountTokens), u64(1n)]);
    const keys = [
      { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
      { pubkey: feeRecipient, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: curve, isSigner: false, isWritable: true },
      { pubkey: associatedBonding, isSigner: false, isWritable: true },
      { pubkey: associatedUser, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: creatorVault, isSigner: false, isWritable: true },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
      { pubkey: PUMP_EVENT_AUTH, isSigner: false, isWritable: false },
      { pubkey: PUMP, isSigner: false, isWritable: false },
      { pubkey: PUMP_FEE_CONFIG, isSigner: false, isWritable: false },
      { pubkey: FEE_PROGRAM, isSigner: false, isWritable: false },
    ];
    if (curveState.isCashback) {
      keys.push({ pubkey: userVol, isSigner: false, isWritable: true });
      keys.push({ pubkey: bondingCurveV2Pda(mint), isSigner: false, isWritable: false });
    }
    ixs.push(new TransactionInstruction({ programId: PUMP, keys, data }));
  }

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.feePayer = user;
  tx.recentBlockhash = blockhash;
  tx.add(...ixs);

  const vtx = new VersionedTransaction(tx.compileMessage());
  const sim = await connection.simulateTransaction(vtx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  if (sim.value.err) {
    const logs = (sim.value.logs ?? []).slice(-4).join(" | ");
    return { ok: false, error: `sim_failed ${logs}`.slice(0, 240) };
  }

  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return { ok: true, tx: Buffer.from(raw).toString("base64"), via: "native" };
}

export async function buildSwapTransaction(input: BuildSwapInput): Promise<BuildSwapResult> {
  if (input.complete) {
    const portal = await buildPortal({ ...input, complete: true });
    if (portal.ok) return portal;
    return { ok: false, error: portal.error || "pumpswap_build_failed" };
  }
  const native = await buildNative(input).catch((e: unknown) => ({
    ok: false as const,
    error: e instanceof Error ? e.message : "native_failed",
  }));
  if (native.ok) return native;
  if (native.error === "curve_complete") {
    const amm = await buildPortal({ ...input, complete: true });
    if (amm.ok) return amm;
    return { ok: false, error: amm.error || "curve_complete" };
  }
  const portal = await buildPortal(input);
  if (portal.ok) return portal;
  return { ok: false, error: native.error || portal.error || "swap_build_failed" };
}
