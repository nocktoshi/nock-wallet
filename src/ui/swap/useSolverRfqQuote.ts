import { useEffect, useRef, useState } from "react";
import { requestSolverRfq, fetchSolverOnline } from "../../market/solver-rfq-client.js";
import type { RfqSide, SolverRfqResponse } from "../../market/solver-rfq.js";
import { belowMinNock, minNockAmountError } from "./util.js";

const DEBOUNCE_MS = 700;

function isPositiveAmount(v: string): boolean {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0;
}

export interface SolverRfqQuoteState {
  loading: boolean;
  quote: SolverRfqResponse | null;
  error: string | null;
  online: boolean | null;
}

/** Debounced solver RFQ — fetches a quote shortly after the user stops typing. */
export function useSolverRfqQuote(side: RfqSide, amountIn: string): SolverRfqQuoteState {
  const [quote, setQuote] = useState<SolverRfqResponse | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [debouncedAmount, setDebouncedAmount] = useState("");
  const reqId = useRef(0);

  useEffect(() => {
    let alive = true;
    void fetchSolverOnline()
      .then((o) => {
        if (alive) setOnline(o);
      })
      .catch(() => {
        if (alive) setOnline(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const trimmed = amountIn.trim();

  useEffect(() => {
    if (!isPositiveAmount(trimmed)) {
      const t = window.setTimeout(() => {
        setDebouncedAmount("");
        setQuote(null);
        setError(null);
        setFetching(false);
      }, 0);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setDebouncedAmount(trimmed), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [trimmed]);

  useEffect(() => {
    if (!debouncedAmount) return;

    if (side === "sell" && belowMinNock(parseFloat(debouncedAmount))) {
      setQuote(null);
      setError(minNockAmountError());
      setFetching(false);
      return;
    }

    const id = ++reqId.current;
    const ac = new AbortController();
    void (async () => {
      setFetching(true);
      setError(null);
      try {
        const result = await requestSolverRfq(side, debouncedAmount, ac.signal);
        if (reqId.current !== id || ac.signal.aborted) return;

        setOnline(result.status !== "offline");
        setQuote(result);

        if (result.status === "ready" && result.amountOut && side === "buy") {
          if (belowMinNock(parseFloat(result.amountOut))) {
            setError(minNockAmountError());
          }
        } else if (result.status === "offline") {
          setError(result.reason ?? "Solver offline — try again shortly");
        } else if (result.status === "rejected" || result.status === "expired") {
          setError(result.reason ?? "Quote unavailable");
        }
      } catch (e) {
        if (reqId.current !== id || ac.signal.aborted) return;
        if ((e as Error).name === "AbortError") return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setQuote({
          rfqId: "",
          side,
          status: "offline",
          expiresAt: Date.now(),
          reason: msg,
        });
      } finally {
        if (reqId.current === id) setFetching(false);
      }
    })();

    return () => ac.abort();
  }, [side, debouncedAmount]);

  const hasAmount = isPositiveAmount(trimmed);
  const settled = quote != null && quote.status !== "pending";
  const amountMatches = !quote?.amountIn || quote.amountIn === trimmed;
  const sideMatches = quote?.side === side;
  const showQuote = settled && amountMatches && sideMatches;
  const loading = hasAmount && fetching;

  const terminal =
    quote != null &&
    quote.status !== "ready" &&
    quote.status !== "pending" &&
    amountMatches &&
    sideMatches;

  return {
    quote: hasAmount && (showQuote || terminal) ? quote : null,
    loading,
    error,
    online,
  };
}