/** Balance + note fetching for a single-PKH wallet account. All notes returned
 * by `getBalanceByFirstName(firstNameForPkh(pkh))` share that first name, so each
 * is spendable with the account's PKH lock (no per-note discovery needed). */
import { noteFromProtobuf, type Digest, type Note } from "@nockchain/rose-ts";
import { makeRpcClient } from "../rpc/client.js";
import { firstNameForPkh } from "./address.js";

export interface WalletNote {
  note: Note;
  assets: bigint;
}

export interface BalanceResult {
  notes: WalletNote[];
  total: bigint;
  blockId?: string;
  height: bigint;
}

function noteAssets(note: Note): bigint {
  const a = (note as { assets?: string }).assets;
  return a != null ? BigInt(a) : 0n;
}

/** Fetch + decode spendable notes for `pkh`, sorted largest-first. Unknown /
 * unfunded addresses (rose-ts throws "Empty response from server") yield zero. */
export async function fetchBalance(pkh: Digest): Promise<BalanceResult> {
  const client = makeRpcClient();
  const firstName = firstNameForPkh(pkh);

  let balance;
  try {
    balance = await client.getBalanceByFirstName(firstName);
  } catch (e) {
    if (e instanceof Error && /empty response from server/i.test(e.message)) {
      return { notes: [], total: 0n, height: 0n };
    }
    throw e;
  }

  const notes: WalletNote[] = [];
  for (const entry of balance.notes ?? []) {
    if (!entry.note) continue;
    const note = noteFromProtobuf(entry.note as never);
    notes.push({ note, assets: noteAssets(note) });
  }
  notes.sort((a, b) => (a.assets > b.assets ? -1 : a.assets < b.assets ? 1 : 0));

  const total = notes.reduce((s, n) => s + n.assets, 0n);
  return { notes, total, blockId: balance.block_id, height: BigInt(balance.height || "") };
}
