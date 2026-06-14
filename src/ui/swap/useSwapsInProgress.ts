import { useCallback, useEffect, useMemo, useState } from "react";
import type { Digest } from "@nockchain/rose-ts";
import type { SwapPublic } from "../../swap/swap.js";
import { getSwapRepository } from "../../swap/app/repo/swap-repo.js";
import { useSwapWalletAuth } from "./wallet-auth.js";

function byNewest(a: SwapPublic, b: SwapPublic): number {
  return (b.createdAt ?? 0) - (a.createdAt ?? 0);
}

export interface SwapsInProgressState {
  swaps: SwapPublic[];
  loading: boolean;
  error: string;
  refresh: () => void;
}

export function useSwapsInProgress(pkh: Digest | undefined, pollMs = 30_000): SwapsInProgressState {
  useSwapWalletAuth();
  const repo = useMemo(() => getSwapRepository(), []);
  const [swaps, setSwaps] = useState<SwapPublic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!pkh) {
      setSwaps([]);
      setError("");
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    void repo
      .listForNockPkh(pkh)
      .then((list) => {
        if (!alive) return;
        setSwaps(list.sort(byNewest));
      })
      .catch((e) => {
        if (!alive) return;
        setSwaps([]);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [pkh, repo, nonce]);

  useEffect(() => {
    if (!pkh || pollMs <= 0) return;
    const id = window.setInterval(refresh, pollMs);
    return () => window.clearInterval(id);
  }, [pkh, pollMs, refresh]);

  return { swaps, loading, error, refresh };
}