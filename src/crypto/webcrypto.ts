/** Thin WebCrypto helpers (AES-GCM + base64). Browser, Node 20+, and jsdom all
 * expose `globalThis.crypto.subtle`, so no polyfill is needed. */

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** A fresh NON-EXTRACTABLE AES-GCM key (e.g. to wrap the DEK for a kept session).
 *  Non-extractable means an XSS can use it in-page but cannot exfiltrate the raw
 *  key material for offline/elsewhere use. */
export function generateWrappingKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Import 32 raw bytes (e.g. a YubiKey-PRF-derived KEK) as an AES-GCM key. */
export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function aesGcmEncrypt(
  key: CryptoKey,
  iv: Uint8Array,
  plaintext: Uint8Array
): Promise<Uint8Array> {
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    plaintext as BufferSource
  );
  return new Uint8Array(ct);
}

export async function aesGcmDecrypt(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array
): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource
  );
  return new Uint8Array(pt);
}
