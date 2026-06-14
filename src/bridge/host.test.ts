// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { verifySignature, type Signature } from "@nockchain/rose-ts";
import { BridgeHost, executeBridgeMethod } from "./host.js";
import type { BridgeResponse } from "./protocol.js";
import { WalletStore } from "../wallet/wallet.js";
import { clearStoredWallet } from "../wallet/storage.js";
import { randomBytes } from "../crypto/webcrypto.js";

const FIXED =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

beforeEach(async () => {
  await clearStoredWallet();
});

async function unlockedWallet(): Promise<WalletStore> {
  const w = new WalletStore();
  await w.create(
    FIXED,
    { credentialId: randomBytes(16), prfOutput: randomBytes(32), label: "Passkey 1" },
    { autoLockMinutes: 0 }
  );
  return w;
}

describe("BridgeHost queue", () => {
  it("enqueues, exposes current, and replies on approve", () => {
    const host = new BridgeHost();
    const replies: BridgeResponse[] = [];
    host.enqueue(
      { id: "a", method: "nock_connect", params: undefined, origin: "https://dapp.example" },
      (r) => replies.push(r)
    );
    expect(host.current()?.id).toBe("a");
    expect(host.current()?.origin).toBe("https://dapp.example");

    host.approve("a", { pkh: "x" });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ kind: "response", id: "a", ok: true, result: { pkh: "x" } });
    expect(host.current()).toBeNull();
  });

  it("replies with an error on reject and rejectAll", () => {
    const host = new BridgeHost();
    const replies: BridgeResponse[] = [];
    host.enqueue({ id: "1", method: "nock_signMessage", params: {}, origin: "o" }, (r) => replies.push(r));
    host.enqueue({ id: "2", method: "nock_signMessage", params: {}, origin: "o" }, (r) => replies.push(r));
    host.reject("1", "nope");
    host.rejectAll("closed");
    expect(replies.map((r) => r.ok)).toEqual([false, false]);
    expect(replies[0].error).toBe("nope");
    expect(replies[1].error).toBe("closed");
  });
});

describe("executeBridgeMethod", () => {
  it("nock_connect returns the active account address", async () => {
    const w = await unlockedWallet();
    const res = (await executeBridgeMethod("nock_connect", undefined, w)) as {
      pkh: string;
      address: string;
    };
    expect(res.pkh).toBe(w.getActiveAccount().pkh);
    expect(res.address).toBe(res.pkh);
  });

  it("nock_signMessage produces a signature that verifies against the account key", async () => {
    const w = await unlockedWallet();
    const message = "hello nockchain";
    const res = (await executeBridgeMethod("nock_signMessage", { message }, w)) as {
      signature: Signature;
      publicKey: string;
    };
    expect(typeof res.publicKey).toBe("string");
    const pub = w.getExtendedKey(w.getActiveAccount().index).publicKey;
    expect(verifySignature(pub, res.signature, message)).toBe(true);
  });

  it("rejects malformed signMessage / signTx params and unknown methods", async () => {
    const w = await unlockedWallet();
    await expect(executeBridgeMethod("nock_signMessage", {}, w)).rejects.toThrow();
    await expect(executeBridgeMethod("nock_signTx", {}, w)).rejects.toThrow();
    await expect(
      executeBridgeMethod("bogus" as never, undefined, w)
    ).rejects.toThrow();
  });

  it("end-to-end: a queued connect request resolves with the signed result", async () => {
    const w = await unlockedWallet();
    const host = new BridgeHost();
    let response: BridgeResponse | null = null;
    host.enqueue(
      { id: "r1", method: "nock_connect", params: undefined, origin: "https://dapp" },
      (r) => (response = r)
    );
    const req = host.current()!;
    const result = await executeBridgeMethod(req.method, req.params, w);
    host.approve(req.id, result);

    expect(response).not.toBeNull();
    const r = response as unknown as BridgeResponse;
    expect(r.ok).toBe(true);
    expect((r.result as { pkh: string }).pkh).toBe(w.getActiveAccount().pkh);
  });
});
