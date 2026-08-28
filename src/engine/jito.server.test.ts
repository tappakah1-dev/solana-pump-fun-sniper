import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { signatureFromSignedTx } from "./jito.server.ts";

describe("signatureFromSignedTx", () => {
  it("extracts the signature from a legacy signed tx", () => {
    const kp = Keypair.generate();
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: kp.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1000,
      }),
    );
    tx.feePayer = kp.publicKey;
    tx.recentBlockhash = PublicKey.default.toString();
    tx.sign(kp);
    const b64 = Buffer.from(tx.serialize()).toString("base64");
    assert.equal(signatureFromSignedTx(b64), bs58.encode(tx.signature!));
  });

  it("extracts the signature from a versioned signed tx", () => {
    const kp = Keypair.generate();
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: kp.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1000,
      }),
    );
    tx.feePayer = kp.publicKey;
    tx.recentBlockhash = PublicKey.default.toString();
    const v = new VersionedTransaction(tx.compileMessage());
    v.sign([kp]);
    const b64 = Buffer.from(v.serialize()).toString("base64");
    assert.equal(signatureFromSignedTx(b64), bs58.encode(v.signatures[0]!));
  });

  it("returns null for garbage input", () => {
    assert.equal(signatureFromSignedTx(Buffer.from("not a tx").toString("base64")), null);
    assert.equal(signatureFromSignedTx(""), null);
  });
});
