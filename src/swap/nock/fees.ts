import {
  Digest,
  lockFromList,
  noteDataEmpty,
  noteHash,
  pkhSingle,
  SpendBuilder,
  spendConditionNewPkh,
  TxBuilder,
  txEngineSettingsV1BythosDefault,
  type Note,
} from "@nockchain/rose-ts";

const NICKS_PER_NOCK = 65536n;
/** Simulated note must cover gift + fee; fee word count is gift-independent. */
const FEE_SIM_HEADROOM = 4n * NICKS_PER_NOCK;

function noteAssetsNicks(note: Note): bigint {
  const a = (note as { assets?: string }).assets;
  return a != null ? BigInt(a) : 0n;
}

/** Inflate assets so recalcAndSetFee can assign fee without throwing. */
function noteForLockFeeSim(note: Note, giftNicks: bigint): Note {
  const assets = noteAssetsNicks(note);
  const minSim = giftNicks + FEE_SIM_HEADROOM;
  if (assets >= minSim) return note;
  return { ...note, assets: String(minSim) };
}

/**
 * Estimate the on-chain fee for an HTLC lock tx (same builder path as lockNock).
 * Lock-root identity does not affect word count when output note_data is empty.
 */
export function estimateLockTxFeeNicks(
  inputNote: Note,
  giftNicks: bigint,
  sellerPkh: Digest,
  lockRootPlaceholder: Digest = sellerPkh
): bigint {
  if (giftNicks <= 0n) return 0n;
  try {
    const simNote = noteForLockFeeSim(inputNote, giftNicks);
    const inputLock = lockFromList([spendConditionNewPkh(pkhSingle(sellerPkh))]);
    const spend = SpendBuilder.new(simNote, inputLock, 0, inputLock);
    const parentHash = noteHash(simNote);
    spend.seed({
      lock_root: lockRootPlaceholder,
      note_data: noteDataEmpty(),
      gift: String(giftNicks),
      parent_hash: parentHash,
    } as never);
    spend.computeRefund(false);
    const builder = new TxBuilder(txEngineSettingsV1BythosDefault());
    builder.spend(spend);
    builder.recalcAndSetFee(false);
    return BigInt(builder.calcFee());
  } catch {
    return 2n * NICKS_PER_NOCK;
  }
}