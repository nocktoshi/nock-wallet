import { KV_URL } from "../swap/config.js";
import type { RfqSide, SolverRfqResponse } from "./solver-rfq.js";

const POLL_MS = 2_000;
const POLL_INITIAL_DELAY_MS = 500;
const POLL_FALLBACK_MS = 58_000;

function baseUrl(): string | null {
  const u = KV_URL?.replace(/\/$/, "");
  return u || null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const t = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

export async function fetchSolverOnline(): Promise<boolean> {
  const base = baseUrl();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/solver/status`);
    if (!res.ok) return false;
    const { online } = (await res.json()) as { online?: boolean };
    return !!online;
  } catch {
    return false;
  }
}

async function createRfq(side: RfqSide, amountIn: string): Promise<SolverRfqResponse> {
  const base = baseUrl();
  if (!base) throw new Error("Swap API not configured (VITE_KV_URL)");
  const res = await fetch(`${base}/solver/rfq`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ side, amountIn }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `RFQ failed (${res.status})`);
  }
  return (await res.json()) as SolverRfqResponse;
}

async function pollRfq(
  id: string,
  signal?: AbortSignal,
  expiresAt?: number
): Promise<SolverRfqResponse> {
  const base = baseUrl();
  if (!base) throw new Error("Swap API not configured (VITE_KV_URL)");
  const deadline =
    expiresAt != null && expiresAt > Date.now()
      ? expiresAt + 1_000
      : Date.now() + POLL_FALLBACK_MS;
  await sleep(POLL_INITIAL_DELAY_MS, signal);
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const res = await fetch(`${base}/solver/rfq/${encodeURIComponent(id)}`, { signal });
    if (res.status === 429) {
      const retrySec = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retrySec) && retrySec > 0 ? retrySec * 1000 : POLL_MS * 2, signal);
      continue;
    }
    if (!res.ok) throw new Error(`RFQ poll failed (${res.status})`);
    const rfq = (await res.json()) as SolverRfqResponse;
    if (rfq.status !== "pending") return rfq;
    const wait = Math.min(POLL_MS, Math.max(0, deadline - Date.now()));
    if (wait <= 0) break;
    await sleep(wait, signal);
  }
  return {
    rfqId: id,
    side: "sell",
    status: "expired",
    expiresAt: Date.now(),
    reason: "Quote timed out — try again",
  };
}

/** Request a sized solver quote (sell NOCK → USDC, or buy USDC → NOCK). */
export async function requestSolverRfq(
  side: RfqSide,
  amountIn: string,
  signal?: AbortSignal
): Promise<SolverRfqResponse> {
  const created = await createRfq(side, amountIn);
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  if (created.status !== "pending" || !created.rfqId) return created;
  return pollRfq(created.rfqId, signal, created.expiresAt);
}