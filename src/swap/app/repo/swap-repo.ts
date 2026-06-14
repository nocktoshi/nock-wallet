import type { Address, Hex } from "viem";
import type { Digest } from "@nockchain/rose-ts";
import {
  encodeSwapParams,
  decodeSwapParams,
  type SwapPublic,
  type DraftSwap,
} from "../../swap.js";
import type { TokenKey } from "../../config.js";
import { getSwapApi, type SwapApi, type BidRecord } from "./swap-api.js";
import { getActiveWallet } from "../auth.js";
import { progressFields } from "../swap-fields.js";

const NOCK_IDX = "idx:nock:";

export interface BidPublic {
  id: string;
  creatorPkh: Digest;
  creatorEth: Address;
  token: TokenKey;
  quoteAmount: string;
  nockGift: bigint;
  createdAt?: number;
}

export type BidLookup = { bid: BidPublic; filledHEvm?: never } | { bid?: never; filledHEvm: string };

function decodeBid(rec: BidRecord): BidPublic {
  return {
    id: String(rec.id ?? ""),
    creatorPkh: String(rec.creatorPkh ?? "") as Digest,
    creatorEth: String(rec.creatorEth ?? "") as Address,
    token: "USDC",
    quoteAmount: String(rec.quoteAmount ?? ""),
    nockGift: BigInt(String(rec.nockGift ?? "0")),
    createdAt: rec.createdAt != null ? Number(rec.createdAt) : undefined,
  };
}

function encoded(swap: DraftSwap): Record<string, unknown> {
  return JSON.parse(encodeSwapParams(swap as SwapPublic)) as Record<string, unknown>;
}

function roleFor(swap: DraftSwap): "seller" | "buyer" {
  const pkh = getActiveWallet()?.pkh;
  if (pkh && swap.sellerPkh === pkh) return "seller";
  if (pkh && swap.buyerPkh === pkh) return "buyer";
  throw new Error("Connect the wallet that owns this swap to update it");
}

export class SwapRepository {
  constructor(private readonly api: SwapApi) {}

  async get(hEvm: string, opts?: { maxAgeMs?: number }): Promise<SwapPublic | null> {
    const rec = await this.api.get(hEvm, opts);
    return rec ? decodeSwapParams(JSON.stringify(rec)) : null;
  }

  async create(swap: DraftSwap): Promise<void> {
    await this.api.create(encoded(swap));
  }

  async claim(hEvm: string, buyerEth: string): Promise<SwapPublic> {
    const rec = await this.api.claim(hEvm, buyerEth);
    return decodeSwapParams(JSON.stringify(rec));
  }

  async put(swap: DraftSwap): Promise<void> {
    if (!swap.hEvm) throw new Error("swap has no id yet");
    const role = roleFor(swap);
    await this.api.advance(swap.hEvm, progressFields(encoded(swap), role));
  }

  cancel(hEvm: string): Promise<void> {
    return this.api.cancel(hEvm);
  }

  listForNockPkh(pkh: string): Promise<SwapPublic[]> {
    return this.listByPrefix(`${NOCK_IDX}${pkh}:`);
  }

  async createBid(bid: {
    token: TokenKey;
    quoteAmount: string;
    nockGift: bigint;
    creatorEth: string;
  }): Promise<BidPublic> {
    const rec = await this.api.createBid({
      token: bid.token,
      quoteAmount: bid.quoteAmount,
      nockGift: bid.nockGift.toString(),
      creatorEth: bid.creatorEth,
    });
    return decodeBid(rec);
  }

  async getBid(id: string): Promise<BidLookup | null> {
    const rec = await this.api.getBid(id);
    if (!rec) return null;
    if (rec.filledHEvm) return { filledHEvm: String(rec.filledHEvm) };
    const bid = decodeBid(rec);
    return bid.id ? { bid } : null;
  }

  private async listByPrefix(prefix: string): Promise<SwapPublic[]> {
    const keys = await this.api.listKeys(prefix);
    const BATCH = 5;
    const swaps: (SwapPublic | null)[] = [];
    for (let i = 0; i < keys.length; i += BATCH) {
      const results = await Promise.all(
        keys.slice(i, i + BATCH).map((k) => this.get(k.slice(prefix.length) as Hex))
      );
      swaps.push(...results);
    }
    return swaps.filter((s): s is SwapPublic => s !== null);
  }
}

let instance: SwapRepository | null = null;

export function getSwapRepository(): SwapRepository {
  if (!instance) instance = new SwapRepository(getSwapApi());
  return instance;
}

export function setSwapRepository(repo: SwapRepository): void {
  instance = repo;
}