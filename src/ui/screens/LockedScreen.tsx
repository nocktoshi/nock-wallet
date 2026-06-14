import { useSession } from "../session.js";
import { Screen } from "../components/primitives.js";
import { PasskeyUnlock } from "../components/YubiKeyUnlock.js";

export function LockedScreen() {
  const { reset } = useSession();

  async function forget() {
    if (
      confirm(
        "Remove this wallet from the device? You'll need your recovery phrase to restore it."
      )
    ) {
      await reset();
    }
  }

  return (
    <Screen title="Welcome back" subtitle="Unlock with your passkey or YubiKey.">
      <PasskeyUnlock />
      <button className="link-btn" onClick={forget}>
        Forget wallet / restore from phrase
      </button>
    </Screen>
  );
}
