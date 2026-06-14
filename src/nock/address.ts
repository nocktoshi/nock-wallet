/**
 * rose-ts adapter — turn a mnemonic + account index into the wallet identity:
 * extended key, base58 PKH (the human-readable address), and the balance-query
 * "first name" for a single-PKH lock.
 *
 * Derivation mirrors Iris: account 0 uses the master key directly; accounts
 * >0 use a SLIP-10 hardened child at that index. Keep this in lockstep with the
 * Iris extension so addresses line up across wallets.
 */
import {
  deriveMasterKeyFromMnemonic,
  hashPublicKey,
  pkhSingle,
  spendConditionNewPkh,
  spendConditionFirstName,
  type Digest,
  type ExtendedKey,
} from "@nockchain/rose-ts";

const HARDENED_OFFSET = 0x8000_0000;

export interface DerivedAccount {
  index: number;
  /** Extended key (holds 32-byte privateKey + 97-byte publicKey). */
  ext: ExtendedKey;
  /** Base58 PKH digest — the wallet address shown to users. */
  pkh: Digest;
}

/** Derive the extended key for an account index from a mnemonic. */
export function deriveExtendedKey(
  mnemonic: string,
  accountIndex = 0,
  passphrase = ""
): ExtendedKey {
  const master = deriveMasterKeyFromMnemonic(mnemonic, passphrase);
  if (accountIndex === 0) return master;
  return master.deriveChild(HARDENED_OFFSET + accountIndex);
}

/** Derive the full identity (ext key + PKH) for an account index. */
export function deriveAccount(
  mnemonic: string,
  accountIndex = 0,
  passphrase = ""
): DerivedAccount {
  const ext = deriveExtendedKey(mnemonic, accountIndex, passphrase);
  return { index: accountIndex, ext, pkh: pkhFromExtendedKey(ext) };
}

/** Base58 PKH (address) from an extended/derived key. */
export function pkhFromExtendedKey(ext: ExtendedKey): Digest {
  return hashPublicKey(ext.publicKey) as Digest;
}

/** The balance-query first name for a single-PKH lock over `pkh`. */
export function firstNameForPkh(pkh: Digest): Digest {
  return spendConditionFirstName(spendConditionNewPkh(pkhSingle(pkh)));
}
