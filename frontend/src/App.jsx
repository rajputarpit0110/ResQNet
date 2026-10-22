import { useState, useEffect, useRef } from "react";
import AppHeader from "./components/AppHeader";
import BottomNav from "./components/BottomNav";
import HomeScreen from "./screens/HomeScreen";
import ReportScreen from "./screens/ReportScreen";
import LocationScreen from "./screens/LocationScreen";
import ReportsScreen from "./screens/ReportsScreen";
import PeerShareScreen from "./screens/PeerShareScreen";
import RescuerDashboard from "./screens/RescuerDashboard";
import { saveReport, updateReport } from "./services/reportStorage";
import { isReportSyncConfigured, syncPendingReports } from "./services/reportSync";
import { triggerEmergencySOS } from "./services/emergencySOS";
import "./styles/App.css";

export default function App() {
  const [activeTab, setActiveTab] = useState("home");
  const [location, setLocation] = useState(null);
  const [message, setMessage] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeEmergency, setActiveEmergency] = useState(null);
  const [reportToEdit, setReportToEdit] = useState(null);

  const messageTimer = useRef(null);

  const showMessage = (text) => {
    if (messageTimer.current) {
      clearTimeout(messageTimer.current);
    }

    setMessage(text);

    messageTimer.current = setTimeout(() => {
      setMessage("");
      messageTimer.current = null;
    }, 2500);
  };

  useEffect(() => {
    return () => {
      if (messageTimer.current) {
        clearTimeout(messageTimer.current);
      }
    };
  }, []);

  // Background and event-driven report sync
  useEffect(() => {
    if (!isReportSyncConfigured()) return undefined;

    const runSync = () => {
      syncPendingReports()
        .then((result) => {
          if (result && result.synced > 0) {
            window.dispatchEvent(new CustomEvent("resqnet:reports-updated"));
          }
        })
        .catch((error) => console.error("Report sync check error:", error));
    };

    if (navigator.onLine) runSync();
    window.addEventListener("online", runSync);
    const periodicTimer = setInterval(() => {
      if (navigator.onLine) runSync();
    }, 30000);

    return () => {
      window.removeEventListener("online", runSync);
      clearInterval(periodicTimer);
    };
  }, []);

  const handleLocation = () => {
    if (!navigator.geolocation) {
      showMessage("Your browser does not support GPS.");
      return;
    }

    const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);

    if (!window.isSecureContext && !isLocalHost) {
      showMessage("GPS requires a secure context (HTTPS or localhost).");
      return;
    }

    setIsLocating(true);
    setMessage("");

    if (messageTimer.current) {
      clearTimeout(messageTimer.current);
      messageTimer.current = null;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const capturedLoc = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
        };
        setLocation(capturedLoc);
        setIsLocating(false);
        showMessage("GPS location acquired successfully.");

        // If an active emergency exists without location, update it!
        if (activeEmergency && !activeEmergency.latitude) {
          setActiveEmergency((prev) => (prev ? { ...prev, ...capturedLoc } : null));
        }
      },
      (error) => {
        setIsLocating(false);

        const errorMessages = {
          1: "Location permission denied. Please allow in browser settings.",
          2: "GPS location unavailable. Move towards open sky or windows.",
          3: "GPS request timed out. Please try again.",
        };

        showMessage(errorMessages[error.code] || "Location acquisition failed. Try again.");
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  // Immediate Triple-Tap or Accessible Emergency SOS trigger
  const handleTriggerSOS = async ({ source = "triple_tap" } = {}) => {
    try {
      const sosReport = await triggerEmergencySOS({
        source,
        existingLocation: location,
        onProgress: (status) => {
          if (status.phase === "saved") {
            setActiveEmergency(status.report);
            showMessage(`SOS ACTIVATED: Report #${status.report.id} saved on this device!`);
          } else if (status.phase === "gps_acquired") {
            setActiveEmergency(status.report);
            showMessage("GPS fix acquired & attached to emergency report.");
          }
        },
      });

      setActiveEmergency(sosReport);
    } catch (err) {
      console.error("SOS trigger failed:", err);
      showMessage("Failed to trigger SOS. Check device storage.");
    }
  };

  const handleOpenManualForm = () => {
    setReportToEdit(null);
    setActiveTab("report");
  };

  const handleAddDetails = (report) => {
    setReportToEdit(report);
    setActiveTab("report");
  };

  const handleSubmitReport = async (form) => {
    if (isSubmitting) return false;

    setIsSubmitting(true);

    try {
      if (form.id) {
        // Updating an existing report (e.g. adding details to an SOS report)
        const updated = await updateReport(form.id, {
          type: form.type,
          severity: form.severity,
          people: form.people,
          description: form.description,
          contactName: form.contactName,
          contactPhone: form.contactPhone,
          photoDataUrl: form.photoDataUrl,
          audioDataUrl: form.audioDataUrl,
          status: "pending_cloud_sync",
        });
        showMessage(`Report ${form.id} updated with new details.`);
        window.dispatchEvent(new CustomEvent("resqnet:reports-updated"));
        if (activeEmergency?.id === form.id) {
          setActiveEmergency(updated);
        }
      } else {
        // Creating a new report
        const report = {
          ...form,
          id: `RQ-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`,
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
          accuracy: location?.accuracy ?? null,
          locationCapturedAt: location?.capturedAt ?? null,
          locationStatus: location ? "acquired" : "unavailable",
          createdAt: new Date().toISOString(),
          status: "pending_cloud_sync",
        };

        await saveReport(report);
        showMessage(`Emergency report ${report.id} saved locally.`);
        window.dispatchEvent(new CustomEvent("resqnet:reports-updated"));
      }

      setReportToEdit(null);
      setActiveTab("reports");

      // Attempt immediate background sync if online
      if (navigator.onLine) {
        syncPendingReports().catch(() => {});
      }

      return true;
    } catch (error) {
      console.error("Failed to save report:", error);
      showMessage("Could not save report. Storage might be full.");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="app-shell">
      <AppHeader />

      <section className="screen-area">
        {activeTab === "home" && (
          <HomeScreen
            onManualReport={handleOpenManualForm}
            onTriggerSOS={handleTriggerSOS}
            onLocation={handleLocation}
            location={location}
            activeEmergency={activeEmergency}
            onAddDetails={handleAddDetails}
            onClearEmergency={() => setActiveEmergency(null)}
          />
        )}

        {activeTab === "report" && (
          <ReportScreen
            onSubmit={handleSubmitReport}
            isSubmitting={isSubmitting}
            initialReport={reportToEdit}
          />
        )}

        {activeTab === "location" && (
          <LocationScreen
            location={location}
            onLocate={handleLocation}
            isLocating={isLocating}
          />
        )}

        {activeTab === "reports" && (
          <ReportsScreen onSelectReportForEdit={handleAddDetails} />
        )}

        {activeTab === "mesh" && <PeerShareScreen />}

        {activeTab === "rescuer" && <RescuerDashboard />}
      </section>

      {message && (
        <button
          className="toast"
          onClick={() => {
            if (messageTimer.current) {
              clearTimeout(messageTimer.current);
              messageTimer.current = null;
            }
            setMessage("");
          }}
          aria-label="Dismiss notification"
        >
          {message} ×
        </button>
      )}

      <BottomNav activeTab={activeTab} onChange={setActiveTab} />
    </main>
  );
}
