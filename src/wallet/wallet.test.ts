// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { WalletStore } from "./wallet.js";
import { clearStoredWallet } from "./storage.js";
import { DecryptError, type PrfMaterial } from "../crypto/vault.js";
import { randomBytes } from "../crypto/webcrypto.js";

const FIXED =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const NO_AUTOLOCK = { autoLockMinutes: 0 };

// A stable fake passkey enrollment (raw PRF material) reused to create + unlock.
const KEY: PrfMaterial = { credentialId: randomBytes(16), prfOutput: randomBytes(32), label: "Passkey 1" };
const newKey = (label: string): PrfMaterial => ({
  credentialId: randomBytes(16),
  prfOutput: randomBytes(32),
  label,
});

beforeEach(async () => {
  await clearStoredWallet();
});

describe("WalletStore lifecycle (passwordless)", () => {
  it("creates, persists, and reports initialized", async () => {
    expect(await WalletStore.isInitialized()).toBe(false);
    const w = new WalletStore();
    await w.create(FIXED, KEY, NO_AUTOLOCK);
    expect(w.isUnlocked()).toBe(true);
    expect(await WalletStore.isInitialized()).toBe(true);
    expect(w.getActiveAccount().name).toBe("Account 1");
    expect(w.getActiveAccount().pkh).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it("rejects an invalid mnemonic", async () => {
    const w = new WalletStore();
    await expect(w.create("not valid", KEY, NO_AUTOLOCK)).rejects.toThrow();
  });

  it("locks (wipes memory) and unlocks again with the passkey", async () => {
    const w = new WalletStore();
    await w.create(FIXED, KEY, NO_AUTOLOCK);
    const pkh = w.getActiveAccount().pkh;

    w.lock();
    expect(w.isUnlocked()).toBe(false);
    expect(() => w.getActiveAccount()).toThrow();

    const w2 = new WalletStore();
    await w2.unlockWithPrf(KEY.credentialId, KEY.prfOutput);
    expect(w2.getActiveAccount().pkh).toBe(pkh);
  });

  it("rejects unlock with an unenrolled passkey", async () => {
    const w = new WalletStore();
    await w.create(FIXED, KEY, NO_AUTOLOCK);
    const w2 = new WalletStore();
    await expect(w2.unlockWithPrf(randomBytes(16), randomBytes(32))).rejects.toBeInstanceOf(
      DecryptError
    );
  });

  it("exposes enrolled credential ids while locked", async () => {
    const w = new WalletStore();
    await w.create(FIXED, KEY, NO_AUTOLOCK);
    const ids = await WalletStore.enrolledCredentialIds();
    expect(ids).toHaveLength(1);
    expect([...ids[0]]).toEqual([...KEY.credentialId]);
  });
});

describe("WalletStore accounts", () => {
  it("adds, switches, renames, and persists accounts", async () => {
    const w = new WalletStore();
    await w.create(FIXED, KEY, NO_AUTOLOCK);

    const a2 = await w.addAccount("Savings");
    expect(a2.index).toBe(1);
    expect(w.getActiveAccount().index).toBe(1);
    expect(a2.pkh).not.toBe(w.getAccounts()[0].pkh);

    await w.renameAccount(0, "Main");
    await w.switchAccount(0);
    expect(w.getActiveAccount().name).toBe("Main");

    w.lock();
    const w2 = new WalletStore();
    await w2.unlockWithPrf(KEY.credentialId, KEY.prfOutput);
    expect(w2.getAccounts().map((a) => a.name)).toEqual(["Main", "Savings"]);
  });

  it("hides accounts but refuses to hide the last visible one", async () => {
    const w = new WalletStore();
    await w.create(FIXED, KEY, NO_AUTOLOCK);
    await w.addAccount("Two");
    await w.setAccountHidden(1, true);
    expect(w.getVisibleAccounts().map((a) => a.index)).toEqual([0]);
    await expect(w.setAccountHidden(0, true)).rejects.toThrow();
  });

  it("adds watch-only accounts that can't sign, without disturbing derived indices", async () => {
    const w = new WalletStore();
    await w.create(FIXED, KEY, NO_AUTOLOCK);
    const ADDR = "3zxKWhhd8HY9pT2ZCZNUSEz2XWwSk15P2sD3atnnnxRtHa2Ta1H4jRy";

    const watch = await w.addWatchAccount(ADDR, "Cold");
    expect(watch.watchOnly).toBe(true);
    expect(watch.canSign).toBe(false);
    expect(watch.pkh).toBe(ADDR);
    expect(() => w.getExtendedKey(watch.index)).toThrow();

    const d = await w.addAccount("Two");
    expect(d.index).toBe(1);

    await expect(w.addWatchAccount("not-base58")).rejects.toThrow();
    await expect(w.addWatchAccount(ADDR)).rejects.toThrow();
  });
});

describe("WalletStore passkeys", () => {
  it("enrolls a backup passkey, unlocks with it, and refuses removing the last", async () => {
    const w = new WalletStore();
    await w.create(FIXED, KEY, NO_AUTOLOCK);
    const backup = newKey("Backup");
    await w.enrollPasskey(backup);
    expect(w.listUnlockMethods()).toHaveLength(2);

    // unlock with the backup key on a fresh store
    w.lock();
    const w2 = new WalletStore();
    await w2.unlockWithPrf(backup.credentialId, backup.prfOutput);
    expect(w2.isUnlocked()).toBe(true);

    // remove one; can't remove the last
    const methods = w2.listUnlockMethods();
    await w2.removeUnlockMethod(methods[0].id);
    expect(w2.listUnlockMethods()).toHaveLength(1);
    await expect(w2.removeUnlockMethod(w2.listUnlockMethods()[0].id)).rejects.toThrow();
  });
});
