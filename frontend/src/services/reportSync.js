import { getPendingReports, markReportSynced } from "./reportStorage";

let activeSync = null;

export function isReportSyncConfigured() {
  return Boolean(import.meta.env.VITE_RESQNET_API_URL);
}

export function syncPendingReports() {
  if (activeSync) return activeSync;

  activeSync = (async () => {
    const baseUrl = import.meta.env.VITE_RESQNET_API_URL?.replace(/\/+$/, "");
    if (!baseUrl || !navigator.onLine) return { synced: 0, failed: 0 };

    const pendingReports = await getPendingReports();
    let synced = 0;
    let failed = 0;

    for (const report of pendingReports) {
      try {
        const response = await fetch(`${baseUrl}/reports`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": report.id,
          },
          body: JSON.stringify(report),
        });

        if (!response.ok) {
          failed += 1;
          continue;
        }

        await markReportSynced(report.id);
        synced += 1;
      } catch {
        failed += 1;
      }
    }

    return { synced, failed };
  })().finally(() => {
    activeSync = null;
  });

  return activeSync;
}
