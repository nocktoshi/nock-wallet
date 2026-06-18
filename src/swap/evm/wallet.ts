import type { Address } from "viem";
import { connectWallet } from "./htlc.js";
import { getProvider, getSelectedRdns, selectWallet } from "./providers.js";
import {
  WALLETCONNECT_RDNS,
  connectWalletConnect,
  disconnectWalletConnect,
  restoreWalletConnect,
} from "./walletconnect.js";

let connected: Address | null = null;

// Set when the user explicitly disconnects so a page reload doesn't silently
// re-attach (WalletConnect relay session or an injected wallet still authorized
// via eth_accounts). Cleared on the next explicit connect.
const DISCONNECTED_KEY = "evm-disconnected";

function setDisconnected(on: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (on) localStorage.setItem(DISCONNECTED_KEY, "1");
    else localStorage.removeItem(DISCONNECTED_KEY);
  } catch {
    // storage unavailable
  }
}

function userDisconnected(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(DISCONNECTED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Connect a Base wallet. Pass an EIP-6963 `rdns` to choose a specific wallet, or
 * the synthetic `WALLETCONNECT_RDNS` to open the WalletConnect mobile flow.
 */
export async function connectEvmWallet(rdns?: string): Promise<Address> {
  setDisconnected(false);
  if (rdns) selectWallet(rdns);
  connected =
    rdns === WALLETCONNECT_RDNS
      ? await connectWalletConnect()
      : await connectWallet();
  return connected;
}

export function getEvmAddress(): Address | null {
  return connected;
}

export function requireEvmAddress(): Address {
  if (!connected) {
    throw new Error("Connect MetaMask on Base first");
  }
  return connected;
}

export function setEvmAddress(addr: Address | null): void {
  connected = addr;
}

/**
 * Restore an EVM connection silently (no popup). For WalletConnect this
 * re-attaches the persisted relay session; otherwise it reads the injected
 * provider's already-authorized account via eth_accounts.
 */
export async function silentReconnect(): Promise<Address | null> {
  // Respect an explicit disconnect — don't auto-reattach on reload.
  if (userDisconnected()) return null;
  if (getSelectedRdns() === WALLETCONNECT_RDNS) {
    const addr = await restoreWalletConnect();
    if (addr) {
      connected = addr;
      return connected;
    }
    return null;
  }
  try {
    const accounts = (await getProvider().request({ method: "eth_accounts" })) as string[];
    if (accounts[0]) {
      connected = accounts[0] as Address;
      return connected;
    }
  } catch {
    // wallet unavailable or not connected
  }
  return null;
}

/** Disconnect the active EVM wallet, tearing down a WalletConnect session too. */
export async function disconnectEvmWallet(): Promise<void> {
  connected = null;
  setDisconnected(true);
  // Always tear down WalletConnect — a stale relay session left in localStorage
  // is exactly what makes a later connect silently re-attach the old wallet,
  // even if the active selection is no longer WC. No-op for injected wallets.
  await disconnectWalletConnect();
}
