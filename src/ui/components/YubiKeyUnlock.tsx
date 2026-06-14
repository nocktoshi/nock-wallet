import { useState } from "react";
import { useSession } from "../session.js";
import { isPasskeySupported } from "../../wallet/passkey.js";
import { ErrorText, Spinner } from "./primitives.js";

/**
 * Primary unlock action for a passwordless wallet: tap a passkey or YubiKey
 * (WebAuthn PRF). Shown on the lock screen and the dApp bridge popup.
 */
export function PasskeyUnlock() {
  const { unlock } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!isPasskeySupported()) {
    return (
      <ErrorText>
        This browser can't use passkeys here. Open Nock Wallet in Chrome or Edge (desktop/Android), or
        restore from your recovery phrase below.
      </ErrorText>
    );
  }

  async function tap() {
    setBusy(true);
    setError("");
    try {
      await unlock();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <button className="primary big" onClick={tap} disabled={busy}>
        {busy ? <Spinner label="Waiting for passkey…" /> : "🔑 Unlock with passkey"}
      </button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
