/** NOCK/USD price feed. Reads VITE_PRICE_URL (CoinGecko-like JSON); degrades to
 * null (price hidden) when unset or on error. Ported from the Atomic Nock app. */
import { readEnv } from "../env.js";
import { NICKS_PER_NOCK } from "../nock/units.js";

/** Pull a USD number out of common JSON shapes (CoinGecko simple/price etc.). */
export function extractUsd(data: unknown): number | null {
  if (typeof data === "number") return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") {
        const usd = (v as Record<string, unknown>).usd;
        if (typeof usd === "number") return usd;
      }
    }
    if (typeof o.usd === "number") return o.usd;
    if (typeof o.price === "number") return o.price;
  }
  return null;
}

let cache: { value: number | null; at: number } | null = null;

/** Current NOCK price in USD, cached briefly; null when unavailable. */
export async function getNockUsd(ttlMs = 60_000, fetcher: typeof fetch = fetch): Promise<number | null> {
  const url = readEnv("VITE_PRICE_URL");
  if (!url) return null;
  const now = Date.now();
  if (cache && now - cache.at < ttlMs) return cache.value;
  let value: number | null = null;
  try {
    const res = await fetcher(url);
    if (res.ok) value = extractUsd(await res.json());
  } catch {
    value = null;
  }
  cache = { value: value != null && isFinite(value) ? value : null, at: now };
  return cache.value;
}

/** USD value of an amount in nicks at a given NOCK/USD price. */
export function nicksToUsd(nicks: bigint, nockUsd: number): number {
  return (Number(nicks) / Number(NICKS_PER_NOCK)) * nockUsd;
}

/** Format a USD number as "$1,234.56". */
export function formatUsd(usd: number): string {
  return usd.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
