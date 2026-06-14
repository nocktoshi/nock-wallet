/** NOCK denomination. 1 NOCK = 65536 nicks (2^16) — the on-chain `assets` unit.
 * Confirmed against the live Atomic Nock swap app (NICKS_PER_NOCK = 65536). */
export const NICKS_PER_NOCK = 65536n;

/** Format nicks as a decimal NOCK string, trimming trailing zeros. */
export function formatNock(nicks: bigint, maxDecimals = 6): string {
  const neg = nicks < 0n;
  const abs = neg ? -nicks : nicks;
  const whole = abs / NICKS_PER_NOCK;
  const frac = abs % NICKS_PER_NOCK;
  let out = whole.toString();
  if (frac > 0n && maxDecimals > 0) {
    const scaled = (frac * 10n ** BigInt(maxDecimals)) / NICKS_PER_NOCK;
    const decimals = scaled.toString().padStart(maxDecimals, "0").replace(/0+$/, "");
    if (decimals) out += "." + decimals;
  }
  return (neg ? "-" : "") + out;
}

/** Parse a decimal NOCK string into nicks (floors sub-nick precision). */
export function parseNockToNicks(input: string): bigint {
  const t = input.trim();
  if (t === "" || t === "." || !/^\d*(\.\d*)?$/.test(t)) {
    throw new Error("Enter a valid NOCK amount");
  }
  const [w, f = ""] = t.split(".");
  let nicks = BigInt(w || "0") * NICKS_PER_NOCK;
  if (f.length > 0) {
    nicks += (BigInt(f) * NICKS_PER_NOCK) / 10n ** BigInt(f.length);
  }
  return nicks;
}
