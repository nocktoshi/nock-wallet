// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { getTxHistory, recordPending, setTxStatus, subscribeTxHistory } from "./history.js";

const PKH = "3zxKWhhd8HY9pT2ZCZNUSEz2XWwSk15P2sD3atnnnxRtHa2Ta1H4jRy";

beforeEach(() => localStorage.clear());

describe("tx history", () => {
  it("records pending sends newest-first", () => {
    recordPending(PKH, { txId: "a", to: "x", amount: "65536", fee: "100" });
    recordPending(PKH, { txId: "b", to: "y", amount: "131072", fee: "200" });
    const recs = getTxHistory(PKH);
    expect(recs.map((r) => r.txId)).toEqual(["b", "a"]);
    expect(recs[0].status).toBe("pending");
  });

  it("is idempotent on txId", () => {
    recordPending(PKH, { txId: "a", to: "x", amount: "1", fee: "1" });
    recordPending(PKH, { txId: "a", to: "x", amount: "1", fee: "1" });
    expect(getTxHistory(PKH)).toHaveLength(1);
  });

  it("flips status pending → confirmed and notifies subscribers", () => {
    let calls = 0;
    const unsub = subscribeTxHistory(() => calls++);
    recordPending(PKH, { txId: "a", to: "x", amount: "1", fee: "1" });
    setTxStatus(PKH, "a", "confirmed");
    expect(getTxHistory(PKH)[0].status).toBe("confirmed");
    expect(calls).toBeGreaterThanOrEqual(2);

    const before = calls;
    setTxStatus(PKH, "a", "confirmed"); // unchanged → no emit
    expect(calls).toBe(before);
    unsub();
  });

  it("keeps separate histories per account", () => {
    recordPending(PKH, { txId: "a", to: "x", amount: "1", fee: "1" });
    expect(getTxHistory("otherpkh000000000000000000000000000000000000")).toHaveLength(0);
  });
});
