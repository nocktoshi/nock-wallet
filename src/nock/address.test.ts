import { describe, it, expect } from "vitest";
import { deriveAccount, firstNameForPkh } from "./address.js";
import {
  generateMnemonic,
  validateMnemonic,
  normalizeMnemonic,
} from "../crypto/mnemonic.js";

// A fixed, BIP-39-valid mnemonic for deterministic derivation assertions.
const FIXED =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

describe("mnemonic", () => {
  it("generates a valid 24-word mnemonic", () => {
    const m = generateMnemonic();
    expect(m.split(" ")).toHaveLength(24);
    expect(validateMnemonic(m)).toBe(true);
  });

  it("validates the fixed mnemonic and rejects garbage", () => {
    expect(validateMnemonic(FIXED)).toBe(true);
    expect(validateMnemonic("not a real mnemonic at all")).toBe(false);
  });

  it("normalizes whitespace + case", () => {
    expect(normalizeMnemonic("  ABANDON   about ")).toBe("abandon about");
  });
});

describe("address derivation (rose-ts wiring)", () => {
  it("derives a stable base58 PKH for account 0", () => {
    const a = deriveAccount(FIXED, 0);
    const b = deriveAccount(FIXED, 0);
    expect(a.pkh).toBe(b.pkh);
    expect(a.pkh).toMatch(BASE58_RE);
    expect(a.pkh.length).toBeGreaterThanOrEqual(40);
  });

  it("derives distinct PKHs per account index", () => {
    const a0 = deriveAccount(FIXED, 0);
    const a1 = deriveAccount(FIXED, 1);
    expect(a0.pkh).not.toBe(a1.pkh);
  });

  it("produces a base58 first name for a PKH", () => {
    const { pkh } = deriveAccount(FIXED, 0);
    const firstName = firstNameForPkh(pkh);
    expect(firstName).toMatch(BASE58_RE);
  });
});
