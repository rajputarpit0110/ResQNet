import { useState, useEffect } from "react";

export default function InstallAppBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIosModal, setShowIosModal] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // Check if app is already running in standalone PWA mode
    const checkStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;

    if (checkStandalone) {
      setIsStandalone(true);
      return;
    }

    const handleBeforeInstall = (e) => {
      // Prevent browser default mini-infobar on mobile
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  if (isStandalone || isDismissed) {
    return null;
  }

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setIsStandalone(true);
      }
      setDeferredPrompt(null);
      return;
    }

    // Check if on iOS Safari
    const isIos =
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    if (isIos) {
      setShowIosModal(true);
    } else {
      // For desktop Chrome / Edge or Android without event yet:
      alert(
        "To install ResQNet on your phone or computer:\n\n1. Tap your browser's menu (⋮ or ⎋)\n2. Select 'Install ResQNet' or 'Add to Home Screen'"
      );
    }
  };

  return (
    <>
      <div className="install-pwa-card">
        <div className="install-pwa-content">
          <div className="install-pwa-icon" aria-hidden="true">
            📲
          </div>
          <div className="install-pwa-text">
            <strong>Install ResQNet App</strong>
            <p>Save to home screen for 100% offline emergency access without internet.</p>
          </div>
        </div>

        <div className="install-pwa-actions">
          <button
            className="install-pwa-btn"
            onClick={handleInstallClick}
            type="button"
          >
            Install App ⬇
          </button>
          <button
            className="install-pwa-dismiss"
            onClick={() => setIsDismissed(true)}
            type="button"
            aria-label="Dismiss install banner"
          >
            ✕
          </button>
        </div>
      </div>

      {/* iOS Safari step-by-step install instruction modal */}
      {showIosModal && (
        <div className="ios-modal-backdrop" onClick={() => setShowIosModal(false)}>
          <div className="ios-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ios-modal-header">
              <h3>Install on iPhone / iPad</h3>
              <button
                className="ios-modal-close"
                onClick={() => setShowIosModal(false)}
              >
                ✕
              </button>
            </div>
            <p className="ios-modal-desc">
              Apple Safari does not allow automatic 1-click install, but you can add it in 2 simple steps:
            </p>
            <ol className="ios-install-steps">
              <li>
                Tap the <strong>Share button</strong> (
                <svg
                  style={{ display: "inline", verticalAlign: "middle" }}
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
                ) in Safari's bottom toolbar.
              </li>
              <li>
                Scroll down and tap <strong>"Add to Home Screen"</strong> (➕).
              </li>
              <li>
                Tap <strong>Add</strong> in the top-right corner.
              </li>
            </ol>
            <button
              className="primary-button"
              onClick={() => setShowIosModal(false)}
              style={{ width: "100%", marginTop: "12px" }}
            >
              Got it!
            </button>
          </div>
        </div>
      )}
    </>
  );
}
