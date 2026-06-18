/**
 * Passwordless envelope vault. A random 32-byte Data Encryption Key (DEK)
 * encrypts the payload once; each unlock method — a passkey or YubiKey via the
 * WebAuthn PRF output — wraps the DEK under an AES key imported from that 32-byte
 * output. No password anywhere; the recovery phrase is the only fallback.
 *
 * Payload edits re-encrypt under the in-memory DEK (no touch); enrolling a backup
 * passkey just wraps the same DEK again. The DEK lives in volatile memory only
 * while unlocked.
 */
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  fromBase64,
  importAesKey,
  randomBytes,
  toBase64,
} from "./webcrypto.js";

const IV_LEN = 12;
const DEK_LEN = 32;

export interface VaultCipher {
  /** base64 */ iv: string;
  /** base64 */ ct: string;
}

/** A passkey / YubiKey unlock method: the DEK wrapped under its PRF output. */
export interface PrfEntry {
  id: string;
  label: string;
  /** base64 WebAuthn credential rawId (used as allowCredentials at unlock). */
  credentialId: string;
  /** DEK wrapped under the credential's PRF output. */
  wrap: VaultCipher;
}

export interface EnvelopeVault {
  v: 2;
  /** Payload (mnemonic + accounts) encrypted under the DEK. */
  payload: VaultCipher;
  keyring: PrfEntry[];
}

export class DecryptError extends Error {
  constructor(message = "Decryption failed") {
    super(message);
    this.name = "DecryptError";
  }
}

function dekToKey(dek: Uint8Array): Promise<CryptoKey> {
  return importAesKey(dek);
}

async function enc(key: CryptoKey, bytes: Uint8Array): Promise<VaultCipher> {
  const iv = randomBytes(IV_LEN);
  const ct = await aesGcmEncrypt(key, iv, bytes);
  return { iv: toBase64(iv), ct: toBase64(ct) };
}

function dec(key: CryptoKey, c: VaultCipher): Promise<Uint8Array> {
  return aesGcmDecrypt(key, fromBase64(c.iv), fromBase64(c.ct));
}

export interface PrfMaterial {
  credentialId: Uint8Array;
  prfOutput: Uint8Array;
  label: string;
}

/** Create a fresh vault, wrapping the DEK under the first passkey's PRF output. */
export async function createVaultWithPrf(
  payload: Uint8Array,
  prf: PrfMaterial
): Promise<{ vault: EnvelopeVault; dek: Uint8Array }> {
  const dek = randomBytes(DEK_LEN);
  const payloadCipher = await enc(await dekToKey(dek), payload);
  const empty: EnvelopeVault = { v: 2, payload: payloadCipher, keyring: [] };
  return { vault: await addPrfWrap(dek, empty, prf), dek };
}

/** Unlock with a PRF output for the matching enrolled credential. */
export async function unlockWithPrf(
  credentialId: Uint8Array,
  prfOutput: Uint8Array,
  vault: EnvelopeVault
): Promise<{ payload: Uint8Array; dek: Uint8Array }> {
  const idB64 = toBase64(credentialId);
  const entry = vault.keyring.find((e) => e.credentialId === idB64);
  if (!entry) throw new DecryptError("This passkey is not enrolled for this wallet");
  const kek = await importAesKey(prfOutput);
  let dek: Uint8Array;
  try {
    dek = await dec(kek, entry.wrap);
  } catch {
    throw new DecryptError("Passkey unlock failed");
  }
  const payload = await dec(await dekToKey(dek), vault.payload);
  return { payload, dek };
}

/** Decrypt the payload with a known DEK — used to restore a persisted unlocked
 *  session (the DEK was kept in sessionStorage) without another passkey prompt. */
export async function decryptPayloadWithDek(
  dek: Uint8Array,
  vault: EnvelopeVault
): Promise<Uint8Array> {
  return dec(await dekToKey(dek), vault.payload);
}

/** Re-encrypt the payload under the in-memory DEK (keyring unchanged). */
export async function reencryptPayload(
  dek: Uint8Array,
  vault: EnvelopeVault,
  payload: Uint8Array
): Promise<EnvelopeVault> {
  return { ...vault, payload: await enc(await dekToKey(dek), payload) };
}

/** Wrap the DEK under a passkey/YubiKey PRF output, adding a keyring entry. */
export async function addPrfWrap(
  dek: Uint8Array,
  vault: EnvelopeVault,
  prf: PrfMaterial
): Promise<EnvelopeVault> {
  const kek = await importAesKey(prf.prfOutput);
  const entry: PrfEntry = {
    id: toBase64(randomBytes(8)),
    label: prf.label,
    credentialId: toBase64(prf.credentialId),
    wrap: await enc(kek, dek),
  };
  return { ...vault, keyring: [...vault.keyring, entry] };
}

/** Remove a keyring entry by id; refuses to remove the last unlock method. */
export function removeKeyringEntry(vault: EnvelopeVault, id: string): EnvelopeVault {
  if (vault.keyring.length <= 1) {
    throw new Error("Can't remove your only passkey — add another first, or you'd lose access");
  }
  return { ...vault, keyring: vault.keyring.filter((e) => e.id !== id) };
}

/** base64 → bytes credential ids of all enrolled passkeys (for allowCredentials). */
export function prfCredentialIds(vault: EnvelopeVault): Uint8Array[] {
  return vault.keyring.map((e) => fromBase64(e.credentialId));
}
