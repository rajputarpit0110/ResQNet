import { saveReport, updateReportLocation, getBatteryLevel, getOrCreateDeviceId } from "./reportStorage.js";
import { syncPendingReports } from "./reportSync.js";

export async function triggerEmergencySOS({
  source = "triple_tap",
  existingLocation = null,
  onProgress = () => {},
} = {}) {
  const reportId = `RQ-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`;
  const now = new Date().toISOString();
  const deviceId = await getOrCreateDeviceId();
  const batteryLevel = await getBatteryLevel();

  // Haptic feedback if supported
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate([150, 80, 150, 80, 300]);
    } catch {}
  }

  // Audio chirp feedback using Web Audio API if permitted
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch {}

  // 1. Immediately create minimal emergency report
  const initialReport = {
    id: reportId,
    type: "Emergency SOS",
    severity: "Critical",
    people: 1,
    description: `Automated ${source === "triple_tap" ? "Triple-Tap" : "Direct"} Emergency SOS`,
    source,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    relayHops: 0,
    deviceId,
    batteryLevel,
    latitude: existingLocation?.latitude ?? null,
    longitude: existingLocation?.longitude ?? null,
    accuracy: existingLocation?.accuracy ?? null,
    locationCapturedAt: existingLocation?.capturedAt ?? null,
    locationStatus: existingLocation ? "acquired" : "pending",
    status: "pending_cloud_sync",
  };

  // Save to Dexie immediately - DO NOT wait for GPS or network!
  await saveReport(initialReport);
  window.dispatchEvent(new CustomEvent("resqnet:reports-updated", { detail: { reportId } }));
  onProgress({ phase: "saved", report: initialReport });

  // 2. Parallel GPS acquisition
  if (typeof navigator !== "undefined" && navigator.geolocation) {
    onProgress({ phase: "acquiring_gps", reportId });
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const loc = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
        };
        const updated = await updateReportLocation(reportId, loc);
        window.dispatchEvent(new CustomEvent("resqnet:reports-updated", { detail: { reportId } }));
        onProgress({ phase: "gps_acquired", report: updated });

        // Trigger network sync if online
        if (navigator.onLine) {
          syncPendingReports().catch(() => {});
        }
      },
      async (err) => {
        console.warn("SOS parallel GPS acquisition error:", err.message);
        onProgress({ phase: "gps_failed", error: err.message });
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  }

  // 3. Attempt immediate sync in parallel if online
  if (typeof navigator !== "undefined" && navigator.onLine) {
    syncPendingReports().catch(() => {});
  }

  return initialReport;
}
