import { useSyncExternalStore, useState } from "react";
import {
  getWalletsSnapshot,
  subscribeWallets,
} from "../../swap/evm/providers.js";
import {
  WALLETCONNECT_RDNS,
  isWalletConnectConfigured,
} from "../../swap/evm/walletconnect.js";
import { useSwapSession } from "./session.js";
import { shortMiddle } from "../format.js";

export function EvmWalletConnect() {
  const { evm, evmConnecting, connectEvm, disconnectEvm } = useSwapSession();
  const discovered = useSyncExternalStore(subscribeWallets, getWalletsSnapshot, () => []);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  // EIP-6963 injected wallets (exclude WalletConnect, which we list explicitly
  // below even before it registers itself on connect).
  const injected = discovered.filter((w) => w.info.rdns !== WALLETCONNECT_RDNS);
  const wcEnabled = isWalletConnectConfigured();

  async function pick(rdns: string) {
    setError("");
    setOpen(false);
    try {
      await connectEvm(rdns);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (evm) {
    return (
      <div className="evm-wallet-bar connected">
        <div className="evm-wallet-info">
          <span className="evm-wallet-label">Base</span>
          <span className="evm-wallet-addr mono-wrap">{shortMiddle(evm, 8, 6)}</span>
        </div>
        <button type="button" className="evm-wallet-btn" onClick={disconnectEvm}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="evm-wallet-bar">
      <button
        type="button"
        className="primary evm-wallet-btn"
        disabled={evmConnecting}
        onClick={() => setOpen((o) => !o)}
      >
        {evmConnecting ? "Connecting…" : "Connect Ethereum"}
      </button>
      {open && (
        <div className="evm-wallet-picker panel">
          {injected.map((w) => (
            <button
              key={w.info.uuid}
              type="button"
              className="evm-wallet-option"
              onClick={() => void pick(w.info.rdns)}
            >
              {w.info.icon && (
                <img src={w.info.icon} alt="" width={20} height={20} className="evm-wallet-icon" />
              )}
              {w.info.name}
            </button>
          ))}
          {wcEnabled && (
            <button
              type="button"
              className="evm-wallet-option"
              onClick={() => void pick(WALLETCONNECT_RDNS)}
            >
              <span className="evm-wallet-wc-badge" aria-hidden="true">WC</span>
              WalletConnect — Phantom, MetaMask & more
            </button>
          )}
          {injected.length === 0 && !wcEnabled && (
            <p className="muted">No wallet detected. Install MetaMask or another Base wallet.</p>
          )}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}