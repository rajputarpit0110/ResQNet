import { useState, useRef, useEffect } from "react";

export default function HomeScreen({
  onManualReport,
  onTriggerSOS,
  onLocation,
  location,
  activeEmergency,
  onAddDetails,
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
      // Triple tap reached!
      setTapCount(0);
      setIsCooldown(true);
      setTimeout(() => setIsCooldown(false), 3000);
      onTriggerSOS({ source: "triple_tap" });
    } else {
      // Set window for subsequent taps; if no more taps, treat as manual report intent
      tapTimerRef.current = setTimeout(() => {
        if (nextCount === 1) {
          // User tapped once and waited -> manual report form
          setTapCount(0);
          onManualReport();
        } else {
          // User stopped after 2 taps -> reset
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
      <div className="welcome-row">
        <div>
          <p className="eyebrow">RESQNET EMERGENCY PLATFORM</p>
          <h2>How can we<br />help you?</h2>
        </div>
        <div className="shield-icon">+</div>
      </div>

      {/* Active Emergency Banner if recently triggered */}
      {activeEmergency && (
        <div className="active-emergency-card" role="alert">
          <div className="emergency-header">
            <span className="emergency-pulse-dot" />
            <strong>EMERGENCY SOS ACTIVE</strong>
          </div>
          <p className="emergency-id">Report ID: <span>{activeEmergency.id}</span></p>
          <p className="emergency-meta">
            Saved locally to device storage.
            {activeEmergency.latitude
              ? ` GPS: ${activeEmergency.latitude.toFixed(4)}, ${activeEmergency.longitude.toFixed(4)}`
              : " Acquiring GPS fix..."}
          </p>
          <div className="emergency-actions">
            <button
              className="text-button"
              onClick={() => onAddDetails(activeEmergency)}
            >
              + Add Details / Description
            </button>
          </div>
        </div>
      )}

      {/* Primary SOS Action Area */}
      <div className="sos-action">
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
            {tapCount === 0 && "TRIPLE-TAP FOR RESCUE"}
            {tapCount === 1 && "TAP 2 MORE TIMES"}
            {tapCount === 2 && "TAP 1 MORE TIME!"}
            {tapCount >= 3 && "ACTIVATING SOS..."}
          </small>
        </button>

        {/* Tap indicator dots */}
        <div className="tap-progress-dots" aria-hidden="true">
          <span className={`tap-dot ${tapCount >= 1 ? "filled" : ""}`} />
          <span className={`tap-dot ${tapCount >= 2 ? "filled" : ""}`} />
          <span className={`tap-dot ${tapCount >= 3 ? "filled" : ""}`} />
        </div>

        <p className="sos-caption">
          <strong>Triple-tap SOS</strong> for instant emergency creation.
          <br />
          Single tap opens detailed report form.
        </p>

        {/* Accessible 1-Tap Alternative */}
        <button
          className="accessible-sos-btn"
          onClick={handleDirectAccessibleSOS}
          disabled={isCooldown}
          aria-label="Accessible Instant 1-Tap SOS"
        >
          <span>⚠</span> 1-Tap Instant SOS (Accessible Alternative)
        </button>
      </div>

      {/* GPS Location Summary */}
      <div className="info-card location-summary">
        <div className="info-icon">◎</div>
        <div className="info-copy">
          <strong>My location</strong>
          <p>
            {location
              ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)} (±${Math.round(
                  location.accuracy
                )}m)`
              : "Location not captured"}
          </p>
        </div>
        <button className="text-button" onClick={onLocation}>
          {location ? "Update" : "Locate"}
        </button>
      </div>

      <div className="home-note">
        <span className="status-dot online-dot" />
        <p>Offline-first: Reports save locally before any network attempt.</p>
      </div>
    </div>
  );
}