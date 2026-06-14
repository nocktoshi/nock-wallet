import type { Digest } from "@nockchain/rose-ts";
import type { EnvelopeVault } from "../crypto/vault.js";

/** Per-account metadata (names/styling/hidden aren't derivable from the seed). */
export interface AccountMeta {
  /** Stable id: derived accounts use SLIP-10 index (>=0); watch-only use negatives. */
  index: number;
  name: string;
  hidden?: boolean;
  /** UI accent color for the account icon. */
  color?: string;
  /** Watch-only (external/Ledger-held) account — view-only, cannot sign. */
  watchOnly?: boolean;
  /** Address for watch-only accounts (derived accounts compute it from the seed). */
  pkh?: string;
}

/** Secret payload sealed inside the encrypted vault. */
export interface VaultPayload {
  v: 1;
  /** Normalized BIP-39 mnemonic. */
  mnemonic: string;
  accounts: AccountMeta[];
  activeIndex: number;
}

/** Non-secret wallet metadata stored in plaintext alongside the vault. */
export interface WalletMeta {
  v: 1;
  createdAt: number;
  /** Idle minutes before auto-lock; 0 = never. */
  autoLockMinutes: number;
}

/** The full record persisted in IndexedDB. */
export interface StoredWallet {
  vault: EnvelopeVault;
  meta: WalletMeta;
}

/** A configured unlock method (a passkey or YubiKey), for the settings UI. */
export interface UnlockMethod {
  id: string;
  type: "prf";
  label: string;
}

/** An account resolved against the unlocked seed (adds derived key + address). */
export interface UnlockedAccount extends AccountMeta {
  pkh: Digest;
  /** False for watch-only accounts. */
  canSign: boolean;
}
