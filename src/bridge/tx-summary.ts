/**
 * Decode a dApp-supplied NockchainTx into reviewable figures for the approval
 * popup, so the user isn't blind-signing. We surface what's reliably derivable
 * locally — total value leaving, per-output amounts, network fee, tx id — which
 * defeats silent drains (a large total is visible). rose-ts has no local
 * recipient-pkh extractor, so addresses are not shown; the popup says so.
 */
import {
  nockchainTxToRawTx,
  rawTxTotalFees,
  rawTxV1CalcId,
  nockchainTxOutputs,
  txEngineSettingsV1BythosDefault,
  type NockchainTx,
} from "@nockchain/rose-ts";

export interface TxSummary {
  txId: string | null;
  feeNicks: bigint | null;
  outputs: { amountNicks: bigint }[];
  totalOutNicks: bigint | null;
  /** True when output notes decoded; false → show the "couldn't decode" warning. */
  decoded: boolean;
}

function noteAssets(n: unknown): bigint {
  const direct = (n as { assets?: unknown }).assets;
  if (direct != null) return BigInt(String(direct));
  const v1 = (n as { note_version?: { v1?: { assets?: unknown } } }).note_version?.v1?.assets;
  return v1 != null ? BigInt(String(v1)) : 0n;
}

/** Best-effort, never throws — degrades to {decoded:false} on any failure. */
export function summarizeTx(tx: NockchainTx): TxSummary {
  let txId: string | null = null;
  let feeNicks: bigint | null = null;
  try {
    const raw = nockchainTxToRawTx(tx);
    feeNicks = BigInt(String(rawTxTotalFees(raw)));
    txId = rawTxV1CalcId(raw);
  } catch {
    /* fee/id unavailable */
  }

  let outputs: { amountNicks: bigint }[] = [];
  let decoded = false;
  try {
    outputs = nockchainTxOutputs(tx, 0, txEngineSettingsV1BythosDefault()).map((n) => ({
      amountNicks: noteAssets(n),
    }));
    decoded = true;
  } catch {
    /* outputs undecodable */
  }

  return {
    txId,
    feeNicks,
    outputs,
    totalOutNicks: decoded ? outputs.reduce((s, o) => s + o.amountNicks, 0n) : null,
    decoded,
  };
}
