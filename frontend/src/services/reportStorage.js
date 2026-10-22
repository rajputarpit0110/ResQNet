import Dexie from "dexie";

const STORAGE_KEY = "resqnet-reports";
const db = new Dexie("resqnet");

db.version(1).stores({
  reports: "id, createdAt, status",
  metadata: "key",
});

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
      await db.reports.bulkPut(legacyReports);
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

export async function saveReport(report) {
  await migrateLegacyReports();
  await db.reports.add(report);
  return report;
}

export async function deleteReport(id) {
  await migrateLegacyReports();
  await db.reports.delete(id);
}

export async function getPendingReports() {
  await migrateLegacyReports();
  return db.reports.where("status").equals("Pending sync").toArray();
}

export async function markReportSynced(id) {
  await migrateLegacyReports();
  await db.reports.update(id, {
    status: "Synced",
    syncedAt: new Date().toISOString(),
  });
}