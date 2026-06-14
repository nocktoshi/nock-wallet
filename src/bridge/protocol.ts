/** Wire protocol for the dApp ⇄ wallet-popup bridge (postMessage). Kept tiny and
 * dependency-free so the connector SDK can mirror it verbatim. */

export type BridgeMethod = "nock_connect" | "nock_signTx" | "nock_signMessage";

export interface BridgeReady {
  __roseBridge: 1;
  kind: "ready";
}
export interface BridgeRequest {
  __roseBridge: 1;
  kind: "request";
  id: string;
  method: BridgeMethod;
  params?: unknown;
}
export interface BridgeResponse {
  __roseBridge: 1;
  kind: "response";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}
export type BridgeMessage = BridgeReady | BridgeRequest | BridgeResponse;

export function isBridgeMessage(d: unknown): d is BridgeMessage {
  return (
    !!d &&
    typeof d === "object" &&
    (d as { __roseBridge?: unknown }).__roseBridge === 1 &&
    typeof (d as { kind?: unknown }).kind === "string"
  );
}

export function newRequestId(): string {
  return (
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
}

export const BRIDGE_METHODS: readonly BridgeMethod[] = [
  "nock_connect",
  "nock_signTx",
  "nock_signMessage",
];
