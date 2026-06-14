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

/**
 * Connect a Base wallet. Pass an EIP-6963 `rdns` to choose a specific wallet, or
 * the synthetic `WALLETCONNECT_RDNS` to open the WalletConnect mobile flow.
 */
export async function connectEvmWallet(rdns?: string): Promise<Address> {
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
  if (getSelectedRdns() === WALLETCONNECT_RDNS) {
    await disconnectWalletConnect();
  }
}
