/**
 * WalletConnect (Reown) connector. The injected EIP-6963 path in providers.ts
 * only finds wallets that inject `window.ethereum` — which on Android happens
 * solely inside a wallet's in-app browser, never in Chrome or an installed PWA.
 * WalletConnect bridges that gap: it opens the user's mobile wallet (Phantom,
 * MetaMask, …) over a relay via deep-link (mobile) or QR (desktop) and hands
 * back an EIP-1193 provider — the exact shape `getProvider()` already returns,
 * so the rest of evm/ (clients.ts, htlc.ts) works unchanged.
 *
 * The heavy `@walletconnect/ethereum-provider` bundle is imported lazily so
 * injected-only users never pay for it.
 */
import type { Address, EIP1193Provider } from "viem";
import { CHAIN_ID } from "../config.js";
import { readEnv } from "../../env.js";
import {
  registerExternalWallet,
  unregisterWallet,
  type WalletInfo,
} from "./providers.js";

export const WALLETCONNECT_RDNS = "walletconnect";

// A small inline WalletConnect-blue mark for the picker (no network fetch).
const WC_ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">` +
      `<rect width="40" height="40" rx="9" fill="#3396ff"/>` +
      `<path d="M12 16.5c4.4-4.3 11.6-4.3 16 0l.5.5c.2.2.2.6 0 .8l-1.8 1.8c-.1.1-.3.1-.4 0l-.7-.7c-3.1-3-8.1-3-11.2 0l-.8.8c-.1.1-.3.1-.4 0l-1.8-1.8c-.2-.2-.2-.6 0-.8z" fill="#fff"/>` +
      `</svg>`
  );

const WC_INFO: WalletInfo = {
  uuid: WALLETCONNECT_RDNS,
  name: "WalletConnect — Phantom, MetaMask & more",
  icon: WC_ICON,
  rdns: WALLETCONNECT_RDNS,
};

/** Minimal shape we use from @walletconnect/ethereum-provider. */
interface WcProvider extends EIP1193Provider {
  enable(): Promise<string[]>;
  disconnect(): Promise<void>;
  accounts: string[];
  session?: unknown;
  on(event: string, cb: (...args: unknown[]) => void): void;
}

let wcProvider: WcProvider | null = null;

export function walletConnectProjectId(): string | undefined {
  return readEnv("VITE_WALLETCONNECT_PROJECT_ID");
}

/** Whether the WalletConnect option should be offered (projectId configured). */
export function isWalletConnectConfigured(): boolean {
  return !!walletConnectProjectId();
}

/** Lazily create (or reuse) the singleton EthereumProvider. */
async function initWcProvider(): Promise<WcProvider> {
  if (wcProvider) return wcProvider;
  const projectId = walletConnectProjectId() || '56b8c5a9471e0860a63a1a60eda24ef0';
  if (!projectId) {
    throw new Error(
      "WalletConnect is not configured — set VITE_WALLETCONNECT_PROJECT_ID"
    );
  }
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const provider = (await EthereumProvider.init({
    projectId,
    chains: [CHAIN_ID] as [number],
    showQrModal: true, // built-in modal: QR on desktop, deep-links on mobile
    metadata: {
      name: "Nock Wallet",
      description: "A non-custodial Nockchain web wallet powered by rose-ts.",
      url: origin,
      icons: [`${origin}/pwa-192x192.png`],
    },
  })) as unknown as WcProvider;

  // If the wallet ends the session, drop the stale provider so the next connect
  // starts clean and getProvider() stops resolving it.
  provider.on("disconnect", () => {
    unregisterWallet(WALLETCONNECT_RDNS);
    wcProvider = null;
  });

  wcProvider = provider;
  return provider;
}

/** Open the mobile wallet (deep-link/QR) and register it as the active provider. */
export async function connectWalletConnect(): Promise<Address> {
  const provider = await initWcProvider();
  const accounts = provider.session ? provider.accounts : await provider.enable();
  const address = accounts[0];
  if (!address) throw new Error("WalletConnect returned no account");
  registerExternalWallet(WC_INFO, provider as unknown as EIP1193Provider);
  return address as Address;
}

/**
 * Re-attach a previously persisted WalletConnect session (no popup). Called on
 * load so a reopened PWA reconnects silently. Returns the account or null.
 */
export async function restoreWalletConnect(): Promise<Address | null> {
  if (!isWalletConnectConfigured()) return null;
  try {
    const provider = await initWcProvider();
    if (provider.session && provider.accounts[0]) {
      registerExternalWallet(WC_INFO, provider as unknown as EIP1193Provider);
      return provider.accounts[0] as Address;
    }
  } catch {
    // no persisted session / relay unavailable
  }
  return null;
}

/** Remove WalletConnect's persisted state so the next connect starts clean and
 *  shows the wallet picker. Without this, a surviving `wc@2:*` session makes the
 *  next connect silently re-attach the old wallet, and `WALLETCONNECT_DEEPLINK_
 *  CHOICE` makes the mobile modal auto-deep-link to the last wallet (e.g. Trust)
 *  instead of letting the user pick. Best-effort: runs even if `disconnect()`
 *  threw because the relay was unreachable. */
function purgeWalletConnectStorage(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("wc@2:") || k === "WALLETCONNECT_DEEPLINK_CHOICE")) {
        stale.push(k);
      }
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch {
    // storage unavailable — nothing more we can do
  }
}

/** Tear down the active WalletConnect session and purge its persisted state. */
export async function disconnectWalletConnect(): Promise<void> {
  unregisterWallet(WALLETCONNECT_RDNS);
  const provider = wcProvider;
  wcProvider = null;
  if (provider) {
    try {
      await provider.disconnect();
    } catch {
      // relay unreachable — the local purge below still clears the session
    }
  }
  purgeWalletConnectStorage();
}
