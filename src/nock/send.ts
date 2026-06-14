/**
 * Send pipeline (pure rose-ts): coin-select → TxBuilder.simpleSpend (auto fee) →
 * read fee/change for review → sign(PrivateKey) → RpcClient.sendTransaction →
 * poll transactionAccepted.
 */
import {
  TxBuilder,
  txEngineSettingsV1BythosDefault,
  lockFromList,
  spendConditionNewPkh,
  pkhSingle,
  PrivateKey,
  nockchainTxToRawTx,
  rawTxV1CalcId,
  rawTxTotalFees,
  type Digest,
  type Nicks,
  type TxLock,
} from "@nockchain/rose-ts";
import { makeRpcClient } from "../rpc/client.js";
import type { WalletNote } from "./balance.js";

export interface PreparedSend {
  builder: TxBuilder;
  /** Input notes consumed. */
  inputs: WalletNote[];
  amount: bigint;
  fee: bigint;
  /** Change returned to sender (>= 0). */
  change: bigint;
}

export interface SendInput {
  senderPkh: Digest;
  recipientPkh: Digest;
  amount: bigint;
  notes: WalletNote[];
  /** Explicit fee in nicks; omit/null for auto. */
  feeOverride?: bigint | null;
  memo?: string;
}

function pkhLock(pkh: Digest): TxLock {
  return { lock: lockFromList([spendConditionNewPkh(pkhSingle(pkh))]), lock_sp_index: 0 };
}

/**
 * Build (unsigned) a spend, growing the input set largest-first until it covers
 * amount + fee. Returns the prepared builder plus fee/change for the review step.
 */
export function prepareSend(input: SendInput): PreparedSend {
  const { senderPkh, recipientPkh, amount, notes, feeOverride, memo } = input;
  if (amount <= 0n) throw new Error("Amount must be greater than zero");
  if (notes.length === 0) throw new Error("No spendable notes");

  const lock = pkhLock(senderPkh);
  const settings = txEngineSettingsV1BythosDefault();

  const selected: WalletNote[] = [];
  for (const n of notes) {
    selected.push(n);
    try {
      const builder = new TxBuilder(settings);
      builder.simpleSpend(
        selected.map((s) => s.note),
        selected.map(() => lock),
        recipientPkh,
        String(amount) as Nicks,
        feeOverride != null ? (String(feeOverride) as Nicks) : null,
        senderPkh,
        true,
        memo ? { memo } : undefined
      );
      const tx = builder.build();
      const fee = BigInt(rawTxTotalFees(nockchainTxToRawTx(tx)) as unknown as string);
      const inputsTotal = selected.reduce((s, x) => s + x.assets, 0n);
      const change = inputsTotal - amount - fee;
      if (change < 0n) continue; // shouldn't happen (build would have thrown), but be safe
      return { builder, inputs: [...selected], amount, fee, change };
    } catch (e) {
      if (e instanceof Error && /insufficient/i.test(e.message)) continue;
      throw e;
    }
  }
  throw new Error("Insufficient balance to cover amount + network fee");
}

/** Sign the prepared spend and broadcast it. Returns the tx id (does not wait). */
export async function signAndBroadcast(
  prepared: PreparedSend,
  privateKeyBytes: Uint8Array
): Promise<string> {
  const { builder } = prepared;
  await builder.sign(PrivateKey.fromBytes(privateKeyBytes));
  const tx = builder.build();
  const txId = rawTxV1CalcId(nockchainTxToRawTx(tx));
  await makeRpcClient().sendTransaction(tx);
  return txId;
}

/** Single check: has the node accepted this tx id? Never throws. */
export async function isTxAccepted(txId: string): Promise<boolean> {
  try {
    return await makeRpcClient().transactionAccepted(txId);
  } catch {
    return false;
  }
}

/** Poll until the node accepts the tx id, or the timeout elapses. */
export async function waitTxAccepted(txId: string, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isTxAccepted(txId)) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}
