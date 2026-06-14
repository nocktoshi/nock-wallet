import { useEffect } from "react";
import type { Digest } from "@nockchain/rose-ts";
import { useSession } from "../session.js";
import { setActiveWallet } from "../../swap/app/auth.js";
import { createLocalNockWallet } from "../../swap/nock/wallet.js";

/** Registers the unlocked Iris account with the swap API auth layer. */
export function useSwapWalletAuth(): void {
  const { active, wallet } = useSession();

  useEffect(() => {
    if (!active?.canSign) {
      setActiveWallet(null);
      return;
    }
    try {
      const ext = wallet.getExtendedKey(active.index);
      if (!ext.privateKey) {
        setActiveWallet(null);
        return;
      }
      const session = createLocalNockWallet(active.pkh as Digest, ext.privateKey);
      setActiveWallet(session, {
        privateKey: ext.privateKey,
        publicKey: ext.publicKey,
      });
    } catch {
      setActiveWallet(null);
    }
  }, [active, wallet]);
}