/** BIP-39 mnemonic generation + validation (rose-ts consumes a mnemonic but does
 * not mint one). Default 256-bit entropy → 24 words, matching the Iris extension. */
import {
  generateMnemonic as genMnemonic,
  validateMnemonic as valMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

export type MnemonicStrength = 128 | 256;

export function generateMnemonic(strengthBits: MnemonicStrength = 256): string {
  return genMnemonic(wordlist, strengthBits);
}

/** Normalize then validate against the English wordlist + checksum. */
export function validateMnemonic(mnemonic: string): boolean {
  return valMnemonic(normalizeMnemonic(mnemonic), wordlist);
}

/** Lowercase + collapse whitespace — the canonical form we derive/store from. */
export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
}

export { wordlist };
