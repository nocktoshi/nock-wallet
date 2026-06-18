/**
 * WalletStore — the in-memory wallet controller. Passwordless: a passkey/YubiKey
 * (WebAuthn PRF) is the only unlock method, and the recovery phrase is the
 * backup. This class takes *raw* PRF material (credentialId + 32-byte output) so
 * it stays framework- and WebAuthn-free (the wallet/passkey.ts orchestrator does
 * the actual WebAuthn calls). While unlocked it holds the payload + DEK; `lock()`
 * wipes both. React subscribes via `subscribe()`.
 */
import type { Digest, ExtendedKey } from "@nockchain/rose-ts";
import {
  type EnvelopeVault,
  type PrfMaterial,
  createVaultWithPrf,
  unlockWithPrf,
  decryptPayloadWithDek,
  reencryptPayload,
  addPrfWrap,
  removeKeyringEntry,
  prfCredentialIds,
} from "../crypto/vault.js";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  fromBase64,
  generateWrappingKey,
  randomBytes,
  toBase64,
} from "../crypto/webcrypto.js";
import { normalizeMnemonic, validateMnemonic } from "../crypto/mnemonic.js";
import { deriveExtendedKey, pkhFromExtendedKey } from "../nock/address.js";
import {
  clearSessionWrapKey,
  clearStoredWallet,
  hasStoredWallet,
  loadSessionWrapKey,
  loadStoredWallet,
  saveSessionWrapKey,
  saveStoredWallet,
} from "./storage.js";
import type {
  AccountMeta,
  StoredWallet,
  UnlockedAccount,
  UnlockMethod,
  VaultPayload,
  WalletMeta,
} from "./types.js";

const DEFAULT_AUTO_LOCK_MIN = 5;
/** sessionStorage key holding the DEK when auto-lock is "never" (0). */
const SESSION_DEK_KEY = "nw.session.dek";

/** sessionStorage, but tolerant of environments where it's unavailable. */
function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

interface DerivedKey {
  ext: ExtendedKey;
  pkh: string;
}

export type WalletEvent = "unlocked" | "locked" | "changed";

export class WalletStore {
  private payload: VaultPayload | null = null;
  private meta: WalletMeta | null = null;
  private dek: Uint8Array | null = null;
  private envelope: EnvelopeVault | null = null;

  private readonly derived = new Map<number, DerivedKey>();
  private readonly listeners = new Set<(e: WalletEvent) => void>();

  private lockTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- lifecycle ---------------------------------------------------------

  static isInitialized(): Promise<boolean> {
    return hasStoredWallet();
  }

  /** Enrolled passkey credential ids (readable while locked, for unlock). */
  static async enrolledCredentialIds(): Promise<Uint8Array[]> {
    const stored = await loadStoredWallet();
    return stored ? prfCredentialIds(stored.vault) : [];
  }

  isUnlocked(): boolean {
    return this.payload !== null;
  }

  /** Create a wallet from a mnemonic, secured by the first passkey. */
  async create(
    mnemonic: string,
    enrollment: PrfMaterial,
    opts: { autoLockMinutes?: number } = {}
  ): Promise<void> {
    const norm = normalizeMnemonic(mnemonic);
    if (!validateMnemonic(norm)) throw new Error("Invalid recovery phrase");

    const payload: VaultPayload = {
      v: 1,
      mnemonic: norm,
      accounts: [{ index: 0, name: "Account 1" }],
      activeIndex: 0,
    };
    const meta: WalletMeta = {
      v: 1,
      createdAt: Date.now(),
      autoLockMinutes: opts.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MIN,
    };

    const { vault, dek } = await createVaultWithPrf(encodePayload(payload), enrollment);
    await saveStoredWallet({ vault, meta });
    this.setUnlocked(payload, meta, dek, vault);
    this.emit("unlocked");
  }

  /** Unlock with a passkey PRF result; throws DecryptError on a non-match. */
  async unlockWithPrf(credentialId: Uint8Array, prfOutput: Uint8Array): Promise<void> {
    const stored = await this.requireStored();
    const { payload, dek } = await unlockWithPrf(credentialId, prfOutput, stored.vault);
    this.setUnlocked(decodePayload(payload), stored.meta, dek, stored.vault);
    this.emit("unlocked");
  }

