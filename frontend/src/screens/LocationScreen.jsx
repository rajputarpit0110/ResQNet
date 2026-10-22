
import { MapContainer, TileLayer, Circle, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export default function LocationScreen({
  location,
  onLocate,
  isLocating,
}) {
  const position = location
    ? [location.latitude, location.longitude]
    : null;

  const mapsUrl = location
    ? `https://www.google.com/maps?q=${location.latitude},${location.longitude}`
    : null;

  return (
    <div className="screen location-screen">
      <div className="screen-heading">
        <p className="eyebrow">GPS & POSITION</p>
        <h2>Your location</h2>
        <p className="subheading">
          Your marker is placed using your captured GPS coordinates.
        </p>
      </div>

      <div className="real-map">
        {position ? (
          <MapContainer
            key={`${location.latitude}-${location.longitude}`}
            center={position}
            zoom={18}
            scrollWheelZoom={false}
            zoomControl={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <Circle
              center={position}
              radius={location.accuracy || 30}
              pathOptions={{
                color: "#16845b",
                fillColor: "#2bbf83",
                fillOpacity: 0.18,
                weight: 2,
              }}
            />

            <CircleMarker
              center={position}
              radius={9}
              pathOptions={{
                color: "#ffffff",
                weight: 3,
                fillColor: "#e63e43",
                fillOpacity: 1,
              }}
            >
              <Popup>
                <strong>Your captured location</strong>
                <br />
                Accuracy: ±{Math.round(location.accuracy || 0)} metres
              </Popup>
            </CircleMarker>
          </MapContainer>
        ) : (
          <div className="map-empty">
            <span className="map-empty-icon">◎</span>
            <strong>Location not captured</strong>
            <p>Get your GPS location to show your position on the map.</p>
          </div>
        )}
      </div>

      <div className="coordinate-card">
        <span className="coordinate-label">LATITUDE</span>
        <span className="coordinate-label">LONGITUDE</span>

        <strong>
          {location ? location.latitude.toFixed(6) : "Not available"}
        </strong>
        <strong>
          {location ? location.longitude.toFixed(6) : "Not available"}
        </strong>

        <span className="coordinate-label">GPS ACCURACY</span>
        <span className="coordinate-label">CAPTURED AT</span>

        <strong>
          {location
            ? `±${Math.round(location.accuracy)} m`
            : "Unknown"}
        </strong>
        <strong>
          {location
            ? new Date(location.capturedAt).toLocaleTimeString()
            : "Not captured"}
        </strong>
      </div>

      <button
        className="primary-button"
        onClick={onLocate}
        disabled={isLocating}
      >
        {isLocating
          ? "Getting location..."
          : location
            ? "Refresh location"
            : "Get my location"}
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
        GPS accuracy varies. Map tiles require internet and may not load
        offline.
      </p>
    </div>
  );
}
