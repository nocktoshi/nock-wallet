import { useEffect, useState } from "react";

/**
 * "Add to home screen" prompt. On Android/Chromium we capture the
 * `beforeinstallprompt` event and trigger the native install dialog on tap; on
 * iOS Safari (which has no such event) we show the manual Share → Add to Home
 * Screen hint. The banner hides itself once the app runs standalone, and a
 * dismissal is remembered so it doesn't nag.
 *
 * Installing matters here beyond convenience: a home-screen PWA is the context
 * in which the WalletConnect mobile deep-link flow (Phantom/MetaMask) is meant
 * to run.
 */
const DISMISS_KEY = "pwa-install-dismissed";

/** Minimal type — `BeforeInstallPromptEvent` isn't in the standard DOM lib. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari exposes navigator.standalone instead of display-mode.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as MacIntel with a touch screen, so check that too.
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "1"
  );

  useEffect(() => {
    if (dismissed || isStandalone()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // stop Chrome's default mini-infobar
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // Once installed, drop the banner for the rest of the session.
    const onInstalled = () => {
      setDeferred(null);
      setShowIosHint(false);
    };
    window.addEventListener("appinstalled", onInstalled);

    // iOS never fires beforeinstallprompt — show the manual hint instead.
    if (isIos()) setShowIosHint(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [dismissed]);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  }

  if (dismissed || isStandalone()) return null;
  if (!deferred && !showIosHint) return null;

  return (
    <div className="install-prompt" role="dialog" aria-label="Install Nock Wallet">
      <img
        src="/pwa-192x192.png"
        alt=""
        width={40}
        height={40}
        className="install-prompt-icon"
      />
      <div className="install-prompt-body">
        <strong>Install Nock Wallet</strong>
        {deferred ? (
          <span className="muted">Add it to your home screen for one-tap access.</span>
        ) : (
          <span className="muted">
            Tap the Share button, then <em>Add to Home Screen</em>.
          </span>
        )}
      </div>
      <div className="install-prompt-actions">
        {deferred && (
          <button type="button" className="primary" onClick={() => void install()}>
            Install
          </button>
        )}
        <button
          type="button"
          className="install-prompt-close"
          aria-label="Dismiss"
          onClick={dismiss}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