  /**
   * Restore a previously unlocked session after a page refresh — only when the
   * user chose "never" auto-lock. The DEK is kept WRAPPED under a non-extractable
   * key (sessionStorage holds only the wrapped blob; the key lives in IDB), so it
   * can't be exfiltrated. Returns true if now unlocked. Cleared by lock(), reset(),
   * or tab close (which drops the sessionStorage blob).
   */
  async tryRestoreSession(): Promise<boolean> {
    if (this.isUnlocked()) return true;
    const raw = sessionStore()?.getItem(SESSION_DEK_KEY);
    if (!raw) return false;
    let dek: Uint8Array | null = null;
    try {
      const { iv, ct } = JSON.parse(raw) as { iv: string; ct: string };
      const wrapKey = await loadSessionWrapKey();
      if (!wrapKey) {
        this.clearSessionSync();
        return false;
      }
      dek = await aesGcmDecrypt(wrapKey, fromBase64(iv), fromBase64(ct));
      const stored = await loadStoredWallet();
      if (!stored) {
        await this.clearSession();
        return false;
      }
      const payload = await decryptPayloadWithDek(dek, stored.vault);
      this.setUnlocked(decodePayload(payload), stored.meta, dek, stored.vault);
      this.emit("unlocked");
      return true;
    } catch {
      // Stale/invalid session (vault rotated, key gone, decrypt failed) — drop it.
      dek?.fill(0);
      await this.clearSession().catch(() => {});
      return false;
    }
  }

  /** Wipe all secret material from memory. */
  lock(): void {
    this.dek?.fill(0); // best-effort zeroization before drop
    this.payload = null;
    this.dek = null;
    this.envelope = null;
    this.derived.clear();
    if (this.lockTimer) clearTimeout(this.lockTimer);
    this.lockTimer = null;
    this.clearSessionSync(); // sync: blocks restore immediately
    void clearSessionWrapKey(); // async IDB cleanup
    this.emit("locked");
  }

  async reset(): Promise<void> {
    await clearStoredWallet();
    this.meta = null;
    this.lock();
  }

  // ---- accounts ----------------------------------------------------------

  getAccounts(): UnlockedAccount[] {
    const p = this.requirePayload();
    return p.accounts.map((a) => this.resolve(a));
  }

  getVisibleAccounts(): UnlockedAccount[] {
    return this.getAccounts().filter((a) => !a.hidden);
  }

  getActiveAccount(): UnlockedAccount {
    const p = this.requirePayload();
    const meta = p.accounts.find((a) => a.index === p.activeIndex) ?? p.accounts[0];
    return this.resolve(meta);
  }

  /** Extended key for an account index; throws for watch-only accounts. */
  getExtendedKey(index: number): ExtendedKey {
    const meta = this.requirePayload().accounts.find((a) => a.index === index);
    if (meta?.watchOnly) throw new Error("Watch-only account cannot sign");
    return this.deriveFor(index).ext;
  }

  async addAccount(name?: string): Promise<UnlockedAccount> {
    const p = this.requirePayload();
    const derived = p.accounts.filter((a) => !a.watchOnly);
    const nextIndex = derived.reduce((m, a) => Math.max(m, a.index), -1) + 1;
    const meta: AccountMeta = {
      index: nextIndex,
      name: name?.trim() || `Account ${derived.length + 1}`,
    };
    p.accounts.push(meta);
    p.activeIndex = nextIndex;
    await this.persistCurrent();
    this.emit("changed");
    return this.resolve(meta);
  }

