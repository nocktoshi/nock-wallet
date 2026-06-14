/**
 * Passkey orchestrator — ties WebAuthn PRF to the (WebAuthn-free) WalletStore.
 * The wallet is passwordless: a passkey or YubiKey is the only unlock method,
 * and the recovery phrase is the backup. These helpers run the user-gesture
 * WebAuthn calls and hand raw PRF material to the store.
 */
import {
  isPrfCapable,
  createPrfCredential,
  evaluatePrf,
  evaluatePrfFor,
} from "../crypto/webauthn-prf.js";
import { toBase64 } from "../crypto/webcrypto.js";
import { wallet, WalletStore } from "./wallet.js";

const RP_NAME = "Nock Wallet";
const USER_NAME = "Nock Wallet";

/** Whether this browser/device can do WebAuthn PRF (passkey or YubiKey). */
export const isPasskeySupported = isPrfCapable;

const UNSUPPORTED =
  "This passkey/browser doesn't support the WebAuthn PRF extension. Use Chrome or Edge on " +
  "desktop/Android, a device with Touch ID/Windows Hello, or a FIDO2 security key.";

/** Register a new passkey and obtain its PRF output (two touches at setup). */
async function provision(label: string) {
  const { credentialId, prfSupported } = await createPrfCredential({
    rpName: RP_NAME,
    userName: USER_NAME,
  });
  if (!prfSupported) throw new Error(UNSUPPORTED);
  const prfOutput = await evaluatePrfFor(credentialId);
  return { credentialId, prfOutput, label };
}

/** Create a new wallet secured by a freshly-registered passkey. */
export async function createWalletWithPasskey(
  mnemonic: string,
  opts?: { autoLockMinutes?: number }
): Promise<void> {
  if (!isPrfCapable()) throw new Error(UNSUPPORTED);
  await wallet.create(mnemonic, await provision("Passkey 1"), opts);
}

/** Unlock the wallet with an enrolled passkey (one touch). */
export async function unlockWithPasskey(): Promise<void> {
  const ids = await WalletStore.enrolledCredentialIds();
  if (ids.length === 0) throw new Error("No passkey is enrolled for this wallet");
  const { credentialId, output } = await evaluatePrf(ids);
  await wallet.unlockWithPrf(credentialId, output);
}

/** Enroll an additional (backup) passkey while unlocked. */
export async function enrollPasskey(label?: string): Promise<void> {
  if (!isPrfCapable()) throw new Error(UNSUPPORTED);
  await wallet.enrollPasskey(await provision(label?.trim() || wallet.nextPasskeyLabel()));
}

/** Re-authenticate with a passkey tap (e.g. before revealing the phrase). */
export async function verifyPasskey(): Promise<boolean> {
  const ids = await WalletStore.enrolledCredentialIds();
  if (ids.length === 0) return false;
  try {
    const { credentialId } = await evaluatePrf(ids);
    const got = toBase64(credentialId);
    return ids.some((id) => toBase64(id) === got);
  } catch {
    return false;
  }
}
