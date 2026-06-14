/**
 * @rose-web/connect — drop-in `window.nockchain` provider for dApps, backed by a
 * hosted Nock Wallet wallet popup (postMessage), API-compatible with the Iris
 * extension: `request({ method, params, timeout })`, the `nockchain#initialized`
 * event, and `nock_connect` / `nock_signTx` / `nock_signMessage`.
 *
 * Self-contained (no imports) so it can ship as a standalone package. The wire
 * protocol mirrors the wallet's src/bridge/protocol.ts.
 */

interface BridgeMsg {
  __roseBridge: 1;
  kind: "ready" | "request" | "response";
  id?: string;
  method?: string;
  params?: unknown;
  ok?: boolean;
  result?: unknown;
  error?: string;
}

function isBridgeMsg(d: unknown): d is BridgeMsg {
  return (
    !!d &&
    typeof d === "object" &&
    (d as { __roseBridge?: unknown }).__roseBridge === 1 &&
    typeof (d as { kind?: unknown }).kind === "string"
  );
}

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export interface RpcRequest {
  method: string;
  params?: unknown;
  timeout?: number;
}

export interface NockchainProvider {
  readonly provider: string;
  request<T = unknown>(args: RpcRequest): Promise<T>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
}

const DEFAULT_TIMEOUT = 120_000;

class IrisWebProvider implements NockchainProvider {
  readonly provider = "rose-web";
  private readonly origin: string;
  private popup: Window | null = null;
  private readonly pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly events = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(private readonly walletUrl: string) {
    this.origin = new URL(walletUrl).origin;
    window.addEventListener("message", this.onMessage);
  }

  async request<T>(args: RpcRequest): Promise<T> {
    const popup = await this.ensurePopup();
    const id = newId();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Wallet request "${args.method}" timed out`));
      }, args.timeout ?? DEFAULT_TIMEOUT);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      popup.postMessage(
        { __roseBridge: 1, kind: "request", id, method: args.method, params: args.params },
        this.origin
      );
    });
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    (this.events.get(event) ?? this.events.set(event, new Set()).get(event)!).add(listener);
  }
  off(event: string, listener: (...args: unknown[]) => void): void {
    this.events.get(event)?.delete(listener);
  }

  private onMessage = (event: MessageEvent) => {
    if (event.origin !== this.origin) return;
    const d = event.data;
    if (!isBridgeMsg(d) || d.kind !== "response" || !d.id) return;
    const p = this.pending.get(d.id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(d.id);
    if (d.ok) p.resolve(d.result);
    else p.reject(new Error(d.error || "Wallet rejected the request"));
  };

  /** Open the wallet popup (reusing an open one) and wait for its ready ping. */
  private ensurePopup(): Promise<Window> {
    if (this.popup && !this.popup.closed) return Promise.resolve(this.popup);
    return new Promise((resolve, reject) => {
      const w = window.open(
        `${this.walletUrl.replace(/\/$/, "")}/connect`,
        "rose-web-wallet",
        "width=420,height=660,resizable,scrollbars"
      );
      if (!w) {
        reject(new Error("Popup blocked — allow popups for this site to connect your wallet."));
        return;
      }
      const onReady = (event: MessageEvent) => {
        if (event.origin !== this.origin) return;
        if (isBridgeMsg(event.data) && event.data.kind === "ready") {
          window.removeEventListener("message", onReady);
          clearTimeout(timer);
          this.popup = w;
          resolve(w);
        }
      };
      const timer = setTimeout(() => {
        window.removeEventListener("message", onReady);
        reject(new Error("Wallet did not respond. Is the popup blocked?"));
      }, 20_000);
      window.addEventListener("message", onReady);
    });
  }
}

export interface InstallOptions {
  /** Base URL of the hosted Nock Wallet wallet, e.g. "https://wallet.rose.example". */
  walletUrl: string;
}

/** Install the provider as `window.nockchain` and fire `nockchain#initialized`. */
export function installNockchainProvider(opts: InstallOptions): NockchainProvider {
  const provider = new IrisWebProvider(opts.walletUrl);
  (window as unknown as { nockchain?: NockchainProvider }).nockchain = provider;
  window.dispatchEvent(new Event("nockchain#initialized"));
  return provider;
}
