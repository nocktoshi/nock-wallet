import { describe, it, expect } from "vitest";
import { extractUsd, nicksToUsd, formatUsd } from "./price.js";
import { NICKS_PER_NOCK } from "../nock/units.js";

describe("price", () => {
  it("extracts USD from common JSON shapes", () => {
    expect(extractUsd({ nock: { usd: 1.23 } })).toBe(1.23); // CoinGecko simple/price
    expect(extractUsd({ usd: 2 })).toBe(2);
    expect(extractUsd({ price: 3.5 })).toBe(3.5);
    expect(extractUsd(4)).toBe(4);
    expect(extractUsd({ nope: true })).toBeNull();
    expect(extractUsd("x")).toBeNull();
  });

  it("converts nicks to USD at a given price", () => {
    expect(nicksToUsd(NICKS_PER_NOCK, 2)).toBe(2); // 1 NOCK * $2
    expect(nicksToUsd(NICKS_PER_NOCK * 3n, 0.5)).toBe(1.5);
    expect(nicksToUsd(0n, 100)).toBe(0);
  });

  it("formats USD", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });
});
