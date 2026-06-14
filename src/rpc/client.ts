import { RpcClient } from "@nockchain/rose-ts";
import { isDev } from "../env.js";

export interface RpcPreset {
  id: string;
  label: string;
  url: string;
}

/**
 * Selectable Nockchain gRPC-web endpoints.
 */
export const RPC_PRESETS: RpcPreset[] = [
  { id: "nockbox", label: "rpc.nockbox.org", url: "https://rpc.nockbox.org" },
  { id: "nockchain", label: "rpc.nockchain.net", url: "https://rpc.nockchain.net" },
];

export const DEFAULT_RPC_ID = "nockbox";
const RPC_KEY = "rose.rpc";

export function getRpcId(): string {
  try {
    const id = localStorage.getItem(RPC_KEY);
    if (id && RPC_PRESETS.some((p) => p.id === id)) return id;
  } catch {
    /* ignore */
  }
  return DEFAULT_RPC_ID;
}

export function setRpcId(id: string): void {
  try {
    localStorage.setItem(RPC_KEY, id);
  } catch {
    /* ignore */
  }
}

export function getRpcPreset(): RpcPreset {
  return RPC_PRESETS.find((p) => p.id === getRpcId()) ?? RPC_PRESETS[0];
}

/**
 * Resolve the gRPC-web URL for the selected endpoint. In dev, route through the
 * same-origin Vite proxy (`/__rpc/<id>`) so both endpoints work regardless of
 * CORS; in production, call the endpoint directly.
 */
export function getGrpcWebUrl(): string {
  const preset = getRpcPreset();
  if (isDev() && typeof window !== "undefined") {
    return `${window.location.origin}/__rpc/${preset.id}`;
  }
  return preset.url.replace(/\/$/, "");
}

export function makeRpcClient(): RpcClient {
  return new RpcClient(getGrpcWebUrl());
}
