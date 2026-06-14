import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../session.js";
import type { UnlockMethod } from "../../wallet/types.js";
import { RPC_PRESETS, getRpcId, setRpcId } from "../../rpc/client.js";
import { isPasskeySupported, enrollPasskey, verifyPasskey } from "../../wallet/passkey.js";
import { CopyButton, ErrorText, Field, Screen, Spinner } from "../components/primitives.js";
import { shortMiddle } from "../format.js";

export function SettingsScreen() {
  const { wallet, lock, reset } = useSession();
  const navigate = useNavigate();
  const [rpcId, setRpc] = useState(getRpcId());
  const [autoLock, setAutoLock] = useState(wallet.getAutoLockMinutes());
  const [saved, setSaved] = useState("");

  function flash(msg: string) {
    setSaved(msg);
    setTimeout(() => setSaved(""), 2000);
  }

  function chooseRpc(id: string) {
    setRpc(id);
    setRpcId(id);
    flash("RPC endpoint updated.");
  }

  async function doReset() {
    if (confirm("Remove this wallet from the device? Restore needs your recovery phrase.")) {
      await reset();
      navigate("/");
    }
  }

  return (
    <Screen title="Settings" footer={<button onClick={() => navigate("/")}>← Back</button>}>
      <div className="stack">
        <Field label="Nockchain RPC endpoint">
          <select value={rpcId} onChange={(e) => chooseRpc(e.target.value)}>
            {RPC_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Auto-lock (minutes, 0 = never)">
          <input
            type="number"
            min={0}
            value={autoLock}
            onChange={(e) => {
              const m = Number(e.target.value);
              setAutoLock(m);
              void wallet.setAutoLockMinutes(m);
            }}
          />
        </Field>

        {saved && <p className="muted">{saved}</p>}

        <hr className="sep" />
        <AccountsSection />

        <hr className="sep" />
        <PasskeysSection />

        <hr className="sep" />
        <RevealPhraseSection />

        <hr className="sep" />
        <WatchAccountSection />

        <hr className="sep" />
        <div className="row gap">
          <button onClick={lock}>Lock wallet</button>
          <button className="danger-btn" onClick={doReset}>
            Forget wallet
          </button>
        </div>
      </div>
    </Screen>
  );
}

/** Manage accounts: rename, hide/unhide, switch active. */
function AccountsSection() {
  const { accounts, active, wallet } = useSession();
  const [err, setErr] = useState("");

  async function run(fn: () => Promise<void>) {
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="stack">
      <div className="field-label">Accounts</div>
      <ul className="method-list">
        {accounts.map((a) => (
          <li key={a.index} className="account-row">
            <div className="row gap">
              <input
                className="account-name"
                defaultValue={a.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== a.name) void run(() => wallet.renameAccount(a.index, v));
                }}
              />
              {a.watchOnly && <span className="watch-badge">👁</span>}
              {a.hidden && <span className="watch-badge">hidden</span>}
            </div>
            <div className="row gap account-row-meta">
              <span className="muted mono-wrap">{shortMiddle(a.pkh, 8, 6)}</span>
              <span className="row gap">
                {active?.index === a.index ? (
                  <span className="muted">active</span>
                ) : (
                  <button className="link-btn" onClick={() => void run(() => wallet.switchAccount(a.index))}>
                    use
                  </button>
                )}
                <button
                  className="link-btn"
                  onClick={() => void run(() => wallet.setAccountHidden(a.index, !a.hidden))}
                >
                  {a.hidden ? "unhide" : "hide"}
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>
      <ErrorText>{err}</ErrorText>
    </div>
  );
}

/** Manage passkeys / YubiKeys (the only unlock methods). */
function PasskeysSection() {
  const { wallet } = useSession();
  const supported = isPasskeySupported();
  const [methods, setMethods] = useState<UnlockMethod[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMethods(wallet.listUnlockMethods());
  }, [wallet]);

  async function add() {
    setBusy(true);
    setError("");
    try {
      await enrollPasskey();
      setMethods(wallet.listUnlockMethods());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError("");
    try {
      await wallet.removeUnlockMethod(id);
      setMethods(wallet.listUnlockMethods());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="stack">
      <div className="field-label">Passkeys & security keys</div>
      <p className="muted">Add a backup passkey or YubiKey so you can still unlock if one is lost.</p>
      <ul className="method-list">
        {methods.map((m) => (
          <li key={m.id}>
            <span>🔑 {m.label}</span>
            <button className="link-btn danger-btn" onClick={() => remove(m.id)}>
              remove
            </button>
          </li>
        ))}
      </ul>
      {supported ? (
        <button onClick={add} disabled={busy}>
          {busy ? <Spinner label="Follow your browser prompt…" /> : "🔑 Add passkey / YubiKey"}
        </button>
      ) : (
        <p className="muted">Adding a passkey needs WebAuthn PRF — use Chrome or Edge on desktop/Android.</p>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Reveal the recovery phrase after a passkey tap. */
function RevealPhraseSection() {
  const { wallet } = useSession();
  const [phrase, setPhrase] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function reveal() {
    setBusy(true);
    setErr("");
    try {
      if (await verifyPasskey()) setPhrase(wallet.getMnemonic());
      else setErr("Passkey check failed.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (phrase) {
    return (
      <div className="stack">
        <div className="field-label">Recovery phrase</div>
        <div className="address-box mono-wrap">{phrase}</div>
        <div className="row gap">
          <CopyButton text={phrase} label="Copy phrase" />
          <button onClick={() => setPhrase(null)}>Hide</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="field-label">Recovery phrase</div>
      <p className="muted">
        Your phrase is the only way to restore this wallet if you lose your passkeys. Tap a passkey
        to reveal it — never share it.
      </p>
      <button onClick={reveal} disabled={busy}>
        {busy ? <Spinner label="Waiting for passkey…" /> : "Reveal recovery phrase"}
      </button>
      <ErrorText>{err}</ErrorText>
    </div>
  );
}

/** Import a view-only account for an external address (e.g. a Ledger-held key). */
function WatchAccountSection() {
  const { wallet } = useSession();
  const navigate = useNavigate();
  const [addr, setAddr] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add() {
    setBusy(true);
    setError("");
    try {
      await wallet.addWatchAccount(addr, name);
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="field-label">Watch-only account (view balance; can't send)</div>
      <Field label="Address (base58 PKH)">
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="3zx…" />
      </Field>
      <Field label="Name (optional)">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ledger / cold storage" />
      </Field>
      <button onClick={add} disabled={busy || !addr.trim()}>
        {busy ? <Spinner label="Adding…" /> : "👁 Add watch-only account"}
      </button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
