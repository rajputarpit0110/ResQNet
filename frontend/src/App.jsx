
import { useState, useEffect, useRef } from "react";
import AppHeader from "./components/AppHeader";
import BottomNav from "./components/BottomNav";
import HomeScreen from "./screens/HomeScreen";
import ReportScreen from "./screens/ReportScreen";
import LocationScreen from "./screens/LocationScreen";
import ReportsScreen from "./screens/ReportsScreen";
import { saveReport } from "./services/reportStorage";
import { isReportSyncConfigured, syncPendingReports } from "./services/reportSync";
import "./styles/App.css";

export default function App() {
  const [activeTab, setActiveTab] = useState("home");
  const [location, setLocation] = useState(null);
  const [message, setMessage] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const messageTimer = useRef(null);

  const showMessage = (text) => {
    if (messageTimer.current) {
      clearTimeout(messageTimer.current);
    }

    setMessage(text);

    messageTimer.current = setTimeout(() => {
      setMessage("");
      messageTimer.current = null;
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (messageTimer.current) {
        clearTimeout(messageTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isReportSyncConfigured()) return undefined;

    const sync = () => {
      syncPendingReports()
        .then((result) => {
          if (result.synced) {
            window.dispatchEvent(new Event("resqnet:reports-updated"));
          }
        })
        .catch((error) => console.error("Report sync failed:", error));
    };

    if (navigator.onLine) sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, []);

  const handleLocation = () => {
    if (!navigator.geolocation) {
      showMessage("Your browser does not support GPS.");
      return;
    }

    const isLocalHost = ["localhost", "127.0.0.1"].includes(
      window.location.hostname,
    );

    if (!window.isSecureContext && !isLocalHost) {
      showMessage("GPS ke liye app ko HTTPS par kholo.");
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
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
        });

        setIsLocating(false);
        showMessage("GPS location captured successfully.");
      },
      (error) => {
        setIsLocating(false);

        const errorMessages = {
          1: "Location permission denied. Browser settings mein allow karo.",
          2: "GPS location unavailable. Open sky ke paas try karo.",
          3: "GPS timeout. Please try again.",
        };

        showMessage(
          errorMessages[error.code] ||
            "Location nahi mil paayi. Please try again.",
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
  };

  const handleSOS = () => {
    setActiveTab("report");
  };

  const handleSubmitReport = async (form) => {
    if (isSubmitting) return false;

    setIsSubmitting(true);
    const report = {
      ...form,
      id: `RQ-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      accuracy: location?.accuracy ?? null,
      locationCapturedAt: location?.capturedAt ?? null,
      createdAt: new Date().toISOString(),
      status: "Pending sync",
    };

    try {
      await saveReport(report);
      showMessage(`Report ${report.id} saved on this device.`);
      setActiveTab("reports");
      return true;
    } catch (error) {
      console.error("Failed to save report:", error);
      showMessage("Report save nahi hui. Please try again.");
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
            onSOS={handleSOS}
            onLocation={handleLocation}
            location={location}
          />
        )}

        {activeTab === "report" && (
          <ReportScreen onSubmit={handleSubmitReport} isSubmitting={isSubmitting} />
        )}

        {activeTab === "location" && (
          <LocationScreen
            location={location}
            onLocate={handleLocation}
            isLocating={isLocating}
          />
        )}

        {activeTab === "reports" && <ReportsScreen />}
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
          aria-label="Dismiss message"
        >
          {message} ×
        </button>
      )}

      <BottomNav activeTab={activeTab} onChange={setActiveTab} />
    </main>
  );
}
