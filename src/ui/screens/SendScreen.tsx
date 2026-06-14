import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../session.js";
import { useBalance } from "../hooks.js";
import { formatNock, parseNockToNicks } from "../../nock/units.js";
import { prepareSend, signAndBroadcast, waitTxAccepted, type PreparedSend } from "../../nock/send.js";
import { recordPending, setTxStatus } from "../../wallet/history.js";
import { shortMiddle } from "../format.js";
import {
  CopyButton,
  ErrorText,
  Field,
  Screen,
  Spinner,
} from "../components/primitives.js";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{40,}$/;

type Stage = "form" | "review" | "submitting" | "result";

export function SendScreen() {
  const { active, wallet } = useSession();
  const navigate = useNavigate();
  const bal = useBalance(active?.pkh, 0);

  const [stage, setStage] = useState<Stage>("form");
  const [recipient, setRecipient] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState<PreparedSend | null>(null);
  const [result, setResult] = useState<{ txId: string } | null>(null);

  if (!active) return null;

  if (!active.canSign) {
    return (
      <Screen
        title="Watch-only account"
        subtitle="This account was imported as view-only — it has no signing key, so it can't send."
        footer={<button onClick={() => navigate("/")}>← Back</button>}
      >
        <p className="muted">Switch to a wallet account (one you created or imported a phrase for) to send.</p>
      </Screen>
    );
  }

  function review() {
    setError("");
    const to = recipient.trim();
    if (!BASE58_RE.test(to)) return setError("Enter a valid Nockchain address (base58 PKH).");
    let amount: bigint;
    try {
      amount = parseNockToNicks(amountStr);
    } catch (e) {
      return setError(e instanceof Error ? e.message : "Invalid amount");
    }
    if (amount <= 0n) return setError("Amount must be greater than zero.");
    if (bal.loading) return setError("Still loading balance — try again in a moment.");
    try {
      const p = prepareSend({
        senderPkh: active!.pkh,
        recipientPkh: to,
        amount,
        notes: bal.notes,
        memo: memo.trim() || undefined,
      });
      setPrepared(p);
      setStage("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirm() {
    if (!prepared) return;
    setStage("submitting");
    setError("");
    try {
      const ext = wallet.getExtendedKey(active!.index);
      if (!ext.privateKey) throw new Error("This account can't sign (no private key).");
      const txId = await signAndBroadcast(prepared, ext.privateKey);
      const pkh = active!.pkh;
      recordPending(pkh, {
        txId,
        to: recipient.trim(),
        amount: prepared.amount.toString(),
        fee: prepared.fee.toString(),
        memo: memo.trim() || undefined,
      });
      setResult({ txId });
      setStage("result");
      // Confirm in the background; Home's history reflects pending → confirmed.
      void waitTxAccepted(txId).then((ok) => {
        if (ok) setTxStatus(pkh, txId, "confirmed");
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("review");
    }
  }

  if (stage === "result" && result) {
    return (
      <Screen
        title="Broadcast ✓"
        subtitle="Pending — it should confirm at the next block. Track it on the home screen."
        footer={<button className="primary" onClick={() => navigate("/")}>Done</button>}
      >
        <Field label="Transaction id">
          <div className="address-box mono-wrap">{result.txId}</div>
        </Field>
        <CopyButton text={result.txId} label="Copy tx id" />
      </Screen>
    );
  }

  if (stage === "review" || stage === "submitting") {
    const p = prepared!;
    const busy = stage === "submitting";
    return (
      <Screen title="Review" subtitle="Confirm the details before sending.">
        <dl className="review">
          <Row label="To">{shortMiddle(recipient.trim(), 12, 10)}</Row>
          <Row label="Amount">{formatNock(p.amount)} NOCK</Row>
          <Row label="Network fee">{formatNock(p.fee)} NOCK</Row>
          <Row label="Change">{formatNock(p.change)} NOCK</Row>
          <Row label="Total">{formatNock(p.amount + p.fee)} NOCK</Row>
          <Row label="Inputs">{p.inputs.length} note(s)</Row>
          {memo.trim() && <Row label="Memo">{memo.trim()}</Row>}
        </dl>
        <ErrorText>{error}</ErrorText>
        <div className="row gap">
          <button onClick={() => setStage("form")} disabled={busy}>
            Back
          </button>
          <button className="primary" onClick={confirm} disabled={busy}>
            {busy ? <Spinner label="Signing & sending…" /> : "Confirm & send"}
          </button>
        </div>
      </Screen>
    );
  }

  // stage === "form"
  return (
    <Screen
      title="Send NOCK"
      subtitle={`Available: ${bal.loading ? "…" : formatNock(bal.total)} NOCK`}
      footer={<button onClick={() => navigate("/")}>← Back</button>}
    >
      <div className="stack">
        <Field label="Recipient address">
          <input
            value={recipient}
            autoFocus
            placeholder="base58 PKH address"
            onChange={(e) => setRecipient(e.target.value)}
          />
        </Field>
        <Field label="Amount (NOCK)">
          <input
            value={amountStr}
            inputMode="decimal"
            placeholder="0.0"
            onChange={(e) => setAmountStr(e.target.value)}
          />
        </Field>
        <Field label="Memo (optional)">
          <input value={memo} placeholder="note to recipient" onChange={(e) => setMemo(e.target.value)} />
        </Field>
      </div>
      <ErrorText>{error}</ErrorText>
      <button className="primary" onClick={review} disabled={!recipient.trim() || !amountStr.trim()}>
        Review →
      </button>
    </Screen>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="muted">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
