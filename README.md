# Nock Wallet

<img width="500" height="811" alt="image" src="https://github.com/user-attachments/assets/e8d88109-4776-4918-aa64-2efa321b3ad5" />


A non-custodial **Nockchain web wallet** — create/import a wallet, send & receive NOCK, and connect dApps — built entirely on the pure-TypeScript [`@nockchain/rose-ts`](https://www.npmjs.com/package/@nockchain/rose-ts) primitives (no WebAssembly).

## Features

- **Passwordless onboarding** — create a wallet (24-word phrase + backup verification) or import one, then secure it with a **passkey or YubiKey**. No password anywhere.
- **Accounts** — multiple SLIP-10 accounts; rename, hide, switch; watch-only (view-only) accounts for external/Ledger-held addresses.
- **Send / Receive** — coin selection + auto fee via `rose-ts` `TxBuilder.simpleSpend`, signed locally and broadcast over gRPC-web; receive screen with QR.
- **Security** — AES-GCM envelope vault (a DEK encrypts the payload; each passkey/YubiKey wraps the DEK via WebAuthn **PRF**); unlock with any enrolled passkey; enroll backup keys; auto-lock; reveal recovery phrase behind a passkey tap. The recovery phrase is the only fallback.
- **dApp bridge** — a hosted-wallet popup that other sites connect to via [`@rose-web/connect`](./packages/connect), injecting an Iris-compatible `window.nockchain` (`nock_connect` / `nock_signTx` / `nock_signMessage`).
- **Price** — optional NOCK/USD display.

## Requirements

- **Node ≥ 20.19** (Vite 8). This repo is pinned to `v24.16.0` (`.nvmrc`).
  ```bash
  npm run build
  ```

## Develop

```bash
npm install
cp .env.example .env   # optional (price feed, WalletConnect project id)
npm run dev            # http://localhost:5173
```

`npm test` (vitest), `npm run lint` (eslint), `npm run build` (eslint + tsc + vite build → `dist/`).

## Install as an app (PWA) & mobile wallets

The wallet is a **Progressive Web App**: on Android/Chromium an "Install Nock
Wallet" banner offers to add it to the home screen (iOS Safari shows the
Share → *Add to Home Screen* hint), after which it runs standalone. Installability
needs HTTPS — the dev server already serves HTTPS via `@vitejs/plugin-basic-ssl`,
and any normal static deploy is HTTPS.

To **buy NOCK with USDC** the Swap screen connects an Ethereum wallet on Base.
Two paths are supported:

