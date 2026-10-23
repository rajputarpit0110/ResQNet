import { useState, useRef, useEffect } from "react";
import InstallAppBanner from "../components/InstallAppBanner";

export default function HomeScreen({
  onManualReport,
  onTriggerSOS,
  onLocation,
  location,
  activeEmergency,
  onAddDetails,
  onClearEmergency,
}) {
  const [tapCount, setTapCount] = useState(0);
  const [isCooldown, setIsCooldown] = useState(false);
  const tapTimerRef = useRef(null);

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    };
  }, []);

  const handleSosButtonClick = () => {
    if (isCooldown) return;

    const nextCount = tapCount + 1;
    setTapCount(nextCount);

    // Haptic feedback for each tap
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      try {
        navigator.vibrate(nextCount === 3 ? [150, 50, 150, 50, 250] : 60);
      } catch {}
    }

    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
    }

    if (nextCount === 3) {
      setTapCount(0);
      setIsCooldown(true);
      setTimeout(() => setIsCooldown(false), 3000);
      onTriggerSOS({ source: "triple_tap" });
    } else {
      // Set window for subsequent taps (2.2s window)
      tapTimerRef.current = setTimeout(() => {
        if (nextCount === 1) {
          // User tapped once and waited -> manual report form
          setTapCount(0);
          onManualReport();
        } else {
          setTapCount(0);
        }
      }, 2200);
    }
  };

  const handleDirectAccessibleSOS = () => {
    if (isCooldown) return;
    setIsCooldown(true);
    setTimeout(() => setIsCooldown(false), 3000);
    onTriggerSOS({ source: "direct_accessible" });
  };

  return (
    <div className="screen home-screen">
      {/* Top Welcome Heading */}
      <div className="welcome-row">
        <div>
          <p className="eyebrow">RESQNET DISASTER COORDINATION</p>
          <h2>Emergency<br />Assistance</h2>
        </div>
        <div className="shield-emblem" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M12 8v8" />
            <path d="M8 12h8" />
          </svg>
        </div>
      </div>

      {/* PWA 1-Click Install Banner */}
      <InstallAppBanner />

      {/* Active Emergency Alert Card (if triggered) */}
      {activeEmergency && (
        <div className="active-emergency-card" role="alert">
          <div className="emergency-header">
            <span className="emergency-pulse-dot" />
            <strong>EMERGENCY SOS ACTIVE</strong>
            <span className="emergency-live-tag">LIVE</span>
          </div>

          <div className="emergency-id-row">
            <span className="emergency-id-label">Incident ID:</span>
            <code className="emergency-id-code">{activeEmergency.id}</code>
          </div>

          <p className="emergency-meta">
            Saved to local storage.{" "}
            {activeEmergency.latitude != null ? (
              <span className="gps-pill">
                📍 {activeEmergency.latitude.toFixed(4)}, {activeEmergency.longitude.toFixed(4)}{" "}
                (±{Math.round(activeEmergency.accuracy || 0)}m)
              </span>
            ) : (
              <span className="gps-pill pending">🛰️ Acquiring GPS fix in background...</span>
            )}
          </p>

          <div className="emergency-actions">
            <button
              className="action-pill primary-pill"
              onClick={() => onAddDetails(activeEmergency)}
            >
              <span>✏️</span> Add Details / Photos
            </button>
            {onClearEmergency && (
              <button
                className="action-pill secondary-pill"
                onClick={onClearEmergency}
                title="Mark this local incident as resolved or dismiss"
              >
                ✓ Dismiss Alert
              </button>
            )}
          </div>
        </div>
      )}

      {/* Primary SOS Action Area */}
      <div className="sos-action">
        <div className="sos-button-wrapper">
          <button
            className={`sos-button ${tapCount > 0 ? `tap-${tapCount}` : ""} ${
              isCooldown ? "cooldown" : ""
            }`}
            onClick={handleSosButtonClick}
            aria-label="Emergency SOS. Triple-tap to trigger instant emergency report without typing, or tap once to open detailed report form."
          >
            <span className="sos-plus">+</span>
            <strong>SOS</strong>
            <small>
              {tapCount === 0 && "TRIPLE-TAP SOS"}
              {tapCount === 1 && "TAP 2 MORE TIMES"}
              {tapCount === 2 && "TAP 1 MORE TIME!"}
              {tapCount >= 3 && "ACTIVATING SOS..."}
            </small>
          </button>
        </div>

        {/* Tap indicator dots */}
        <div className="tap-progress-dots" aria-hidden="true">
          <span className={`tap-dot ${tapCount >= 1 ? "filled" : ""}`} />
          <span className={`tap-dot ${tapCount >= 2 ? "filled" : ""}`} />
          <span className={`tap-dot ${tapCount >= 3 ? "filled" : ""}`} />
        </div>

        <p className="sos-caption">
          <strong>Triple-tap SOS</strong> creates instant report without typing.
          <br />
          Single tap opens detailed form.
        </p>

        {/* Accessible 1-Tap Alternative */}
        <button
          className="accessible-sos-btn"
          onClick={handleDirectAccessibleSOS}
          disabled={isCooldown}
          aria-label="Accessible Instant 1-Tap SOS"
        >
          <span className="warn-icon">⚠</span>
          <span>1-Tap Instant SOS (Accessible Alternative)</span>
        </button>
      </div>

      {/* GPS Location Summary */}
      <div className="info-card location-summary">
        <div className="info-icon">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" />
            <line x1="12" y1="2" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="2" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="22" y2="12" />
          </svg>
        </div>
        <div className="info-copy">
          <strong>My GPS Fix</strong>
          <p>
            {location
              ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)} (±${Math.round(
                  location.accuracy
                )}m)`
              : "Location not captured yet"}
          </p>
        </div>
        <button className="text-button" onClick={onLocation}>
          {location ? "Update" : "Acquire Fix"}
        </button>
      </div>

      <div className="home-note">
        <span className="status-dot online-dot" />
        <p>Offline-First: Saved to device before any network transmission.</p>
      </div>
    </div>
  );
}