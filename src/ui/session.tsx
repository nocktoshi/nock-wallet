import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { wallet, WalletStore } from "../wallet/wallet.js";
import { createWalletWithPasskey, unlockWithPasskey } from "../wallet/passkey.js";
import type { UnlockedAccount } from "../wallet/types.js";

export type WalletStatus = "loading" | "uninitialized" | "locked" | "unlocked";

interface SessionValue {
  status: WalletStatus;
  accounts: UnlockedAccount[];
  active: UnlockedAccount | null;
  wallet: WalletStore;
  createWallet: (mnemonic: string, opts?: { autoLockMinutes?: number }) => Promise<void>;
  unlock: () => Promise<void>;
  lock: () => void;
  reset: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>("loading");
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    if (wallet.isUnlocked()) setStatus("unlocked");
    else setStatus((await WalletStore.isInitialized()) ? "locked" : "uninitialized");
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = wallet.subscribe(() => void refresh());
    return unsub;
  }, [refresh]);

  // Reset the idle auto-lock timer on user activity while unlocked.
  useEffect(() => {
    if (status !== "unlocked") return;
    const onActivity = () => wallet.touch();
    const events = ["pointerdown", "keydown", "focus"] as const;
    for (const e of events) window.addEventListener(e, onActivity);
    return () => {
      for (const e of events) window.removeEventListener(e, onActivity);
    };
  }, [status]);

  const accounts = useMemo<UnlockedAccount[]>(
    () => (wallet.isUnlocked() ? wallet.getAccounts() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, tick]
  );
  const active = useMemo<UnlockedAccount | null>(
    () => (wallet.isUnlocked() ? wallet.getActiveAccount() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, tick]
  );

  const value = useMemo<SessionValue>(
    () => ({
      status,
      accounts,
      active,
      wallet,
      createWallet: (m, o) => createWalletWithPasskey(m, o),
      unlock: () => unlockWithPasskey(),
      lock: () => wallet.lock(),
      reset: () => wallet.reset(),
    }),
    [status, accounts, active]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}
