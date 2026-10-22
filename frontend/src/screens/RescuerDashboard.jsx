import { useState, useEffect, useCallback } from "react";
import { MapContainer, TileLayer, CircleMarker, Circle, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { getApiBaseUrl } from "../services/reportSync";

export default function RescuerDashboard() {
  const [token, setToken] = useState(() => localStorage.getItem("resqnet-rescuer-token") || "");
  const [rescuerInfo, setRescuerInfo] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("resqnet-rescuer-info") || "null");
    } catch {
      return null;
    }
  });

  // Login form state
  const [username, setUsername] = useState("commander");
  const [password, setPassword] = useState("resqnet2026");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Dashboard data state
  const [reports, setReports] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [filterType, setFilterType] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");
  const [filterTriage, setFilterTriage] = useState("");
  const [sortBy, setSortBy] = useState("urgency");
  const [activeTab, setActiveTab] = useState("list"); // "list" or "map"
  const [selectedReport, setSelectedReport] = useState(null);
  const [triageStatusInput, setTriageStatusInput] = useState("");
  const [triageNotesInput, setTriageNotesInput] = useState("");
  const [isUpdatingTriage, setIsUpdatingTriage] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState("");

  const baseUrl = getApiBaseUrl() || "http://localhost:4000/api";

  const fetchReports = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterType) params.append("type", filterType);
      if (filterSeverity) params.append("severity", filterSeverity);
      if (filterTriage) params.append("triageStatus", filterTriage);
      if (sortBy) params.append("sortBy", sortBy);
      params.append("limit", "100");

      const res = await fetch(`${baseUrl}/reports?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        setToken("");
        setRescuerInfo(null);
        localStorage.removeItem("resqnet-rescuer-token");
        localStorage.removeItem("resqnet-rescuer-info");
        return;
      }

      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
        setTotalCount(data.total || 0);
      }
    } catch (err) {
      console.error("Failed to fetch rescuer reports:", err);
    } finally {
      setIsLoading(false);
    }
  }, [token, baseUrl, filterType, filterSeverity, filterTriage, sortBy]);

  useEffect(() => {
    if (!token) return;
    const timer = setTimeout(() => {
      fetchReports();
    }, 0);
    const interval = setInterval(fetchReports, 10000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [token, fetchReports]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || "Login failed");
        return;
      }

      setToken(data.token);
      setRescuerInfo(data.rescuer);
      localStorage.setItem("resqnet-rescuer-token", data.token);
      localStorage.setItem("resqnet-rescuer-info", JSON.stringify(data.rescuer));
    } catch {
      setLoginError("Could not connect to backend server. Make sure it is running.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setToken("");
    setRescuerInfo(null);
    localStorage.removeItem("resqnet-rescuer-token");
    localStorage.removeItem("resqnet-rescuer-info");
  };

  const handleUpdateTriage = async (reportId) => {
    if (!triageStatusInput) return;
    setIsUpdatingTriage(true);
    try {
      const res = await fetch(`${baseUrl}/reports/${reportId}/triage`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          triageStatus: triageStatusInput,
          triageNotes: triageNotesInput,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        setFeedbackMsg(`Report ${reportId} triage updated to ${triageStatusInput}`);
        setSelectedReport(result.report);
        fetchReports();
        setTimeout(() => setFeedbackMsg(""), 3000);
      }
    } catch (err) {
      setFeedbackMsg(`Update failed: ${err.message}`);
    } finally {
      setIsUpdatingTriage(false);
    }
  };

  // If not logged in, show Rescuer Authentication screen
  if (!token) {
    return (
      <div className="screen rescuer-login-screen">
        <div className="screen-heading">
          <p className="eyebrow">RESCUE COORDINATION</p>
          <h2>Rescuer operations</h2>
          <p className="subheading">
            Authorized personnel only. Access confirmed cloud emergency reports.
          </p>
        </div>

        <form className="report-form login-box" onSubmit={handleLogin}>
          {loginError && <p className="reports-error" role="alert">{loginError}</p>}

          <label htmlFor="rescuer-user">Rescuer ID / Username</label>
          <input
            id="rescuer-user"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />

          <label htmlFor="rescuer-pass">Passcode / PIN</label>
          <input
            id="rescuer-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button className="primary-button submit-button" type="submit" disabled={isLoggingIn}>
            {isLoggingIn ? "Authenticating..." : "Sign in to Command Dashboard"}
          </button>

          <p className="form-disclaimer">
            Default credentials for testing: commander / resqnet2026 or medic / medic123
          </p>
        </form>
      </div>
    );
  }

  // Calculate statistics
  const criticalCount = reports.filter((r) => r.severity === "Critical").length;
  const dispatchedCount = reports.filter((r) => r.triageStatus === "dispatched").length;
  const rescuedCount = reports.filter((r) => r.triageStatus === "rescued").length;
  const reportsWithGps = reports.filter((r) => r.latitude != null && r.longitude != null);

  // Map center: average of reports or default
  const mapCenter =
    reportsWithGps.length > 0
      ? [reportsWithGps[0].latitude, reportsWithGps[0].longitude]
      : [28.6139, 77.209];

  return (
    <div className="screen rescuer-dashboard-screen">
      {/* Rescuer Top Bar */}
      <div className="rescuer-header">
        <div>
          <span className="badge-tag">{rescuerInfo?.badgeNumber || "RESCUER"}</span>
          <h3>{rescuerInfo?.name || "Operations Center"}</h3>
        </div>
        <button className="text-button logout-btn" onClick={handleLogout}>
          Sign out
        </button>
      </div>

      {feedbackMsg && <div className="toast feedback-toast">{feedbackMsg}</div>}

      {/* KPI Summary Cards */}
      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-num">{totalCount}</span>
          <span className="stat-label">Total Cloud Reports</span>
        </div>
        <div className="stat-card stat-critical">
          <span className="stat-num">{criticalCount}</span>
          <span className="stat-label">Critical</span>
        </div>
        <div className="stat-card stat-dispatched">
          <span className="stat-num">{dispatchedCount}</span>
          <span className="stat-label">Dispatched</span>
        </div>
        <div className="stat-card stat-rescued">
          <span className="stat-num">{rescuedCount}</span>
          <span className="stat-label">Rescued</span>
        </div>
      </div>

      {/* View Switcher: List vs Map */}
      <div className="tab-switcher">
        <button
          className={`tab-btn ${activeTab === "list" ? "active" : ""}`}
          onClick={() => setActiveTab("list")}
        >
          Incident List ({reports.length})
        </button>
        <button
          className={`tab-btn ${activeTab === "map" ? "active" : ""}`}
          onClick={() => setActiveTab("map")}
        >
          Incident Map ({reportsWithGps.length})
        </button>
      </div>

      {/* Filter and Sort Toolbar */}
      <div className="filter-toolbar">
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All Categories</option>
          <option value="Emergency SOS">Emergency SOS</option>
          <option value="Medical">Medical</option>
          <option value="Trapped">Trapped</option>
          <option value="Fire">Fire</option>
          <option value="Flood">Flood</option>
          <option value="Structural Collapse">Structural Collapse</option>
          <option value="Other">Other</option>
        </select>

        <select value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)}>
          <option value="">All Severities</option>
          <option value="Critical">Critical</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>

        <select value={filterTriage} onChange={(e) => setFilterTriage(e.target.value)}>
          <option value="">All Triage States</option>
          <option value="new">New</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="dispatched">Dispatched</option>
          <option value="rescued">Rescued</option>
          <option value="closed">Closed</option>
        </select>

        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="urgency">Urgency First</option>
          <option value="recency">Newest First</option>
        </select>

        <button className="text-button" onClick={fetchReports} disabled={isLoading}>
          {isLoading ? "..." : "↻ Refresh"}
        </button>
      </div>

      {/* MAP VIEW */}
      {activeTab === "map" && (
        <div className="real-map rescuer-map-container">
          <MapContainer center={mapCenter} zoom={13} scrollWheelZoom={true}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {reportsWithGps.map((r) => {
              const color =
                r.severity === "Critical"
                  ? "#d94743"
                  : r.severity === "High"
                  ? "#e67e22"
                  : "#245b46";
              return (
                <div key={r.id}>
                  {r.accuracy && (
                    <Circle
                      center={[r.latitude, r.longitude]}
                      radius={r.accuracy}
                      pathOptions={{ color, fillColor: color, fillOpacity: 0.15, weight: 1 }}
                    />
                  )}
                  <CircleMarker
                    center={[r.latitude, r.longitude]}
                    radius={8}
                    pathOptions={{ color: "#ffffff", weight: 2, fillColor: color, fillOpacity: 1 }}
                  >
                    <Popup>
                      <strong>{r.id}</strong> ({r.type})
                      <br />
                      Severity: <strong>{r.severity}</strong>
                      <br />
                      People: {r.people || 1}
                      <br />
                      Triage: <strong>{(r.triageStatus || "new").toUpperCase()}</strong>
                      <br />
                      <button
                        className="text-button"
                        onClick={() => {
                          setSelectedReport(r);
                          setTriageStatusInput(r.triageStatus || "acknowledged");
                          setTriageNotesInput(r.triageNotes || "");
                        }}
                      >
                        Manage Triage
                      </button>
                    </Popup>
                  </CircleMarker>
                </div>
              );
            })}
          </MapContainer>
        </div>
      )}

      {/* LIST VIEW */}
      {activeTab === "list" && (
        <div className="reports-list">
          {reports.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">✓</div>
              <h3>No incidents matching filters</h3>
              <p>Confirmed emergency reports received by the server will appear here.</p>
            </div>
          ) : (
            reports.map((report) => (
              <article
                className={`report-card triage-card ${
                  selectedReport?.id === report.id ? "selected-card" : ""
                }`}
                key={report.id}
              >
                <div className="report-card-top">
                  <span className="report-type">{report.type}</span>
                  <span className={`severity-tag ${(report.severity || "unknown").toLowerCase()}`}>
                    {report.severity || "Severity unknown"}
                  </span>
                </div>

                <div className="report-id-row">
                  <h3>{report.id}</h3>
                  <span className={`triage-tag status-${report.triageStatus || "new"}`}>
                    {(report.triageStatus || "new").toUpperCase()}
                  </span>
                </div>

                <p>{report.description || "No description provided."}</p>

                <div className="report-details">
                  <span>{report.people || 1} affected</span>
                  {report.latitude != null && report.longitude != null ? (
                    <a
                      href={`https://www.google.com/maps?q=${report.latitude},${report.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {report.latitude.toFixed(5)}, {report.longitude.toFixed(5)} (±
                      {Math.round(report.accuracy || 0)}m)
                    </a>
                  ) : (
                    <span>No GPS fix</span>
                  )}
                  {report.relayHops > 0 && (
                    <span className="relay-badge">Relayed via {report.relayHops} peers</span>
                  )}
                  {report.cloudReceivedAt && (
                    <span>Cloud: {new Date(report.cloudReceivedAt).toLocaleTimeString()}</span>
                  )}
                </div>

                {report.triageNotes && (
                  <div className="triage-notes-display">
                    <strong>Rescuer Dispatch Notes:</strong> {report.triageNotes}
                    <small> — {report.triageUpdatedBy}</small>
                  </div>
                )}

                {/* Triage Action Panel */}
                <div className="triage-action-bar">
                  <button
                    className="choice"
                    onClick={() => {
                      if (selectedReport?.id === report.id) {
                        setSelectedReport(null);
                      } else {
                        setSelectedReport(report);
                        setTriageStatusInput(report.triageStatus || "acknowledged");
                        setTriageNotesInput(report.triageNotes || "");
                      }
                    }}
                  >
                    {selectedReport?.id === report.id ? "Close Triage" : "Update Triage Status"}
                  </button>
                </div>

                {selectedReport?.id === report.id && (
                  <div className="triage-editor-box">
                    <label>Set Operational Status</label>
                    <div className="choice-grid">
                      {["acknowledged", "dispatched", "rescued", "closed"].map((st) => (
                        <button
                          key={st}
                          type="button"
                          className={`choice ${triageStatusInput === st ? "selected" : ""}`}
                          onClick={() => setTriageStatusInput(st)}
                        >
                          {st.toUpperCase()}
                        </button>
                      ))}
                    </div>

                    <label htmlFor="triage-note">Operational Note / Dispatch Info</label>
                    <input
                      id="triage-note"
                      type="text"
                      placeholder="e.g. Unit 4 dispatched; victim extracted"
                      value={triageNotesInput}
                      onChange={(e) => setTriageNotesInput(e.target.value)}
                    />

                    <button
                      className="primary-button"
                      onClick={() => handleUpdateTriage(report.id)}
                      disabled={isUpdatingTriage}
                    >
                      {isUpdatingTriage ? "Saving..." : "Save Triage Record"}
                    </button>
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      )}
    </div>
  );
}
