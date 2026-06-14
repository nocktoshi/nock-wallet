import { KV_URL } from "../../config.js";
import { ensureSession, getActiveWallet } from "../auth.js";
import { getKvStore, type KvStore } from "../storage/index.js";

const SWAP_PREFIX = "swap:";
const BID_PREFIX = "bid:";
const BID_FILLED_PREFIX = "bidswap:";
const ETH_IDX = "idx:eth:";
const NOCK_IDX = "idx:nock:";

export type SwapRecord = Record<string, unknown>;
export type BidRecord = Record<string, unknown>;

export interface SwapApi {
  create(swap: Record<string, unknown>): Promise<SwapRecord>;
  claim(hEvm: string, buyerEth: string): Promise<SwapRecord>;
  advance(hEvm: string, fields: Record<string, unknown>): Promise<SwapRecord>;
  get(hEvm: string, opts?: { maxAgeMs?: number }): Promise<SwapRecord | null>;
  listKeys(prefix: string): Promise<string[]>;
  cancel(hEvm: string): Promise<void>;
  createBid(bid: Record<string, unknown>): Promise<BidRecord>;
  getBid(id: string): Promise<BidRecord | null>;
}

const CACHE_TTL_MS = 45_000;

class HttpSwapApi implements SwapApi {
  constructor(private readonly baseUrl: string) {}

  private readonly _cache = new Map<string, { rec: SwapRecord; at: number }>();
  private readonly _inflight = new Map<string, Promise<SwapRecord | null>>();

