import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import "fake-indexeddb/auto";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mock browser globals for node test environment
global.window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};
global.CustomEvent = class CustomEvent {
  constructor(name, opts) {
    this.name = name;
    this.detail = opts?.detail;
  }
};
try {
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: false },
    configurable: true,
    writable: true,
  });
} catch {}

const {
  db,
  getReports,
  updateReportLocation,
  getReportManifest,
  mergeReport,
  getOrCreateDeviceId,
} = await import("../src/services/reportStorage.js");

const { triggerEmergencySOS } = await import("../src/services/emergencySOS.js");

// Import backend to test end-to-end multi-hop relay upload!
const DB_FILE = path.join(__dirname, "../../backend/data/db.json");
if (fs.existsSync(DB_FILE)) {
  try { fs.unlinkSync(DB_FILE); } catch {}
}
process.env.PORT = "4002";
process.env.NODE_ENV = "test";
const { app: backendApp } = await import("../../backend/server.js");

let backendServer;
let backendUrl;

before(() => {
  return new Promise((resolve) => {
    backendServer = http.createServer(backendApp);
    backendServer.listen(4002, () => {
      backendUrl = "http://localhost:4002";
      resolve();
    });
  });
});

after(() => {
  return new Promise((resolve) => {
    if (backendServer) {
      if (typeof backendServer.closeAllConnections === "function") {
        backendServer.closeAllConnections();
      }
      backendServer.close(() => {
        if (fs.existsSync(DB_FILE)) {
          try { fs.unlinkSync(DB_FILE); } catch {}
        }
        resolve();
      });
    } else {
      resolve();
    }
  });
});

