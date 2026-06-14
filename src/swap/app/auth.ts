import type { NockWalletSession } from "../nock/wallet.js";
import { signMessageForWorker } from "../nock/sign.js";

const STORAGE_PREFIX = "rose-web.swap.session.";
const EXPIRY_SKEW_MS = 5 * 60_000;

let activeWallet: NockWalletSession | null = null;
let activeKeys: { privateKey: Uint8Array; publicKey: Uint8Array } | null = null;
const inflight = new Map<string, Promise<string>>();

export function setActiveWallet(
  wallet: NockWalletSession | null,
  keys?: { privateKey: Uint8Array; publicKey: Uint8Array } | null
): void {
  activeWallet = wallet;
  activeKeys = keys ?? null;
}

export function getActiveWallet(): NockWalletSession | null {
  return activeWallet;
}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function tokenExpiry(token: string): number | null {
  try {
    const dot = token.indexOf(".");
    if (dot < 0) return null;
    const b64 = token.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const { exp } = JSON.parse(atob(b64 + pad)) as { exp?: number };
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

function isFresh(token: string): boolean {
  const exp = tokenExpiry(token);
  return exp != null && exp - EXPIRY_SKEW_MS > Date.now();
}

function storedToken(pkh: string): string | null {
  const key = STORAGE_PREFIX + pkh;
  const token = lsGet(key);
  if (!token) return null;
  if (isFresh(token)) return token;
  lsRemove(key);
  return null;
}

async function login(baseUrl: string, wallet: NockWalletSession): Promise<string> {
  if (!activeKeys) throw new Error("Wallet keys unavailable — unlock your wallet");
  const pkh = wallet.pkh as string;
  const chRes = await fetch(`${baseUrl}/auth/challenge?pkh=${encodeURIComponent(pkh)}`);
  if (!chRes.ok) throw new Error(`sign-in challenge failed (${chRes.status})`);
  const { challenge, challengeMac } = (await chRes.json()) as {
    challenge: string;
    challengeMac: string;
  };

  const { pubkeyHex, signature } = await signMessageForWorker(
    wallet,
    challenge,
    activeKeys.privateKey,
    activeKeys.publicKey
  );

  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challenge, challengeMac, pubkeyHex, signature }),
  });
  if (!loginRes.ok) {
    const msg = await loginRes.text().catch(() => "");
    throw new Error(`sign-in failed (${loginRes.status}) ${msg}`);
  }
  const { token } = (await loginRes.json()) as { token: string };
  lsSet(STORAGE_PREFIX + pkh, token);
  return token;
}

export async function ensureSession(baseUrl: string): Promise<string> {
  const wallet = activeWallet;
  if (!wallet) throw new Error("Unlock your Nockchain wallet to continue");
  const pkh = wallet.pkh as string;

  const existing = storedToken(pkh);
  if (existing) return existing;

  let p = inflight.get(pkh);
  if (!p) {
    p = login(baseUrl, wallet).finally(() => inflight.delete(pkh));
    inflight.set(pkh, p);
  }
  return p;
}

export function clearSession(pkh?: string): void {
  if (pkh) {
    lsRemove(STORAGE_PREFIX + pkh);
    return;
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(STORAGE_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}