import Dexie from "dexie";

const STORAGE_KEY = "resqnet-reports";
const db = new Dexie("resqnet");

// Schema versions
db.version(1).stores({
  reports: "id, createdAt, status",
  metadata: "key",
});

db.version(2)
  .stores({
    reports: "id, createdAt, updatedAt, status, type, severity, revision, deviceId",
    metadata: "key",
  })
  .upgrade((tx) => {
    return tx.reports.toCollection().modify((report) => {
      report.updatedAt = report.updatedAt || report.createdAt || new Date().toISOString();
      report.revision = report.revision || 1;
      report.relayHops = report.relayHops || 0;
      if (report.status === "Pending sync") {
        report.status = "pending_cloud_sync";
      } else if (report.status === "Synced") {
        report.status = "synced";
      }
    });
  });

export { db };

// Retrieve or generate pseudonymous device identifier
export async function getOrCreateDeviceId() {
  await db.open();
  const existing = await db.metadata.get("device-id");
  if (existing?.value) {
    return existing.value;
  }
  const newId = `DEV-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`;
  await db.metadata.put({ key: "device-id", value: newId });
  return newId;
}

// Battery level helper (graceful fallback)
export async function getBatteryLevel() {
  if (typeof navigator !== "undefined" && typeof navigator.getBattery === "function") {
    try {
      const battery = await navigator.getBattery();
      return Math.round(battery.level * 100);
    } catch {
      return null;
    }
  }
  return null;
}

async function migrateLegacyReports() {
  await db.open();

  if (await db.metadata.get("legacy-reports-migrated")) {
    return;
  }

  let legacyReports = [];
  try {
    legacyReports = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(legacyReports)) legacyReports = [];
  } catch {
    legacyReports = [];
  }

  await db.transaction("rw", db.reports, db.metadata, async () => {
    if (legacyReports.length) {
      const standardized = legacyReports.map((r) => ({
        ...r,
        updatedAt: r.updatedAt || r.createdAt || new Date().toISOString(),
        revision: r.revision || 1,
        relayHops: r.relayHops || 0,
        status: r.status === "Synced" ? "synced" : "pending_cloud_sync",
      }));
      await db.reports.bulkPut(standardized);
    }
    await db.metadata.put({ key: "legacy-reports-migrated" });
  });

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export async function getReports() {
  await migrateLegacyReports();
  return db.reports.orderBy("createdAt").reverse().toArray();
}

export async function getReportById(id) {
  await migrateLegacyReports();
  return db.reports.get(id);
}

export async function saveReport(report) {
  await migrateLegacyReports();
  const deviceId = report.deviceId || (await getOrCreateDeviceId());
  const now = new Date().toISOString();

  const finalReport = {
    ...report,
    deviceId,
    createdAt: report.createdAt || now,
    updatedAt: report.updatedAt || now,
    revision: report.revision || 1,
    relayHops: report.relayHops || 0,
    status: report.status || "pending_cloud_sync",
    batteryLevel: report.batteryLevel ?? (await getBatteryLevel()),
  };

  await db.reports.put(finalReport);
  return finalReport;
}

export async function updateReportLocation(id, location) {
  await migrateLegacyReports();
  const existing = await db.reports.get(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updated = {
    ...existing,
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy,
    locationCapturedAt: location.capturedAt || now,
    locationStatus: "acquired",
    updatedAt: now,
    revision: (existing.revision || 1) + 1,
    // Re-queue for sync if updated
    status: existing.status === "synced" ? "pending_cloud_sync" : existing.status,
  };

  await db.reports.put(updated);
  return updated;
}

export async function updateReport(id, updates) {
  await migrateLegacyReports();
  const existing = await db.reports.get(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updated = {
    ...existing,
    ...updates,
    updatedAt: now,
    revision: (existing.revision || 1) + 1,
  };

  await db.reports.put(updated);
  return updated;
}

export async function deleteReport(id) {
  await migrateLegacyReports();
  await db.reports.delete(id);
}

export async function getPendingReports() {
  await migrateLegacyReports();
  // Match both modern statuses and legacy statuses
  return db.reports
    .filter((r) =>
      ["pending_cloud_sync", "failed_retryable", "Pending sync"].includes(r.status)
    )
    .toArray();
}

export async function markReportSyncing(id) {
  await migrateLegacyReports();
  await db.reports.update(id, {
    status: "syncing",
    lastSyncAttemptAt: new Date().toISOString(),
  });
}

export async function markReportSynced(id, serverAck = {}) {
  await migrateLegacyReports();
  await db.reports.update(id, {
    status: "synced",
    syncedAt: new Date().toISOString(),
    serverAck,
    retryCount: 0,
  });
}

export async function markReportSyncFailed(id, errorReason) {
  await migrateLegacyReports();
  const existing = await db.reports.get(id);
  if (!existing) return;

  await db.reports.update(id, {
    status: "failed_retryable",
    retryCount: (existing.retryCount || 0) + 1,
    lastSyncAttemptAt: new Date().toISOString(),
    lastSyncError: typeof errorReason === "string" ? errorReason : errorReason?.message || "Sync failed",
  });
}

// Compact manifest for P2P synchronization
export async function getReportManifest() {
  await migrateLegacyReports();
  const all = await db.reports.toArray();
  return all.map((r) => ({
    id: r.id,
    revision: r.revision || 1,
    updatedAt: r.updatedAt || r.createdAt,
  }));
}

// Merge an incoming report from P2P relay or cloud update with conflict resolution
export async function mergeReport(incoming) {
  if (!incoming || !incoming.id) {
    throw new Error("Invalid report payload");
  }

  await migrateLegacyReports();
  const existing = await db.reports.get(incoming.id);

  if (!existing) {
    // New report received from peer relay!
    const relayed = {
      ...incoming,
      relayHops: (incoming.relayHops || 0) + 1,
      // Needs to be uploaded to cloud when this device has internet
      status: incoming.status === "synced" ? "synced" : "pending_cloud_sync",
    };
    await db.reports.put(relayed);
    return { action: "inserted", report: relayed };
  }

  // Conflict resolution: compare revision and timestamp
  const incomingRev = incoming.revision || 1;
  const existingRev = existing.revision || 1;
  const incomingTime = new Date(incoming.updatedAt || incoming.createdAt || 0).getTime();
  const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();

  const isIncomingNewer =
    incomingRev > existingRev || (incomingRev === existingRev && incomingTime > existingTime);

  if (isIncomingNewer) {
    const updated = {
      ...existing,
      ...incoming,
      relayHops: Math.max(existing.relayHops || 0, (incoming.relayHops || 0) + 1),
      status: incoming.status === "synced" ? "synced" : "pending_cloud_sync",
    };
    await db.reports.put(updated);
    return { action: "updated", report: updated };
  }

  return { action: "ignored", report: existing };
}