describe("ResQNet Storage, Emergency SOS & Multi-Hop Relay Test Suite", () => {
  test("getOrCreateDeviceId should generate and persist stable pseudonymous device ID", async () => {
    const devId1 = await getOrCreateDeviceId();
    assert.ok(devId1.startsWith("DEV-"));
    const devId2 = await getOrCreateDeviceId();
    assert.strictEqual(devId1, devId2);
  });

  test("Offline SOS report creation should save to IndexedDB immediately without GPS or internet", async () => {
    navigator.onLine = false;

    const report = await triggerEmergencySOS({
      source: "triple_tap",
      existingLocation: null,
    });

    assert.ok(report.id.startsWith("RQ-"));
    assert.strictEqual(report.type, "Emergency SOS");
    assert.strictEqual(report.severity, "Critical");
    assert.strictEqual(report.people, 1);
    assert.strictEqual(report.status, "pending_cloud_sync");
    assert.strictEqual(report.latitude, null);
    assert.strictEqual(report.revision, 1);
    assert.strictEqual(report.relayHops, 0);

    // Verify stored in IndexedDB
    const stored = await db.reports.get(report.id);
    assert.ok(stored);
    assert.strictEqual(stored.id, report.id);
  });

  test("Attaching GPS to an existing report should bump revision without duplicating", async () => {
    const all = await getReports();
    const existing = all[0];
    assert.ok(existing);

    const updated = await updateReportLocation(existing.id, {
      latitude: 28.5355,
      longitude: 77.391,
      accuracy: 9.5,
      capturedAt: new Date().toISOString(),
    });

    assert.strictEqual(updated.id, existing.id);
    assert.strictEqual(updated.latitude, 28.5355);
    assert.strictEqual(updated.revision, 2);

    // Ensure count has not multiplied
    const afterUpdate = await getReports();
    assert.strictEqual(afterUpdate.length, all.length);
  });

  test("getReportManifest should produce compact sync manifest", async () => {
    const manifest = await getReportManifest();
    assert.ok(Array.isArray(manifest));
    assert.ok(manifest.length > 0);
    assert.ok(manifest[0].id);
    assert.ok(manifest[0].revision);
    assert.ok(manifest[0].updatedAt);
  });

  test("P2P mergeReport should handle new report, revision conflict resolution, and stale rejection", async () => {
    // 1. Ingest new report from peer
    const peerReport = {
      id: "RQ-PEER-888",
      type: "Trapped",
      severity: "Critical",
      people: 4,
      description: "Collapsed roof on 2nd floor",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revision: 1,
      relayHops: 0,
    };

    const res1 = await mergeReport(peerReport);
    assert.strictEqual(res1.action, "inserted");
    assert.strictEqual(res1.report.relayHops, 1); // 1 hop relayed

    // 2. Peer updates with revision 2
    const peerReportV2 = {
      ...peerReport,
      description: "Update: 2 people extracted, 2 still trapped",
      revision: 2,
      updatedAt: new Date(Date.now() + 5000).toISOString(),
    };
    const res2 = await mergeReport(peerReportV2);
    assert.strictEqual(res2.action, "updated");
    assert.strictEqual(res2.report.revision, 2);
    assert.strictEqual(res2.report.description, "Update: 2 people extracted, 2 still trapped");

    // 3. Stale revision 1 received from another peer should be ignored
    const staleRes = await mergeReport(peerReport);
    assert.strictEqual(staleRes.action, "ignored");
  });

  test("Multi-Device Store-and-Forward Relay: Device A -> Device B -> Device C -> Cloud Ingestion", async () => {
    // Device A creates emergency SOS offline
    const reportFromA = {
      id: "RQ-VICTIM-ALICE",
      type: "Structural Collapse",
      severity: "Critical",
      people: 3,
      description: "Alice trapped under beam, mobile tower is down",
      latitude: 19.076,
      longitude: 72.8777,
      accuracy: 14,
      createdAt: new Date().toISOString(),
      revision: 1,
      relayHops: 0,
    };

    // Device B receives report from A via P2P
    const bMerged = await mergeReport(reportFromA);
    assert.strictEqual(bMerged.report.relayHops, 1);

    // Device C is a separate physical device receiving from Device B
    await db.reports.delete(reportFromA.id);
    const cMerged = await mergeReport(bMerged.report);
    assert.strictEqual(cMerged.report.relayHops, 2);

    // Device C reaches connectivity and uploads to Cloud Backend
    const cloudRes = await fetch(`${backendUrl}/api/reports`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `${cMerged.report.id}-r${cMerged.report.revision}`,
      },
      body: JSON.stringify(cMerged.report),
    });

    assert.strictEqual(cloudRes.status, 201);
    const cloudBody = await cloudRes.json();
    assert.strictEqual(cloudBody.success, true);
    assert.strictEqual(cloudBody.reportId, "RQ-VICTIM-ALICE");

    // Rescuer logs in and views the relayed report
    const loginRes = await fetch(`${backendUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "commander", password: "resqnet2026" }),
    });
    const { token } = await loginRes.json();

    const rescuerReportsRes = await fetch(`${backendUrl}/api/reports`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const rescuerData = await rescuerReportsRes.json();
    const retrievedAlice = rescuerData.reports.find((r) => r.id === "RQ-VICTIM-ALICE");

    assert.ok(retrievedAlice);
    assert.strictEqual(retrievedAlice.relayHops, 2);
    assert.strictEqual(retrievedAlice.severity, "Critical");
    assert.strictEqual(retrievedAlice.description, "Alice trapped under beam, mobile tower is down");
  });

  test("Triple-Tap Detection: Single tap opens manual form, exactly 3 taps triggers SOS", async () => {
    let triggeredCount = 0;
    let manualFormOpened = false;

    // Simulation of HomeScreen tap logic
    class TapDetector {
      constructor(onSOS, onManual) {
        this.taps = 0;
        this.timer = null;
        this.onSOS = onSOS;
        this.onManual = onManual;
      }

      tap() {
        this.taps += 1;
        if (this.timer) clearTimeout(this.timer);

        if (this.taps === 3) {
          this.taps = 0;
          this.onSOS();
        } else {
          this.timer = setTimeout(() => {
            if (this.taps === 1) {
              this.taps = 0;
              this.onManual();
            } else {
              this.taps = 0;
            }
          }, 50);
        }
      }
    }

    // 1. Single tap test
    const detector1 = new TapDetector(
      () => { triggeredCount += 1; },
      () => { manualFormOpened = true; }
    );
    detector1.tap();
    await new Promise((r) => setTimeout(r, 80));
    assert.strictEqual(triggeredCount, 0, "Single tap should not trigger SOS");
    assert.strictEqual(manualFormOpened, true, "Single tap should navigate to manual report form");

    // 2. Triple tap test
    const detector2 = new TapDetector(
      () => { triggeredCount += 1; },
      () => { manualFormOpened = true; }
    );
    detector2.tap();
    detector2.tap();
    detector2.tap();
    assert.strictEqual(triggeredCount, 1, "Triple tap within window triggers exactly one SOS");
  });
});
