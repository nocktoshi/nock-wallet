import { KV_URL } from "../swap/config.js";
import type { RfqSide, SolverRfqResponse } from "./solver-rfq.js";

/** Client timeout — comfortably above the worker's RFQ_HOLD_MS hold (~8s). */
const REQUEST_TIMEOUT_MS = 15_000;
/** Bounded re-POSTs when the worker returns a transient busy/expired. */
const MAX_ATTEMPTS = 2;

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

/**
 * Request a sized solver quote. The worker holds the POST open until the solver
 * answers over the queue, so the response IS the quote — no polling. A transient
 * `busy`/`expired` is re-POSTed a bounded number of times.
 */
export async function requestSolverRfq(
  side: RfqSide,
  amountIn: string,
  signal?: AbortSignal
): Promise<SolverRfqResponse> {
  const base = baseUrl();
  if (!base) throw new Error("Swap API not configured (VITE_KV_URL)");

  let last: SolverRfqResponse | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    // Bound the held request; the worker returns well before this fires.
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const res = await fetch(`${base}/solver/rfq`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side, amountIn }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (res.status === 429) {
      const retrySec = Number(res.headers.get("retry-after"));
      await sleep((Number.isFinite(retrySec) && retrySec > 0 ? retrySec : 1) * 1000, signal);
      continue;
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `RFQ failed (${res.status})`);
    }
    last = (await res.json()) as SolverRfqResponse;
    if (last.status !== "busy" && last.status !== "expired") return last;
  }
  return (
    last ?? {
      rfqId: "",
      side,
      status: "expired",
      expiresAt: Date.now(),
      reason: "Quote timed out — try again",
    }
  );
}
