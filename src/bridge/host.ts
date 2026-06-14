/**
 * Wallet-side bridge host. `BridgeHost` is a framework-agnostic approval queue
 * (testable without windows); `attachBridgeHost` wires it to a real window's
 * postMessage; `executeBridgeMethod` performs the approved action with the
 * unlocked wallet. The popup is the trust boundary: every request carries the
 * requesting origin, and signing only happens after explicit user approval.
 */
import {
  PrivateKey,
  TxBuilder,
  txEngineSettingsV1BythosDefault,
  signMessage,
  publicKeyToHex,
  publicKeyFromBeBytes,
  type NockchainTx,
} from "@nockchain/rose-ts";
import {
  isBridgeMessage,
  type BridgeMethod,
  type BridgeReady,
  type BridgeResponse,
} from "./protocol.js";
import type { WalletStore } from "../wallet/wallet.js";

export interface PendingRequest {
  id: string;
  method: BridgeMethod;
  params: unknown;
  /** Origin of the requesting dApp (shown in the approval UI). */
  origin: string;
}

type Reply = (resp: BridgeResponse) => void;

export class BridgeHost {
  private queue: { req: PendingRequest; reply: Reply }[] = [];
  private listeners = new Set<() => void>();

  enqueue(req: PendingRequest, reply: Reply): void {
    this.queue.push({ req, reply });
    this.emit();
  }

  /** The request currently awaiting approval (FIFO). */
  current(): PendingRequest | null {
    return this.queue[0]?.req ?? null;
  }

  pendingCount(): number {
    return this.queue.length;
  }

  approve(id: string, result: unknown): void {
    this.settle(id, { ok: true, result });
  }

  reject(id: string, error: string): void {
    this.settle(id, { ok: false, error });
  }

  /** Reject everything (e.g. popup closing). */
  rejectAll(error: string): void {
    for (const { req } of [...this.queue]) this.settle(req.id, { ok: false, error });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private settle(id: string, partial: Omit<BridgeResponse, "__roseBridge" | "kind" | "id">): void {
    const idx = this.queue.findIndex((q) => q.req.id === id);
    if (idx === -1) return;
    const [entry] = this.queue.splice(idx, 1);
    entry.reply({ __roseBridge: 1, kind: "response", id, ...partial });
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

/** Wire a host to a window: listen for requests, signal readiness to the opener. */
export function attachBridgeHost(host: BridgeHost, win: Window = window): () => void {
  const onMessage = (event: MessageEvent) => {
    const d = event.data;
    if (!isBridgeMessage(d) || d.kind !== "request") return;
    const source = event.source as WindowProxy | null;
    if (!source) return;
    const origin = event.origin;
    host.enqueue({ id: d.id, method: d.method, params: d.params, origin }, (resp) =>
      source.postMessage(resp, origin)
    );
  };
  win.addEventListener("message", onMessage);

  // Tell the opener we're ready to receive requests. The ready ping carries no
  // secret; the SDK validates it came from the wallet origin.
  const opener = win.opener as WindowProxy | null;
  if (opener) {
    const ready: BridgeReady = { __roseBridge: 1, kind: "ready" };
    opener.postMessage(ready, "*");
  }

  return () => win.removeEventListener("message", onMessage);
}

/** Perform an approved request with the unlocked wallet. */
export async function executeBridgeMethod(
  method: BridgeMethod,
  params: unknown,
  wallet: WalletStore
): Promise<unknown> {
  const active = wallet.getActiveAccount(); // throws if locked
  const ext = wallet.getExtendedKey(active.index);
  if (!ext.privateKey) throw new Error("This account cannot sign (no private key)");

  switch (method) {
    case "nock_connect":
      return { pkh: active.pkh, address: active.pkh };

    case "nock_signMessage": {
      const message = (params as { message?: unknown } | null)?.message;
      if (typeof message !== "string") throw new Error("signMessage requires a string message");
      const signature = signMessage(ext.privateKey, message);
      return {
        signature,
        publicKey: publicKeyToHex(publicKeyFromBeBytes(ext.publicKey)),
      };
    }

    case "nock_signTx": {
      const tx = (params as { tx?: NockchainTx } | null)?.tx;
      if (!tx) throw new Error("signTx requires a transaction");
      const builder = TxBuilder.fromNockchainTx(tx, txEngineSettingsV1BythosDefault());
      await builder.sign(PrivateKey.fromBytes(ext.privateKey));
      return { tx: builder.build() };
    }

    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

/** Human-readable summary of a request for the approval UI. */
export function describeRequest(req: PendingRequest): { title: string; detail: string } {
  switch (req.method) {
    case "nock_connect":
      return { title: "Connect wallet", detail: "Share your account address with this site." };
    case "nock_signMessage":
      return {
        title: "Sign message",
        detail: String((req.params as { message?: unknown })?.message ?? ""),
      };
    case "nock_signTx":
      return { title: "Sign transaction", detail: "Approve a Nockchain transaction for signing." };
    default:
      return { title: req.method, detail: "" };
  }
}
