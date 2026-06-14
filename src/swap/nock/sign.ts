import {
  signMessage,
  publicKeyToHex,
  publicKeyFromBeBytes,
  hashPublicKey,
  verifySignature,
} from "@nockchain/rose-ts";
import type { NockWalletSession } from "./wallet.js";

export interface NockSignature {
  c: string;
  s: string;
}

export interface SignedWire {
  pubkeyHex: string;
  signature: NockSignature;
}

/** Sign a worker challenge with the vault private key (not the Iris extension). */
export async function signMessageForWorker(
  _wallet: NockWalletSession,
  message: string,
  privateKey: Uint8Array,
  publicKey: Uint8Array
): Promise<SignedWire> {
  const signature = signMessage(privateKey, message) as NockSignature;
  const pubkeyHex = publicKeyToHex(publicKeyFromBeBytes(publicKey));

  try {
    const derivedPkh = String(hashPublicKey(publicKey));
    if (_wallet.pkh && derivedPkh !== String(_wallet.pkh)) {
      console.warn(`[sign] pubkey hashes to ${derivedPkh} but wallet pkh is ${_wallet.pkh}`);
    }
    if (!verifySignature(publicKey, signature, message)) {
      console.warn("[sign] local verifySignature(message) failed");
    }
  } catch (e) {
    console.warn("[sign] local signature self-check could not run:", e);
  }

  return { pubkeyHex, signature };
}