import { useEffect, useMemo, useState } from "react";
import type { NockchainTx } from "@nockchain/rose-ts";
import { useSession } from "../../session.js";
import {
  BridgeHost,
  attachBridgeHost,
  executeBridgeMethod,
  describeRequest,
  type PendingRequest,
} from "../../../bridge/host.js";
import { summarizeTx } from "../../../bridge/tx-summary.js";
import { formatNock } from "../../../nock/units.js";
import { shortMiddle } from "../../format.js";
import { ErrorText, Screen, Spinner } from "../../components/primitives.js";
import { PasskeyUnlock } from "../../components/YubiKeyUnlock.js";

/**
 * The wallet running in "bridge mode" (opened as a popup by a dApp via the
 * connector SDK). Attaches a BridgeHost to this window, then renders an unlock
 * prompt or the approval UI for incoming requests.
 */
export function BridgePopup() {
  const { status, wallet } = useSession();
  // Stable across renders; conceptually session state, not a ref.
  const [host] = useState(() => new BridgeHost());
  const [, force] = useState(0);

  useEffect(() => {
    const detach = attachBridgeHost(host);
    const unsub = host.subscribe(() => force((n) => n + 1));
    const onUnload = () => host.rejectAll("Wallet popup closed");
    window.addEventListener("beforeunload", onUnload);
    return () => {
      detach();
      unsub();
      window.removeEventListener("beforeunload", onUnload);
      host.rejectAll("Wallet popup closed");
    };
  }, [host]);

  if (status === "loading") {
    return (
      <Screen>
        <Spinner label="Loading…" />
      </Screen>
    );
  }

  if (status === "uninitialized") {
    return (
      <Screen title="No wallet here" subtitle="Set up Nock Wallet before connecting a site.">
        <a href="/" target="_blank" rel="noreferrer">
          Open Nock Wallet →
        </a>
      </Screen>
    );
  }

  if (status === "locked") {
    return <BridgeUnlock />;
  }

  const req = host.current();
  if (!req) {
    return (
      <Screen title="Connected" subtitle="Waiting for requests from the site…">
        <p className="muted">You can leave this window open while you use the site.</p>
      </Screen>
    );
  }

  return <Approval key={req.id} req={req} host={host} wallet={wallet} />;
}

function BridgeUnlock() {
  return (
    <Screen title="Unlock to continue" subtitle="A site is requesting your wallet.">
      <PasskeyUnlock />
    </Screen>
  );
}

function Approval({
  req,
  host,
  wallet,
}: {
  req: PendingRequest;
  host: BridgeHost;
  wallet: ReturnType<typeof useSession>["wallet"];
}) {
  const { title, detail } = describeRequest(req);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function approve() {
    setBusy(true);
    setError("");
    try {
      const result = await executeBridgeMethod(req.method, req.params, wallet);
      host.approve(req.id, result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  function reject() {
    host.reject(req.id, "User rejected the request");
  }

  return (
    <Screen title={title} subtitle={<OriginBadge origin={req.origin} />}>
      {req.method === "nock_signTx" ? (
        <TxSummaryView tx={(req.params as { tx?: NockchainTx } | null)?.tx} />
      ) : (
        <div className="approval-detail mono-wrap">{detail || "—"}</div>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="row gap">
        <button onClick={reject} disabled={busy}>
          Reject
        </button>
        <button className="primary" onClick={approve} disabled={busy}>
          {busy ? <Spinner label="Working…" /> : "Approve"}
        </button>
      </div>
    </Screen>
  );
}

/** "What you're signing": decoded outputs, total, and fee — not a blind sign. */
function TxSummaryView({ tx }: { tx?: NockchainTx }) {
  const s = useMemo(() => (tx ? summarizeTx(tx) : null), [tx]);
  if (!s) return <p className="error-text">No transaction supplied.</p>;
  return (
    <div className="approval-tx panel">
      {s.decoded ? (
        <>
          <div className="approval-tx-row">
            <span className="muted">Total leaving</span>
            <strong>{formatNock(s.totalOutNicks ?? 0n, 6)} ℕOCK</strong>
          </div>
          {s.outputs.map((o, i) => (
            <div className="approval-tx-row" key={i}>
              <span className="muted">Output #{i + 1}</span>
              <span>{formatNock(o.amountNicks, 6)} ℕOCK</span>
            </div>
          ))}
        </>
      ) : (
        <p className="error-text">
          Could not decode this transaction. Approve only if you trust this site.
        </p>
      )}
      {s.feeNicks != null && (
        <div className="approval-tx-row">
          <span className="muted">Network fee</span>
          <span>{formatNock(s.feeNicks, 6)} ℕOCK</span>
        </div>
      )}
      {s.txId && (
        <div className="approval-tx-row">
          <span className="muted">Tx id</span>
          <span className="mono-wrap">{shortMiddle(s.txId, 10, 8)}</span>
        </div>
      )}
      <p className="muted approval-tx-note">
        Recipient addresses aren't decoded in-wallet — verify the requesting site.
      </p>
    </div>
  );
}

function OriginBadge({ origin }: { origin: string }) {
  return (
    <span>
      Requested by <strong>{shortMiddle(origin, 28, 0)}</strong>
    </span>
  );
}
