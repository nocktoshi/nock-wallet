import { describe, it, expect } from "vitest";
import {
  createVaultWithPrf,
  unlockWithPrf,
  reencryptPayload,
  addPrfWrap,
  removeKeyringEntry,
  prfCredentialIds,
  DecryptError,
  type PrfMaterial,
} from "./vault.js";
import { randomBytes } from "./webcrypto.js";

const te = new TextEncoder();
const td = new TextDecoder();
const payload = (s: string) => te.encode(s);
const str = (b: Uint8Array) => td.decode(b);
const prf = (label = "A"): PrfMaterial => ({
  credentialId: randomBytes(16),
  prfOutput: randomBytes(32),
  label,
});

describe("passwordless envelope vault (passkey/PRF)", () => {
  it("round-trips via createVaultWithPrf + unlockWithPrf", async () => {
    const k = prf();
    const { vault } = await createVaultWithPrf(payload("the mnemonic"), k);
    const { payload: out } = await unlockWithPrf(k.credentialId, k.prfOutput, vault);
    expect(str(out)).toBe("the mnemonic");
  });

  it("rejects an unknown credential or wrong PRF output", async () => {
    const k = prf();
    const { vault } = await createVaultWithPrf(payload("m"), k);
    await expect(unlockWithPrf(randomBytes(16), randomBytes(32), vault)).rejects.toBeInstanceOf(
      DecryptError
    );
    await expect(unlockWithPrf(k.credentialId, randomBytes(32), vault)).rejects.toBeInstanceOf(
      DecryptError
    );
  });

  it("re-encrypts the payload under the same DEK (no touch)", async () => {
    const k = prf();
    const { vault, dek } = await createVaultWithPrf(payload("v1"), k);
    const v2 = await reencryptPayload(dek, vault, payload("v2 edited"));
    expect(str((await unlockWithPrf(k.credentialId, k.prfOutput, v2)).payload)).toBe("v2 edited");
  });

  it("enrolls backup keys, unlocks with any, and refuses removing the last", async () => {
    const a = prf("A");
    const b = prf("B");
    const { vault, dek } = await createVaultWithPrf(payload("m"), a);
    const v2 = await addPrfWrap(dek, vault, b);
    expect(prfCredentialIds(v2)).toHaveLength(2);

    expect(str((await unlockWithPrf(a.credentialId, a.prfOutput, v2)).payload)).toBe("m");
    expect(str((await unlockWithPrf(b.credentialId, b.prfOutput, v2)).payload)).toBe("m");

    const entryA = v2.keyring.find((e) => e.label === "A")!;
    const v3 = removeKeyringEntry(v2, entryA.id);
    expect(v3.keyring).toHaveLength(1);
    expect(() => removeKeyringEntry(v3, v3.keyring[0].id)).toThrow();
  });
});
