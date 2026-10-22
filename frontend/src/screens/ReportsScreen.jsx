import { useEffect, useState, useCallback } from "react";
import { deleteReport, getReports } from "../services/reportStorage";

export default function ReportsScreen({ onSelectReportForEdit }) {
  const [reports, setReports] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const loadReports = useCallback(async () => {
    try {
      const data = await getReports();
      setReports(data);
      setError("");
    } catch (loadError) {
      console.error("Could not load reports:", loadError);
      setError("Reports could not be loaded from this device.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getReports()
      .then((data) => {
        if (active) {
          setReports(data);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          console.error("Initial load failed:", err);
          setError("Reports could not be loaded from this device.");
          setIsLoading(false);
        }
      });

    const handleUpdate = () => {
      loadReports();
    };

    window.addEventListener("resqnet:reports-updated", handleUpdate);
    return () => {
      active = false;
      window.removeEventListener("resqnet:reports-updated", handleUpdate);
    };
  }, [loadReports]);

  const retryLoadingReports = () => {
    setIsLoading(true);
    setError("");
    loadReports();
  };

  const handleDelete = async (report) => {
    if (!window.confirm(`Delete report ${report.id}? This cannot be undone.`)) return;

    setDeletingId(report.id);
    setError("");
    try {
      await deleteReport(report.id);
      setReports((current) => current.filter((item) => item.id !== report.id));
    } catch (deleteError) {
      console.error("Could not delete report:", deleteError);
      setError("The report could not be deleted. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const getStatusBadge = (status) => {
    const s = (status || "pending_cloud_sync").toLowerCase();
    if (s === "synced") {
      return <span className="sync-tag synced">Synced to Cloud ✓</span>;
    }
    if (s === "syncing") {
      return <span className="sync-tag syncing">Syncing...</span>;
    }
    if (s === "failed_retryable") {
      return <span className="sync-tag failed">Retrying Sync</span>;
    }
    return <span className="sync-tag pending">Pending Cloud Sync</span>;
  };

  return (
    <div className="screen reports-screen">
      <div className="screen-heading">
        <p className="eyebrow">YOUR ACTIVITY</p>
        <h2>My reports</h2>
        <p className="subheading">
          Emergency reports saved on this device.
        </p>
      </div>

      {error && <p className="reports-error" role="alert">{error}</p>}

      {isLoading ? (
        <div className="empty-state" role="status">Loading saved reports...</div>
      ) : error && reports.length === 0 ? (
        <div className="empty-state">
          <p>Check device storage and try loading again.</p>
          <button className="text-button" onClick={retryLoadingReports}>Retry</button>
        </div>
      ) : reports.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">▤</div>
          <h3>No reports yet</h3>
          <p>Your saved emergency reports will appear here.</p>
        </div>
      ) : (
        <div className="reports-list">
          {reports.map((report) => (
            <article className="report-card" key={report.id}>
              <div className="report-card-top">
                <span className="report-type">{report.type}</span>
                <span className={`severity-tag ${(report.severity || "unknown").toLowerCase()}`}>
                  {report.severity || "Severity unknown"}
                </span>
              </div>
              <div className="report-id-row">
                <h3>{report.id}</h3>
                {report.revision > 1 && (
                  <span className="rev-badge">Rev {report.revision}</span>
                )}
                {report.relayHops > 0 && (
                  <span className="relay-badge">Relayed ({report.relayHops} {report.relayHops === 1 ? "hop" : "hops"})</span>
                )}
              </div>
              <p>
                {report.description || "No additional details provided."}
              </p>
              <div className="report-details">
                <span>{report.people || 1} {report.people === 1 ? "person" : "people"} affected</span>
                {report.latitude != null && report.longitude != null ? (
                  <a href={`https://www.google.com/maps?q=${report.latitude},${report.longitude}`} target="_blank" rel="noreferrer">
                    {report.latitude.toFixed(6)}, {report.longitude.toFixed(6)}
                  </a>
                ) : <span>Location not captured</span>}
                {report.accuracy != null && <span>GPS accuracy ±{Math.round(report.accuracy)} m</span>}
                {report.locationCapturedAt && <span>GPS captured {new Date(report.locationCapturedAt).toLocaleTimeString()}</span>}
                {report.batteryLevel != null && <span>Battery {report.batteryLevel}%</span>}
              </div>
              <div className="report-card-bottom">
                <span>{new Date(report.createdAt).toLocaleString()}</span>
                {getStatusBadge(report.status)}
              </div>
              <div className="report-card-actions">
                {onSelectReportForEdit && (
                  <button
                    className="text-button edit-btn"
                    onClick={() => onSelectReportForEdit(report)}
                  >
                    + Add details / edit
                  </button>
                )}
                <button
                  className="delete-report"
                  onClick={() => handleDelete(report)}
                  disabled={deletingId === report.id}
                  aria-label={`Delete report ${report.id}`}
                >
                  {deletingId === report.id ? "Deleting..." : "Delete report"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}