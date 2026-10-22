import {
  getPendingReports,
  markReportSyncing,
  markReportSynced,
  markReportSyncFailed,
} from "./reportStorage.js";

let activeSyncPromise = null;
let syncBackoffMs = 1000;
const MAX_BACKOFF_MS = 60000;

export function getApiBaseUrl() {
  const envUrl = import.meta.env.VITE_RESQNET_API_URL;
  if (!envUrl) return null;
  return envUrl.replace(/\/+$/, "");
}

export function isReportSyncConfigured() {
  return Boolean(getApiBaseUrl());
}

export async function checkBackendHealth() {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return false;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(`${baseUrl}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

export function syncPendingReports() {
  if (activeSyncPromise) return activeSyncPromise;

  activeSyncPromise = (async () => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl || !navigator.onLine) {
      return { synced: 0, failed: 0, skipped: true };
    }

    // Real reachability check before attempting batch uploads
    const isHealthy = await checkBackendHealth();
    if (!isHealthy) {
      return { synced: 0, failed: 0, reason: "Backend unreachable" };
    }

    const pending = await getPendingReports();
    if (pending.length === 0) {
      syncBackoffMs = 1000; // Reset backoff
      return { synced: 0, failed: 0 };
    }

    let synced = 0;
    let failed = 0;

    for (const report of pending) {
      try {
        await markReportSyncing(report.id);

        const response = await fetch(`${baseUrl}/reports`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `${report.id}-r${report.revision || 1}`,
          },
          body: JSON.stringify(report),
        });

        if (response.ok) {
          const ack = await response.json().catch(() => ({}));
          await markReportSynced(report.id, ack);
          synced += 1;
        } else if (response.status >= 400 && response.status < 500) {
          // Permanent or client validation error
          const errData = await response.json().catch(() => ({}));
          await markReportSyncFailed(
            report.id,
            errData.error || `Rejected by server with HTTP ${response.status}`
          );
          failed += 1;
        } else {
          // 5xx Server error, retryable
          await markReportSyncFailed(report.id, `Server returned HTTP ${response.status}`);
          failed += 1;
        }
      } catch (err) {
        await markReportSyncFailed(report.id, err.message || "Network error");
        failed += 1;
      }
    }

    if (synced > 0) {
      window.dispatchEvent(new CustomEvent("resqnet:reports-updated"));
      syncBackoffMs = 1000;
    }

    if (failed > 0) {
      // Exponential backoff with jitter
      syncBackoffMs = Math.min(MAX_BACKOFF_MS, syncBackoffMs * 1.5 + Math.random() * 500);
    }

    return { synced, failed };
  })().finally(() => {
    activeSyncPromise = null;
  });

  return activeSyncPromise;
}
