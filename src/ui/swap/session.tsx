import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Address } from "viem";
import type { Digest } from "@nockchain/rose-ts";
import { useSession } from "../session.js";
import { claimNockAction as claimNockActionCore } from "../../swap/actions/buyer.js";
import {
  lockNockAction as lockNockActionCore,
} from "../../swap/actions/seller.js";
import { claimNock as claimNockCore } from "../../swap/nock/claim.js";
import {
  lockNock as lockNockCore,
  consolidateNotes as consolidateNotesCore,
  type ConsolidateResult,
} from "../../swap/nock/lock.js";
import { fetchCurrentBlockHeight as fetchCurrentBlockHeightCore } from "../../swap/nock/balance.js";
import { assertPreimageMatchesHNock } from "../../swap/swap.js";
import { isPlausibleWalletAddress } from "../../swap/nock/balance.js";
import {
  createLocalNockWallet,
  type NockWalletSession,
} from "../../swap/nock/wallet.js";
import { clearSession } from "../../swap/app/auth.js";
import { useSwapWalletAuth } from "./wallet-auth.js";
import {
  connectEvmWallet,
  getEvmAddress,
  silentReconnect,
  disconnectEvmWallet,
} from "../../swap/evm/wallet.js";

export interface SwapSessionValue {
  nock: NockWalletSession | null;
  evm: Address | null;
  evmConnecting: boolean;
  connectEvm(rdns?: string): Promise<Address>;
  disconnectEvm(): void;
  claimNockAction: typeof claimNockActionCore;
  lockNockAction: typeof lockNockActionCore;
  consolidateNotes: (walletAddress: string) => Promise<ConsolidateResult>;
  fetchCurrentBlockHeight: () => Promise<bigint | undefined>;
}

const SwapSessionContext = createContext<SwapSessionValue | null>(null);

export function SwapSessionProvider({ children }: { children: ReactNode }) {
  const { active, wallet } = useSession();
  const [nock, setNock] = useState<NockWalletSession | null>(null);
  const [evm, setEvm] = useState<Address | null>(null);
  const [evmConnecting, setEvmConnecting] = useState(false);

  useSwapWalletAuth();

  useEffect(() => {
    if (!active?.canSign) {
      setNock(null);
      return;
    }
    try {
      const ext = wallet.getExtendedKey(active.index);
      if (!ext.privateKey) {
        setNock(null);
        return;
      }
      setNock(createLocalNockWallet(active.pkh as Digest, ext.privateKey));
    } catch {
      setNock(null);
    }
  }, [active, wallet]);

  useEffect(() => {
    void silentReconnect().then((addr) => {
      if (addr) setEvm(addr);
    });
  }, []);

  const connectEvm = useCallback(async (rdns?: string) => {
    setEvmConnecting(true);
    try {
      const addr = await connectEvmWallet(rdns);
      setEvm(addr);
      return addr;
    } finally {
      setEvmConnecting(false);
    }
  }, []);

  const disconnectEvm = useCallback(() => {
    void disconnectEvmWallet();
    setEvm(null);
  }, []);

  const requireNock = useCallback((): NockWalletSession => {
    if (!nock) throw new Error("Unlock a signing account to swap.");
    return nock;
  }, [nock]);

  const claimNockAction = useCallback<typeof claimNockActionCore>(
    (input) =>
      claimNockActionCore(input, {
        claimNock: (params) => claimNockCore(requireNock(), params),
        assertPreimageMatchesHNock,
      }),
    [requireNock]
  );

  const lockNockAction = useCallback<typeof lockNockActionCore>(
    (input) =>
      lockNockActionCore(input, {
        isPlausibleWalletAddress,
        lockNock: (params) => lockNockCore(requireNock(), params),
      }),
    [requireNock]
  );

  const consolidateNotes = useCallback(
    (walletAddress: string) =>
      consolidateNotesCore(requireNock(), { walletAddress: walletAddress as Digest }),
    [requireNock]
  );

  const fetchCurrentBlockHeight = useCallback(async () => {
    if (!nock) return undefined;
    return fetchCurrentBlockHeightCore(nock);
  }, [nock]);

  useEffect(() => {
    return () => {
      if (active?.pkh) clearSession(active.pkh);
    };
  }, [active?.pkh]);

  const value = useMemo<SwapSessionValue>(
    () => ({
      nock,
      evm,
      evmConnecting,
      connectEvm,
      disconnectEvm,
      claimNockAction,
      lockNockAction,
      consolidateNotes,
      fetchCurrentBlockHeight,
    }),
    [
      nock,
      evm,
      evmConnecting,
      connectEvm,
      disconnectEvm,
      claimNockAction,
      lockNockAction,
      consolidateNotes,
      fetchCurrentBlockHeight,
    ]
  );

  return <SwapSessionContext.Provider value={value}>{children}</SwapSessionContext.Provider>;
}

export function useSwapSession(): SwapSessionValue {
  const ctx = useContext(SwapSessionContext);
  if (!ctx) throw new Error("useSwapSession must be used within SwapSessionProvider");
  return ctx;
}

export function useEvmAddress(): Address | null {
  return getEvmAddress();
}