- **Injected (EIP-6963)** — desktop extensions, or a wallet's in-app browser.
- **WalletConnect** — connects mobile wallets (Phantom, MetaMask, …) from the
  installed PWA via deep-link (mobile) or QR (desktop). This is the path that
  makes "connect Phantom/MetaMask on Android" work, since those wallets don't
  inject into a normal mobile browser. It requires a free **project id** from
  [cloud.reown.com](https://cloud.reown.com), set as `VITE_WALLETCONNECT_PROJECT_ID`
  at build time. Without it, the WalletConnect option is hidden and only injected
  wallets are offered.

To replace the placeholder app icon, drop your square PNG (≥512×512) at
`public/app-icon.png` and regenerate:

```bash
npx pwa-assets-generator --preset minimal-2023 public/app-icon.png
```

## Nockchain RPC

Settings → **Nockchain RPC endpoint** picks between:

| Endpoint | Browser CORS | Notes |
|---|---|---|
| `rpc.nockbox.org` | ✅ yes | Works directly from a static deploy — the default. |
| `rpc.nockchain.net` | ❌ no | Must sit behind a same-origin proxy. |

In **dev**, both are routed through the Vite proxy (`/__rpc/<id>`), so either works locally. In **production**, the browser calls the selected endpoint directly: `rpc.nockbox.org` works as-is; to use `rpc.nockchain.net` you must serve the wallet behind a proxy that forwards `/__rpc/nockchain/*` (or the gRPC-web path) to it with CORS — e.g. a Cloudflare Pages Function / Worker.

## Deploy

```bash
npm run build         # → dist/ (static)
```

Host `dist/` on any static host (Cloudflare Pages, etc.). Because the wallet is non-custodial and keys live only in the browser, no backend is required when using `rpc.nockbox.org`. The `/connect` route doubles as the dApp-connection popup.

## Connect a dApp / "Sign in with Nock Wallet"

Another site can pop open this hosted wallet to authenticate a user — no extension to install. Add the connector SDK ([`@rose-web/connect`](./packages/connect)) to your app; it injects an **Iris-compatible `window.nockchain`** and proxies requests to a popup at `https://<wallet>/connect`. The wallet stays the trust boundary: the user taps their passkey and approves each request in the popup; your site never sees keys.

### 1. Install the provider

```ts
import { installNockchainProvider } from "@rose-web/connect";

// Call once at startup. Injects window.nockchain and fires `nockchain#initialized`.
installNockchainProvider({ walletUrl: "https://your-rose-web-deploy" });
```

Existing Iris-extension dApps work unchanged — they already look for `window.nockchain`.

### 2. Connect (opens the wallet popup)

```ts
// Must be called from a user gesture (click) so the browser allows the popup.
const { pkh, address } = await window.nockchain.request({ method: "nock_connect" });
// The popup opens, the user unlocks with their passkey and approves; you get their address.
```

### 3. Sign in (authenticate to your backend)

Have the user prove control of `pkh` by signing a server-issued challenge. The wallet pops open again for the signature; your server verifies it.

```ts
// browser
const { nonce } = await fetch("/auth/nonce").then((r) => r.json());
const { signature, publicKey } = await window.nockchain.request({
  method: "nock_signMessage",
  params: { message: `Sign in to example.com: ${nonce}` },
});
await fetch("/auth/verify", {
  method: "POST",
  body: JSON.stringify({ pkh, publicKey, signature, nonce }),
});
```

```ts
// server (Node / Worker) — verify with rose-ts, then start a session
import { verifySignature, hashPublicKey, publicKeyFromHex, publicKeyToBeBytes } from "@nockchain/rose-ts";

const pub = publicKeyToBeBytes(publicKeyFromHex(publicKey)!); // 97-byte key
const message = `Sign in to example.com: ${nonce}`;          // re-derive, don't trust the client
const ok =
  consumeNonce(nonce) &&                       // single-use, unexpired
  hashPublicKey(pub) === pkh &&                // the key really hashes to the claimed address
  verifySignature(pub, signature, message);    // and it signed your challenge
if (ok) startSession(pkh);
```

The three checks together bind the session to the address: the nonce stops replay, `hashPublicKey(pub) === pkh` stops someone claiming an address they don't own, and `verifySignature` proves possession of the key.

### Provider API

`window.nockchain.request({ method, params?, timeout? })` supports:

| Method | Params | Returns |
|---|---|---|
| `nock_connect` | – | `{ pkh, address }` |
| `nock_signMessage` | `{ message: string }` | `{ signature, publicKey }` |
| `nock_signTx` | `{ tx, notes }` | `{ tx }` (signed) |

Plus the `nockchain#initialized` event and `on`/`off`. The wallet enforces strict `event.origin` checks, shows the requesting origin in every approval, and a closed popup rejects the pending request.

## Security model

- **Passwordless**: the vault DEK is wrapped only by passkey/YubiKey PRF outputs — there is no password to phish or brute-force. Private keys exist only in memory while unlocked, and only for the duration of a signing call; the encrypted vault lives in IndexedDB.
- **A passkey/YubiKey is a touch-gated unlock method, not a signer** — Nockchain's Cheetah curve can't be signed on FIDO/PIV hardware, so signing always happens in JS after unlock.
- **Requires WebAuthn PRF** — Chromium desktop/Android, or a platform authenticator (Touch ID / Windows Hello), or a FIDO2 security key. Enroll a **backup** passkey so a lost device doesn't lock you out.
- The **recovery phrase is the only fallback** — keep it offline. With it you can restore on any device (and enroll a new passkey); without it and with all passkeys lost, the wallet is unrecoverable.
- Not audited. Use at your own risk.
