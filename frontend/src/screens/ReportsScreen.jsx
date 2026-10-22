import { useEffect, useState } from "react";
import { deleteReport, getReports } from "../services/reportStorage";

export default function ReportsScreen() {
  const [reports, setReports] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const loadReports = async () => {
    try {
      setReports(await getReports());
    } catch (loadError) {
      console.error("Could not load reports:", loadError);
      setError("Reports could not be loaded from this device.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
    window.addEventListener("resqnet:reports-updated", loadReports);
    return () => window.removeEventListener("resqnet:reports-updated", loadReports);
  }, []);

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
              <h3>{report.id}</h3>
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
                {report.locationCapturedAt && <span>GPS captured {new Date(report.locationCapturedAt).toLocaleString()}</span>}
              </div>
              <div className="report-card-bottom">
                <span>{new Date(report.createdAt).toLocaleString()}</span>
                <span className="pending-tag">{report.status || "Pending sync"}</span>
              </div>
              <button className="delete-report" onClick={() => handleDelete(report)} disabled={deletingId === report.id} aria-label={`Delete report ${report.id}`}>
                {deletingId === report.id ? "Deleting..." : "Delete report"}
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}