  private async post(path: string, body: unknown): Promise<SwapRecord> {
    const token = await ensureSession(this.baseUrl);
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = "";
      try {
        msg = ((await res.json()) as { error?: string }).error ?? "";
      } catch {
        /* ignore */
      }
      throw new Error(msg || `request failed (${res.status})`);
    }
    const json = (await res.json()) as { swap?: SwapRecord };
    const rec = json.swap ?? {};
    if (rec.hEvm) {
      const key = String(rec.hEvm).toLowerCase();
      this._cache.set(key, { rec, at: Date.now() });
      this._inflight.delete(key);
    }
    return rec;
  }

  create(swap: Record<string, unknown>): Promise<SwapRecord> {
    return this.post("/swap", { swap });
  }

  claim(hEvm: string, buyerEth: string): Promise<SwapRecord> {
    return this.post(`/swap/${encodeURIComponent(hEvm)}/claim`, { buyerEth });
  }

  advance(hEvm: string, fields: Record<string, unknown>): Promise<SwapRecord> {
    return this.post(`/swap/${encodeURIComponent(hEvm)}/advance`, { fields });
  }

  async get(hEvm: string, opts?: { maxAgeMs?: number }): Promise<SwapRecord | null> {
    const key = hEvm.toLowerCase();
    const ttl = Math.min(opts?.maxAgeMs ?? CACHE_TTL_MS, CACHE_TTL_MS);
    const hit = this._cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.rec;

    let p = this._inflight.get(key);
    if (!p) {
      p = this._fetchSwap(key).finally(() => this._inflight.delete(key));
      this._inflight.set(key, p);
    }
    return p;
  }

  private async _fetchSwap(key: string): Promise<SwapRecord | null> {
    const res = await fetch(`${this.baseUrl}/swap/${encodeURIComponent(key)}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      let msg = "";
      try {
        msg = ((await res.json()) as { error?: string }).error ?? "";
      } catch {
        /* ignore */
      }
      throw new Error(msg || `swap read failed (${res.status})`);
    }
    const rec = (await res.json()) as SwapRecord;
    this._cache.set(key, { rec, at: Date.now() });
    return rec;
  }

  async cancel(hEvm: string): Promise<void> {
    await this.post(`/swap/${encodeURIComponent(hEvm)}/cancel`, {});
  }

  async listKeys(prefix: string): Promise<string[]> {
    const token = await ensureSession(this.baseUrl);
    const out: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const qs = new URLSearchParams({ prefix });
      if (cursor) qs.set("cursor", cursor);
      const res = await fetch(`${this.baseUrl}/list?${qs}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`list failed (${res.status})`);
      const json = (await res.json()) as {
        keys?: string[];
        cursor?: string;
        complete?: boolean;
      };
      out.push(...(json.keys ?? []));
      if (json.complete !== false || !json.cursor) break;
      cursor = json.cursor;
    }
    return out;
  }

  async createBid(bid: Record<string, unknown>): Promise<BidRecord> {
    const token = await ensureSession(this.baseUrl);
    const res = await fetch(`${this.baseUrl}/bid`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ bid }),
    });
    const json = (await res.json().catch(() => ({}))) as { bid?: BidRecord; error?: string };
    if (!res.ok) throw new Error(json.error || `bid create failed (${res.status})`);
    return json.bid ?? {};
  }

  async getBid(id: string): Promise<BidRecord | null> {
    const res = await fetch(`${this.baseUrl}/bid/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`bid read failed (${res.status})`);
    return (await res.json()) as BidRecord;
  }
}

export class MemorySwapApi implements SwapApi {
  constructor(private readonly kv: KvStore) {}

  private id(hEvm: string): string {
    return hEvm.toLowerCase();
  }

  private async load(hEvm: string): Promise<Record<string, unknown> | null> {
    const raw = await this.kv.get(SWAP_PREFIX + this.id(hEvm));
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  }

  get(hEvm: string): Promise<SwapRecord | null> {
    return this.load(hEvm);
  }

  private async write(rec: Record<string, unknown>): Promise<void> {
    const key = this.id(rec.hEvm as string);
    await this.kv.put(SWAP_PREFIX + key, JSON.stringify(rec));
    const idx: string[] = [];
    if (rec.sellerEth) idx.push(`${ETH_IDX}${String(rec.sellerEth).toLowerCase()}:${key}`);
    if (rec.buyerEth) idx.push(`${ETH_IDX}${String(rec.buyerEth).toLowerCase()}:${key}`);
    if (rec.sellerPkh) idx.push(`${NOCK_IDX}${rec.sellerPkh}:${key}`);
    if (rec.buyerPkh) idx.push(`${NOCK_IDX}${rec.buyerPkh}:${key}`);
    await Promise.all(idx.map((k) => this.kv.put(k, key)));
  }

  async create(swap: Record<string, unknown>): Promise<SwapRecord> {
    const rec = { ...swap, createdAt: Math.floor(Date.now() / 1000), version: 1 };
    await this.write(rec);
    return rec;
  }

  async claim(hEvm: string, buyerEth: string): Promise<SwapRecord> {
    const rec = await this.load(hEvm);
    if (!rec) throw new Error("swap not found");
    if (rec.buyerPkh || rec.buyerEth) throw new Error("swap already claimed");
    rec.buyerPkh = getActiveWallet()?.pkh ?? rec.buyerPkh;
    rec.buyerEth = buyerEth;
    rec.version = ((rec.version as number) ?? 1) + 1;
    await this.write(rec);
    return rec;
  }

  async advance(hEvm: string, fields: Record<string, unknown>): Promise<SwapRecord> {
    const rec = await this.load(hEvm);
    if (!rec) throw new Error("swap not found");
    Object.assign(rec, fields);
    rec.version = ((rec.version as number) ?? 1) + 1;
    await this.write(rec);
    return rec;
  }

  listKeys(prefix: string): Promise<string[]> {
    return this.kv.list(prefix);
  }

  async cancel(hEvm: string): Promise<void> {
    const rec = await this.load(hEvm);
    if (!rec) throw new Error("swap not found");
    if (rec.lockFirstName || rec.nockLockTxId || rec.usdcLockTxHash) {
      throw new Error("funds already locked — refund instead of cancelling");
    }
    await this.kv.delete(SWAP_PREFIX + this.id(hEvm));
  }

  async createBid(bid: Record<string, unknown>): Promise<BidRecord> {
    const id = crypto.randomUUID().replace(/-/g, "");
    const rec = {
      ...bid,
      id,
      creatorPkh: bid.creatorPkh ?? getActiveWallet()?.pkh ?? "dev-bidder",
      createdAt: Math.floor(Date.now() / 1000),
      version: 1,
    };
    await this.kv.put(BID_PREFIX + id, JSON.stringify(rec));
    return rec;
  }

  async getBid(id: string): Promise<BidRecord | null> {
    const raw = await this.kv.get(BID_PREFIX + id);
    if (raw) return JSON.parse(raw) as BidRecord;
    const hEvm = await this.kv.get(BID_FILLED_PREFIX + id);
    return hEvm ? { filledHEvm: hEvm } : null;
  }
}

let instance: SwapApi | null = null;

export function getSwapApi(): SwapApi {
  if (!instance) {
    instance = KV_URL ? new HttpSwapApi(KV_URL) : new MemorySwapApi(getKvStore());
  }
  return instance;
}

export function setSwapApi(api: SwapApi): void {
  instance = api;
}