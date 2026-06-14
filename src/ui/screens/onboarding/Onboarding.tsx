import { useMemo, useState } from "react";
import { useSession } from "../../session.js";
import {
  generateMnemonic,
  normalizeMnemonic,
  validateMnemonic,
} from "../../../crypto/mnemonic.js";
import { CopyButton, ErrorText, Field, Screen, Spinner } from "../../components/primitives.js";
import { isPasskeySupported } from "../../../wallet/passkey.js";

type Step = "start" | "create" | "verify" | "import" | "secure";

export function Onboarding() {
  const { createWallet } = useSession();
  const [step, setStep] = useState<Step>("start");
  const [mnemonic, setMnemonic] = useState("");
  const [importText, setImportText] = useState("");
  const [error, setError] = useState("");

  function startCreate() {
    setError("");
    setMnemonic(generateMnemonic());
    setStep("create");
  }

  function confirmImport() {
    const norm = normalizeMnemonic(importText);
    if (!validateMnemonic(norm)) {
      setError("That doesn't look like a valid recovery phrase.");
      return;
    }
    setError("");
    setMnemonic(norm);
    setStep("secure");
  }

  if (step === "start") {
    return (
      <Screen title="Nock Wallet" subtitle="A non-custodial Nockchain wallet.">
        <div className="stack">
          <button className="primary big" onClick={startCreate}>
            Create a new wallet
          </button>
          <button className="big" onClick={() => setStep("import")}>
            Import recovery phrase
          </button>
        </div>
      </Screen>
    );
  }

  if (step === "create") {
    return (
      <Screen
        title="Your recovery phrase"
        subtitle="Write these 24 words down in order and keep them offline. Anyone with this phrase controls your funds."
      >
        <WordGrid mnemonic={mnemonic} />
        <div className="row gap">
          <CopyButton text={mnemonic} label="Copy phrase" />
          <button className="primary" onClick={() => setStep("verify")}>
            I've saved it →
          </button>
        </div>
      </Screen>
    );
  }

  if (step === "verify") {
    return (
      <VerifyStep
        mnemonic={mnemonic}
        onBack={() => setStep("create")}
        onVerified={() => setStep("secure")}
      />
    );
  }

  if (step === "import") {
    return (
      <Screen title="Import wallet" subtitle="Enter your 12 or 24-word recovery phrase.">
        <textarea
          className="phrase-input"
          rows={4}
          autoFocus
          placeholder="word1 word2 word3 …"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        <ErrorText>{error}</ErrorText>
        <div className="row gap">
          <button onClick={() => setStep("start")}>Back</button>
          <button className="primary" onClick={confirmImport} disabled={!importText.trim()}>
            Continue →
          </button>
        </div>
      </Screen>
    );
  }

  // step === "secure"
  return (
    <PasskeyStep
      onBack={() => setStep(importText ? "import" : "create")}
      onCreate={() => createWallet(mnemonic)}
    />
  );
}

function WordGrid({ mnemonic }: { mnemonic: string }) {
  const words = mnemonic.split(" ");
  return (
    <ol className="word-grid">
      {words.map((w, i) => (
        <li key={i}>
          <span className="word-num">{i + 1}</span>
          <span className="word">{w}</span>
        </li>
      ))}
    </ol>
  );
}

function VerifyStep({
  mnemonic,
  onBack,
  onVerified,
}: {
  mnemonic: string;
  onBack: () => void;
  onVerified: () => void;
}) {
  const words = useMemo(() => mnemonic.split(" "), [mnemonic]);
  // Ask the user to confirm three random positions.
  const targets = useMemo(() => {
    const idxs = new Set<number>();
    while (idxs.size < 3) idxs.add(Math.floor(Math.random() * words.length));
    return [...idxs].sort((a, b) => a - b);
  }, [words.length]);

  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState("");

  function check() {
    const ok = targets.every(
      (i) => (answers[i] ?? "").trim().toLowerCase() === words[i]
    );
    if (ok) onVerified();
    else setError("Those words don't match. Check your backup and try again.");
  }

  return (
    <Screen title="Confirm your backup" subtitle="Enter the requested words from your phrase.">
      <div className="stack">
        {targets.map((i) => (
          <Field key={i} label={`Word #${i + 1}`}>
            <input
              value={answers[i] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="row gap">
        <button onClick={onBack}>Back</button>
        <button className="primary" onClick={check}>
          Confirm →
        </button>
      </div>
    </Screen>
  );
}

function PasskeyStep({ onBack, onCreate }: { onBack: () => void; onCreate: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const supported = isPasskeySupported();

  async function go() {
    setError("");
    setBusy(true);
    try {
      await onCreate(); // on success the session flips to unlocked
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Secure your wallet"
      subtitle="Nock Wallet is passwordless — protect it with a passkey or YubiKey."
    >
      <p className="muted">
        You'll be prompted to create a passkey (Touch ID, Windows Hello, or a FIDO2 security key).
        Your recovery phrase stays your backup if you ever lose it.
      </p>
      {!supported && (
        <ErrorText>
          This browser doesn't support passkeys with the PRF extension. Use Chrome or Edge on
          desktop/Android, or a device with a platform authenticator.
        </ErrorText>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="row gap">
        <button onClick={onBack} disabled={busy}>
          Back
        </button>
        <button className="primary" onClick={go} disabled={busy || !supported}>
          {busy ? <Spinner label="Creating passkey…" /> : "Create passkey & finish"}
        </button>
      </div>
    </Screen>
  );
}
