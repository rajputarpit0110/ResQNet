export default function HomeScreen({ onSOS, onLocation, location }) {
  return (
    <div className="screen home-screen">
      <div className="welcome-row">
        <div>
          <p className="eyebrow">YOUR SAFETY, CONNECTED</p>
          <h2>How can we<br />help you?</h2>
        </div>
        <div className="shield-icon">+</div>
      </div>

      <div className="sos-action">
        <button className="sos-button" onClick={onSOS}>
          <span className="sos-plus">+</span>
          <strong>SOS</strong>
          <small>REQUEST HELP</small>
        </button>

        <p className="sos-caption">
          Tap SOS to create an emergency report.
        </p>
      </div>

      <div className="info-card location-summary">
        <div className="info-icon">◎</div>
        <div className="info-copy">
          <strong>My location</strong>
          <p>
            {location
              ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`
              : "Location not captured"}
          </p>
        </div>
        <button className="text-button" onClick={onLocation}>
          {location ? "Update" : "Locate"}
        </button>
      </div>

      <div className="home-note">
        <span className="status-dot online-dot" />
        <p>Your report can be saved on this device.</p>
      </div>
    </div>
  );
}