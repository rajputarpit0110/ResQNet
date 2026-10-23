import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Circle, CircleMarker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

// Helper component to smoothly re-center map when position changes
function RecenterMap({ position }) {
  const map = useMap();
  const prevPositionRef = useRef(null);

  useEffect(() => {
    if (position && position[0] && position[1]) {
      const isFirst = !prevPositionRef.current;
      prevPositionRef.current = position;
      if (isFirst) {
        map.setView(position, 16);
      } else {
        map.flyTo(position, 16, { animate: true, duration: 1.0 });
      }
    }
  }, [position, map]);

  return null;
}

export default function LocationScreen({
  location,
  onLocate,
  isLocating,
}) {
  // Auto-attempt location acquisition on mount if not yet captured
  const hasAttemptedRef = useRef(false);
  useEffect(() => {
    if (!location && onLocate && !hasAttemptedRef.current) {
      hasAttemptedRef.current = true;
      onLocate();
    }
  }, [location, onLocate]);

  // Persist last known location to localStorage so map always opens with familiar context
  useEffect(() => {
    if (location?.latitude && location?.longitude) {
      try {
        localStorage.setItem(
          "resqnet-last-gps",
          JSON.stringify({
            latitude: location.latitude,
            longitude: location.longitude,
          })
        );
      } catch {
        // Ignore localStorage quota errors
      }
    }
  }, [location]);

  // Fallback cached position if current GPS hasn't locked yet
  const cachedGps = (() => {
    try {
      const stored = localStorage.getItem("resqnet-last-gps");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  })();

  const defaultCenter = [28.6139, 77.209]; // Default disaster response anchor (New Delhi / regional)
  const mapCenter = location
    ? [location.latitude, location.longitude]
    : cachedGps
    ? [cachedGps.latitude, cachedGps.longitude]
    : defaultCenter;

  const currentPosition = location ? [location.latitude, location.longitude] : null;

  const mapsUrl = location
    ? `https://www.google.com/maps?q=${location.latitude},${location.longitude}`
    : null;

  return (
    <div className="screen location-screen">
      <div className="screen-heading">
        <p className="eyebrow">GPS & POSITION</p>
        <h2>Your location</h2>
        <p className="subheading">
          Real-time GPS coordinate lock for disaster rescue and evacuation.
        </p>
      </div>

      <div className="real-map">
        {/* Floating live status pill on the map */}
        <div className={`map-status-pill ${location ? "locked" : "pending"}`}>
          {isLocating ? (
            <>
              <span className="pulse-dot active" />
              <span>Locking onto GPS satellites...</span>
            </>
          ) : location ? (
            <>
              <span className="pulse-dot online" />
              <span>GPS Locked (±{Math.round(location.accuracy || 0)}m)</span>
            </>
          ) : (
            <>
              <span className="pulse-dot warning" />
              <span>GPS Pending — Tap "Get my location" below</span>
            </>
          )}
        </div>

        <MapContainer
          center={mapCenter}
          zoom={location ? 16 : 13}
          scrollWheelZoom={false}
          zoomControl={true}
          style={{ width: "100%", height: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />

          <RecenterMap position={currentPosition} />

          {currentPosition && (
            <>
              <Circle
                center={currentPosition}
                radius={location.accuracy || 30}
                pathOptions={{
                  color: "#16845b",
                  fillColor: "#2bbf83",
                  fillOpacity: 0.18,
                  weight: 2,
                }}
              />

              <CircleMarker
                center={currentPosition}
                radius={9}
                pathOptions={{
                  color: "#ffffff",
                  weight: 3,
                  fillColor: "#e63e43",
                  fillOpacity: 1,
                }}
              >
                <Popup>
                  <strong>Your GPS Position</strong>
                  <br />
                  Lat: {location.latitude.toFixed(6)}
                  <br />
                  Lng: {location.longitude.toFixed(6)}
                  <br />
                  Accuracy: ±{Math.round(location.accuracy || 0)} m
                </Popup>
              </CircleMarker>
            </>
          )}
        </MapContainer>
      </div>

      <div className="coordinate-card">
        <span className="coordinate-label">LATITUDE</span>
        <span className="coordinate-label">LONGITUDE</span>

        <strong>
          {location ? location.latitude.toFixed(6) : isLocating ? "Acquiring..." : "Not locked"}
        </strong>
        <strong>
          {location ? location.longitude.toFixed(6) : isLocating ? "Acquiring..." : "Not locked"}
        </strong>

        <span className="coordinate-label">GPS ACCURACY</span>
        <span className="coordinate-label">CAPTURED AT</span>

        <strong>
          {location ? `±${Math.round(location.accuracy)} m` : isLocating ? "Calculating..." : "Pending"}
        </strong>
        <strong>
          {location
            ? new Date(location.capturedAt).toLocaleTimeString()
            : isLocating
            ? "Pending..."
            : "Not captured"}
        </strong>
      </div>

      <button
        className="primary-button"
        onClick={onLocate}
        disabled={isLocating}
      >
        {isLocating
          ? "🛰️ Acquiring GPS fix..."
          : location
          ? "🔄 Refresh GPS coordinates"
          : "📍 Get my location"}
      </button>

      {mapsUrl && (
        <a
          className="maps-link"
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open these coordinates in Google Maps ↗
        </a>
      )}

      <p className="form-disclaimer">
        GPS accuracy varies with cloud cover and terrain. Offline map tiles cached locally when available.
      </p>
    </div>
  );
}