  /** Add a view-only account for an external address (e.g. a Ledger-held key). */
  async addWatchAccount(pkh: string, name?: string): Promise<UnlockedAccount> {
    const p = this.requirePayload();
    const addr = pkh.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{40,}$/.test(addr)) {
      throw new Error("Enter a valid Nockchain address (base58 PKH)");
    }
    if (p.accounts.some((a) => a.watchOnly && a.pkh === addr)) {
      throw new Error("That address is already a watch-only account");
    }
    // Watch-only accounts use synthetic negative indices, distinct from derived ones.
    const index = p.accounts.reduce((m, a) => Math.min(m, a.index), 0) - 1;
    const meta: AccountMeta = {
      index,
      name: name?.trim() || `Watch ${p.accounts.filter((a) => a.watchOnly).length + 1}`,
      watchOnly: true,
      pkh: addr,
    };
    p.accounts.push(meta);
    p.activeIndex = index;
    await this.persistCurrent();
    this.emit("changed");
    return this.resolve(meta);
  }

  private resolve(meta: AccountMeta): UnlockedAccount {
    if (meta.watchOnly) {
      return { ...meta, pkh: (meta.pkh ?? "") as Digest, canSign: false };
    }
    return { ...meta, pkh: this.deriveFor(meta.index).pkh as Digest, canSign: true };
  }

  async switchAccount(index: number): Promise<void> {
    const p = this.requirePayload();
    if (!p.accounts.some((a) => a.index === index)) {
      throw new Error(`Unknown account index ${index}`);
    }
    p.activeIndex = index;
    await this.persistCurrent();
    this.emit("changed");
  }

  async renameAccount(index: number, name: string): Promise<void> {
    this.mutateAccount(index, (a) => (a.name = name.trim() || a.name));
    await this.persistCurrent();
    this.emit("changed");
  }

  async setAccountColor(index: number, color: string): Promise<void> {
    this.mutateAccount(index, (a) => (a.color = color));
    await this.persistCurrent();
    this.emit("changed");
  }

  async setAccountHidden(index: number, hidden: boolean): Promise<void> {
    const p = this.requirePayload();
    if (hidden && p.accounts.filter((a) => !a.hidden).length <= 1) {
      throw new Error("Cannot hide the last visible account");
    }
    this.mutateAccount(index, (a) => (a.hidden = hidden));
    if (hidden && p.activeIndex === index) {
      const next = p.accounts.find((a) => !a.hidden);
      if (next) p.activeIndex = next.index;
    }
    await this.persistCurrent();
    this.emit("changed");
  }

  // ---- secrets / passkeys -----------------------------------------------

  /** The recovery phrase — UI must re-authenticate (a passkey tap) first. */
  getMnemonic(): string {
    return this.requirePayload().mnemonic;
  }

  /** Configured passkeys/YubiKeys. Requires unlocked. */
  listUnlockMethods(): UnlockMethod[] {
    return this.requireEnvelope().keyring.map((e) => ({ id: e.id, type: "prf", label: e.label }));
  }

  /** A default label for the next enrolled passkey. */
  nextPasskeyLabel(): string {
    return `Passkey ${this.requireEnvelope().keyring.length + 1}`;
  }

  /** Enroll an additional passkey/YubiKey (wrap the DEK under its PRF output). */
  async enrollPasskey(enrollment: PrfMaterial): Promise<void> {
    this.envelope = await addPrfWrap(this.requireDek(), this.requireEnvelope(), enrollment);
    await this.persistCurrent();
    this.emit("changed");
  }

  async removeUnlockMethod(id: string): Promise<void> {
    this.envelope = removeKeyringEntry(this.requireEnvelope(), id);
    await this.persistCurrent();
    this.emit("changed");
  }

  // ---- auto-lock ---------------------------------------------------------

  getAutoLockMinutes(): number {
    return this.meta?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MIN;
  }

  /** Persist (or clear) the kept-session DEK so a refresh restores without a
   *  passkey — gated on the user's explicit "never" (0) auto-lock choice. The DEK
   *  is wrapped under a NON-EXTRACTABLE key (kept in IDB); sessionStorage holds
   *  only the wrapped blob, so an XSS can't exfiltrate the raw key. Cleared on
   *  lock/close. Best-effort (fire-and-forget); a refresh before it lands just
   *  re-prompts. CSP remains the primary XSS defense. */
  private async persistSession(): Promise<void> {
    const store = sessionStore();
    if (!store || !this.dek) return;
    if (this.getAutoLockMinutes() !== 0) {
      this.clearSessionSync();
      void clearSessionWrapKey();
      return;
    }
    try {
      const wrapKey = await generateWrappingKey();
      const iv = randomBytes(12);
      const ct = await aesGcmEncrypt(wrapKey, iv, this.dek);
      await saveSessionWrapKey(wrapKey);
      store.setItem(SESSION_DEK_KEY, JSON.stringify({ iv: toBase64(iv), ct: toBase64(ct) }));
    } catch {
      this.clearSessionSync();
      void clearSessionWrapKey();
    }
  }

  /** Synchronous part of clearing — removes the sessionStorage blob, which alone
   *  is enough to block a restore (it also needs the IDB key). */
  private clearSessionSync(): void {
    sessionStore()?.removeItem(SESSION_DEK_KEY);
  }

  private async clearSession(): Promise<void> {
    this.clearSessionSync();
    await clearSessionWrapKey();
  }

  async setAutoLockMinutes(minutes: number): Promise<void> {
    const meta = this.requireMeta();
    meta.autoLockMinutes = Math.max(0, Math.floor(minutes));
    await this.persistCurrent();
    this.armAutoLock();
    void this.persistSession();
    this.emit("changed");
  }

  touch(): void {
    if (this.isUnlocked()) this.armAutoLock();
  }

  // ---- subscriptions -----------------------------------------------------

  subscribe(fn: (e: WalletEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---- internals ---------------------------------------------------------

  private setUnlocked(
    payload: VaultPayload,
    meta: WalletMeta,
    dek: Uint8Array,
    envelope: EnvelopeVault
  ): void {
    this.payload = payload;
    this.meta = meta;
    this.dek = dek;
    this.envelope = envelope;
    this.derived.clear();
    this.armAutoLock();
    void this.persistSession();
  }

  private deriveFor(index: number): DerivedKey {
    const hit = this.derived.get(index);
    if (hit) return hit;
    const p = this.requirePayload();
    const ext = deriveExtendedKey(p.mnemonic, index);
    const d: DerivedKey = { ext, pkh: pkhFromExtendedKey(ext) };
    this.derived.set(index, d);
    return d;
  }

  private mutateAccount(index: number, fn: (a: AccountMeta) => void): void {
    const p = this.requirePayload();
    const a = p.accounts.find((x) => x.index === index);
    if (!a) throw new Error(`Unknown account index ${index}`);
    fn(a);
  }

  /** Re-encrypt the payload under the in-memory DEK and persist the envelope. */
  private async persistCurrent(): Promise<void> {
    const next = await reencryptPayload(
      this.requireDek(),
      this.requireEnvelope(),
      encodePayload(this.requirePayload())
    );
    this.envelope = next;
    const record: StoredWallet = { vault: next, meta: this.requireMeta() };
    await saveStoredWallet(record);
  }

  private armAutoLock(): void {
    if (this.lockTimer) clearTimeout(this.lockTimer);
    this.lockTimer = null;
    const mins = this.getAutoLockMinutes();
    if (mins > 0) this.lockTimer = setTimeout(() => this.lock(), mins * 60_000);
  }

  private emit(e: WalletEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  private async requireStored(): Promise<StoredWallet> {
    const stored = await loadStoredWallet();
    if (!stored) throw new Error("No wallet to unlock");
    return stored;
  }
  private requirePayload(): VaultPayload {
    if (!this.payload) throw new Error("Wallet is locked");
    return this.payload;
  }
  private requireMeta(): WalletMeta {
    if (!this.meta) throw new Error("Wallet is locked");
    return this.meta;
  }
  private requireDek(): Uint8Array {
    if (!this.dek) throw new Error("Wallet is locked");
    return this.dek;
  }
  private requireEnvelope(): EnvelopeVault {
    if (!this.envelope) throw new Error("Wallet is locked");
    return this.envelope;
  }
}

function encodePayload(payload: VaultPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}
function decodePayload(bytes: Uint8Array): VaultPayload {
  return JSON.parse(new TextDecoder().decode(bytes)) as VaultPayload;
}

/** App-wide singleton wallet controller. */
export const wallet = new WalletStore();
