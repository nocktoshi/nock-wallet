import { useNavigate } from "react-router-dom";
import { useSession } from "../session.js";
import { useBalance, useNockUsd, useTxHistory } from "../hooks.js";
import { formatNock } from "../../nock/units.js";
import { nicksToUsd, formatUsd } from "../../market/price.js";
import { shortMiddle, useCopy } from "../format.js";
import type { TxRecord, TxStatus } from "../../wallet/history.js";
import { useSwapsInProgress } from "../swap/useSwapsInProgress.js";
import { SwapProgressList } from "../swap/SwapProgressList.js";
import logo from "../../../public/app-icon.png"

export function HomeScreen() {
  const { active, accounts, wallet, lock } = useSession();
  const navigate = useNavigate();
  const bal = useBalance(active?.pkh);
  const nockUsd = useNockUsd();
  const history = useTxHistory(active?.pkh);
  const swaps = useSwapsInProgress(active?.canSign ? active.pkh : undefined);
  const [copied, copy] = useCopy();

  if (!active) return null;

  return (
    <div className="screen home">
      <div className="home-top">
        <img className="logo" src={logo}></img>
        <h3>ℕock 𝕎allet</h3>
        <button className="icon-btn" title="Settings" onClick={() => navigate("/settings")}>
            ⚙
          </button>
          <button className="icon-btn" title="Lock" onClick={lock}>
            🔒
          </button>
      </div>
      <header className="home-top">
        <select
          className="account-select"
          value={active.index}
          onChange={(e) => void wallet.switchAccount(Number(e.target.value))}
        >
          {accounts
            .filter((a) => !a.hidden)
            .map((a) => (
              <option key={a.index} value={a.index}>
                {a.name}
              </option>
            ))}
        </select>
        <div className="home-actions">
          <button className="icon-btn" title="Add account" onClick={() => void wallet.addAccount()}>
            +
          </button>
          
        </div>
      </header>

      <div className="balance-card">
        <div className="muted">Balance</div>
        <div className="balance-amount">
          {bal.loading && bal.total === 0n ? "…" : formatNock(bal.total, 2)}{" "}
          <span className="balance-unit">	ℕOCK</span>
        </div>
        {nockUsd != null && (
          <div className="muted balance-usd">≈ {formatUsd(nicksToUsd(bal.total, nockUsd))}</div>
        )}
        <button className="addr-chip" onClick={() => copy(active.pkh)} title="Copy address">
          {copied ? "Copied ✓" : shortMiddle(active.pkh, 10, 8)}
        </button>
        {active.watchOnly && <div className="watch-badge">👁 Watch-only</div>}
        {bal.error && <div className="error-text">{bal.error}</div>}
      </div>

      <div className="row gap">
        <button
          className="big grow"
          disabled={!active.canSign}
          title={active.canSign ? undefined : "Watch-only account can't send"}
          onClick={() => navigate("/send")}
        >
          Send
        </button>
        <button className="big grow" onClick={() => navigate("/receive")}>
          Receive
        </button>
      </div>

      <button className="primary big swap-home-btn" onClick={() => navigate("/swap")}>
        Buy 	ℕOCK
      </button>

      <div className="home-meta muted">
        {bal.notes.length} note{bal.notes.length === 1 ? "" : "s"}
        {bal.blockId ? ` · block ${bal.blockId}` : ""}
        <button className="link-btn" onClick={bal.refresh}>
          refresh
        </button>
      </div>

      <TxHistory records={history} />

      {active.canSign && <SwapProgressList pkh={active.pkh} state={swaps} />}
    </div>
  );
}

function TxHistory({ records }: { records: TxRecord[] }) {
  if (records.length === 0) return null;
  return (
    <div className="tx-list">
      <div className="field-label">Activity</div>
      {records.map((t) => (
        <div key={t.txId} className="tx-row">
          <div className="tx-row-main">
            <span className="tx-dir">Sent</span>
            <span className="tx-amt">−{formatNock(BigInt(t.amount))} NOCK</span>
          </div>
          <div className="tx-row-meta muted">
            <span>
              to {shortMiddle(t.to, 6, 6)} · {relTime(t.at)}
            </span>
            <span className={`tx-status tx-${t.status}`}>{statusLabel(t.status)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function statusLabel(s: TxStatus): string {
  return s === "pending" ? "⏳ pending" : s === "confirmed" ? "✓ confirmed" : "✕ failed";
}

function relTime(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
