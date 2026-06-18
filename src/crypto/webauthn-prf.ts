/**
 * WebAuthn PRF (CTAP2 hmac-secret) — a touch-gated, hardware-backed secret used
 * as a vault unlock method. A YubiKey returns a deterministic 32-byte output for
 * (credential, salt); we import it as an AES key to wrap the vault DEK. The FIDO
 * secret never leaves the device, and on-device Nockchain signing is impossible
 * (Cheetah curve), so signing still happens in JS after this unlock.
 *
 * Support is narrow (Chromium desktop + Android Chrome; not Firefox; not Safari
 * with roaming keys), so callers must feature-detect and fall back to a password.
 */

import { randomBytes } from "./webcrypto.js";

/** Fixed app salt — using one stable salt lets a single get() with multiple
 * allowCredentials return a usable PRF output for whichever key the user taps. */
const PRF_SALT = new TextEncoder().encode("rose-web/prf/v1");

/** Best-effort capability check (true PRF support is only known after enroll). */
export function isPrfCapable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.credentials?.create
  );
}

type PrfClientResults = {
  prf?: { enabled?: boolean; results?: { first?: BufferSource } };
};

/** Register a new credential and report whether it supports the PRF extension. */
export async function createPrfCredential(opts: {
  rpName: string;
  userName: string;
}): Promise<{ credentialId: Uint8Array; prfSupported: boolean }> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32) as BufferSource,
      // Pin rp.id to the exact host (matches the WebAuthn default, so existing
      // credentials still verify) — prevents a sibling subdomain from using it.
      rp: { name: opts.rpName, id: window.location.hostname },
      user: {
        id: randomBytes(16) as BufferSource,
        name: opts.userName,
        displayName: opts.userName,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      // No authenticatorAttachment: allow BOTH platform passkeys (Touch ID /
      // Windows Hello) and roaming YubiKeys. residentKey "preferred" makes
      // platform credentials discoverable passkeys. userVerification "required"
      // binds unlock to a biometric/PIN (a wallet shouldn't unlock on presence
      // alone) — authenticators without UV are rejected at create/unlock.
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      timeout: 60_000,
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("YubiKey registration was cancelled");

  const ext = cred.getClientExtensionResults() as PrfClientResults;
  return { credentialId: new Uint8Array(cred.rawId), prfSupported: !!ext.prf?.enabled };
}

/**
 * Evaluate the PRF for one of `allowCredentialIds`. Returns which credential
 * responded and its 32-byte output. One touch, even with several enrolled keys.
 */
export async function evaluatePrf(
  allowCredentialIds: Uint8Array[]
): Promise<{ credentialId: Uint8Array; output: Uint8Array }> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32) as BufferSource,
      allowCredentials: allowCredentialIds.map((id) => ({
        type: "public-key" as const,
        id: id as BufferSource,
      })),
      userVerification: "required",
      timeout: 60_000,
      extensions: {
        prf: { eval: { first: PRF_SALT } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("YubiKey was cancelled");

  const ext = assertion.getClientExtensionResults() as PrfClientResults;
  const first = ext.prf?.results?.first;
  if (!first) {
    throw new Error(
      "This authenticator/browser did not return a PRF result. " +
      "YubiKey PRF needs Chrome or Edge on desktop/Android."
    );
  }
  const output = new Uint8Array(first instanceof ArrayBuffer ? first : (first as Uint8Array));
  return { credentialId: new Uint8Array(assertion.rawId), output };
}

/** Convenience: PRF output for a single just-registered credential. */
export async function evaluatePrfFor(credentialId: Uint8Array): Promise<Uint8Array> {
  const { output } = await evaluatePrf([credentialId]);
  return output;
}
