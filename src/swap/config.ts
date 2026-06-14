import type { Address } from "viem";
import { base } from "viem/chains";
import { readEnv } from "../env.js";

export const CHAIN = base;
export const CHAIN_ID = Number(readEnv("VITE_CHAIN_ID") ?? base.id);

export const USDC_ADDRESS =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;

export const HTLC_ADDRESS = (readEnv("VITE_HTLC_ADDRESS") ??
  "0x5ac37e7A63b107d226d0b88129B8EB8b07172B75") as Address;

const kvFromEnv = (readEnv("VITE_KV_URL") ?? "").trim();
export const KV_URL = kvFromEnv || "https://api.atomicnock.com";

export const NOCK_BLOCK_SECONDS = 150;
export const DEFAULT_USDC_TIMEOUT_SEC = 12 * 3600;
export const DEFAULT_NOCK_REFUND_DELTA = 720n;
export const SWAP_SAFETY_MARGIN_SEC = 4 * 3600;
export const MIN_USDC_WINDOW_SEC = 60 * 60;
export const MIN_NOCK_AMOUNT = 50;
export const MIN_NOCK_NICKS = BigInt(MIN_NOCK_AMOUNT * 65536);

/** Short USDC window for solver-facing sell orders (~2h). */
export const SOLVER_ASK_WINDOW_SEC = 2 * 3600;

export type TokenKey = "USDC";

export interface TokenInfo {
  key: TokenKey;
  address: Address;
  htlc: Address;
  symbol: string;
  kind: "usd";
}

export const USDC_TOKEN: TokenInfo = {
  key: "USDC",
  address: USDC_ADDRESS,
  htlc: HTLC_ADDRESS,
  symbol: "USDC",
  kind: "usd",
};

export function tokenInfo(token?: string): TokenInfo {
  void token;
  return USDC_TOKEN;
}