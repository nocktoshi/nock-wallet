/**
 * Local transaction history — records sends initiated by this wallet, with a
 * pending → confirmed status. Kept in localStorage keyed by account PKH (not
 * secret; txids + amounts are public on-chain). Incoming transfers aren't here:
 * they'd need UTXO-diff/chain indexing, which is a separate feature.
 */
import type { Digest } from "@nockchain/rose-ts";

export type TxStatus = "pending" | "confirmed" | "failed";

export interface TxRecord {
  txId: string;
  /** Recipient PKH. */
  to: string;
  /** Amount in nicks (bigint as string). */
  amount: string;
  /** Network fee in nicks. */
  fee: string;
  memo?: string;
  /** Unix ms when broadcast. */
  at: number;
  status: TxStatus;
}

const MAX = 50;
const key = (pkh: string) => `rose.tx.${pkh}`;

const listeners = new Set<() => void>();

/** Subscribe to any change (same tab). Returns an unsubscribe fn. */
export function subscribeTxHistory(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn();
}

/** Newest-first history for an account. */
export function getTxHistory(pkh: Digest): TxRecord[] {
  try {
    const raw = localStorage.getItem(key(pkh));
    return raw ? (JSON.parse(raw) as TxRecord[]) : [];
  } catch {
    return [];
  }
}

function save(pkh: string, records: TxRecord[]): void {
  try {
    localStorage.setItem(key(pkh), JSON.stringify(records.slice(0, MAX)));
  } catch {
    /* ignore quota / disabled storage */
  }
  emit();
}

/** Record a freshly-broadcast send as pending (idempotent on txId). */
export function recordPending(pkh: Digest, rec: Omit<TxRecord, "at" | "status">): void {
  const records = getTxHistory(pkh);
  if (records.some((r) => r.txId === rec.txId)) return;
  save(pkh, [{ ...rec, at: Date.now(), status: "pending" }, ...records]);
}

export function setTxStatus(pkh: Digest, txId: string, status: TxStatus): void {
  const records = getTxHistory(pkh);
  let changed = false;
  const next = records.map((r) => {
    if (r.txId === txId && r.status !== status) {
      changed = true;
      return { ...r, status };
    }
    return r;
  });
  if (changed) save(pkh, next);
}
