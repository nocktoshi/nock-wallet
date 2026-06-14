import { describe, it, expect } from "vitest";
import { NICKS_PER_NOCK, formatNock, parseNockToNicks } from "./units.js";

describe("NOCK units", () => {
  it("formats whole and fractional amounts", () => {
    expect(formatNock(0n)).toBe("0");
    expect(formatNock(NICKS_PER_NOCK)).toBe("1");
    expect(formatNock(NICKS_PER_NOCK * 42n)).toBe("42");
    expect(formatNock(98304n)).toBe("1.5"); // 1.5 * 65536
    expect(formatNock(32768n)).toBe("0.5");
  });

  it("parses decimal NOCK to nicks", () => {
    expect(parseNockToNicks("1")).toBe(65536n);
    expect(parseNockToNicks("1.5")).toBe(98304n);
    expect(parseNockToNicks("0.5")).toBe(32768n);
    expect(parseNockToNicks("0")).toBe(0n);
  });

  it("round-trips amounts that are exact at 6 decimals", () => {
    // A nick is 1/65536 NOCK; only multiples of 1024 nicks (>=6 dp) are exact at
    // the display precision, so format→parse is lossless for these.
    for (const n of [0n, 1024n, 16384n, 32768n, 65536n, 98304n, NICKS_PER_NOCK * 1000n]) {
      expect(parseNockToNicks(formatNock(n))).toBe(n);
    }
  });

  it("truncates (never rounds up) sub-display-precision amounts", () => {
    // 1 nick formats to "0.000015" which parses back to 0 — display is lossy but
    // never invents value.
    expect(parseNockToNicks(formatNock(1n))).toBeLessThanOrEqual(1n);
  });

  it("rejects invalid amounts", () => {
    expect(() => parseNockToNicks("")).toThrow();
    expect(() => parseNockToNicks(".")).toThrow();
    expect(() => parseNockToNicks("1.2.3")).toThrow();
    expect(() => parseNockToNicks("abc")).toThrow();
  });
});
