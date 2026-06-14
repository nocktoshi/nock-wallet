import { useCallback, useEffect, useState } from "react";
import type { Digest } from "@nockchain/rose-ts";
import { fetchBalance, type WalletNote } from "../nock/balance.js";
import { getNockUsd } from "../market/price.js";
import { isTxAccepted } from "../nock/send.js";
import {
  getTxHistory,
  setTxStatus,
  subscribeTxHistory,
  type TxRecord,
} from "../wallet/history.js";

export interface BalanceState {
  loading: boolean;
  total: bigint;
  notes: WalletNote[];
  blockId?: string;
  error: string;
  refresh: () => void;
}

/** Fetch + poll the balance for a PKH. Re-fetches when `pkh` changes. */
export function useBalance(pkh: Digest | undefined, pollMs = 15_000): BalanceState {
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0n);
  const [notes, setNotes] = useState<WalletNote[]>([]);
  const [blockId, setBlockId] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!pkh) return;
    let alive = true;
    setLoading(true);
    setError("");
    fetchBalance(pkh)
      .then((r) => {
        if (!alive) return;
        setTotal(r.total);
        setNotes(r.notes);
        setBlockId(r.height?.toString());
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [pkh, nonce]);

  useEffect(() => {
    if (!pkh || pollMs <= 0) return;
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [pkh, pollMs, refresh]);

  return { loading, total, notes, blockId, error, refresh };
}

/** Local send history for an account, with pending → confirmed reconciliation. */
export function useTxHistory(pkh: Digest | undefined): TxRecord[] {
  const [records, setRecords] = useState<TxRecord[]>([]);

  useEffect(() => {
    if (!pkh) {
      setRecords([]);
      return;
    }
    const read = () => setRecords(getTxHistory(pkh));
    read();
    const unsub = subscribeTxHistory(read);

    let alive = true;
    const reconcile = async () => {
      for (const r of getTxHistory(pkh)) {
        if (!alive) return;
        if (r.status === "pending" && (await isTxAccepted(r.txId))) {
          setTxStatus(pkh, r.txId, "confirmed");
        }
      }
    };
    void reconcile();
    const id = setInterval(() => void reconcile(), 20_000);

    return () => {
      alive = false;
      unsub();
      clearInterval(id);
    };
  }, [pkh]);

  return records;
}

/** NOCK/USD price, or null when no price feed is configured. Polls every 60s. */
export function useNockUsd(): number | null {
  const [price, setPrice] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => getNockUsd().then((p) => alive && setPrice(p)).catch(() => {});
    tick();
    const id = setInterval(tick, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return price;
}
