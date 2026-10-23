import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, "../data/db.json");

// Clean database before tests
if (fs.existsSync(DB_FILE)) {
  fs.unlinkSync(DB_FILE);
}

process.env.PORT = "4001";
process.env.NODE_ENV = "test";

const { app } = await import("../server.js");
let server;
let baseUrl;

before(() => {
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(4001, () => {
      baseUrl = "http://localhost:4001";
      resolve();
    });
  });
});

after(() => {
  return new Promise((resolve) => {
    if (server) {
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
      server.close(() => {
        if (fs.existsSync(DB_FILE)) {
          fs.unlinkSync(DB_FILE);
        }
        resolve();
      });
    } else {
      resolve();
    }
  });
});

describe("ResQNet Backend API Test Suite", () => {
  let rescuerToken = "";

  test("GET /api/health should return 200 OK with service details", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, "ok");
    assert.strictEqual(body.service, "ResQNet Emergency Ingestion API");
  });

  test("POST /api/reports with missing ID should return 400 Bad Request", async () => {
    const res = await fetch(`${baseUrl}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "Medical" }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  });

  test("POST /api/reports should ingest a new emergency report (201 Created)", async () => {
    const report = {
      id: "RQ-TEST-001",
      type: "Trapped",
      severity: "Critical",
      people: 2,
      description: "People trapped in basement after seismic tremor",
      latitude: 28.6139,
      longitude: 77.209,
      accuracy: 12,
      createdAt: new Date().toISOString(),
      revision: 1,
      relayHops: 0,
    };

    const res = await fetch(`${baseUrl}/api/reports`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "RQ-TEST-001-r1",
      },
      body: JSON.stringify(report),
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.action, "created");
    assert.strictEqual(body.reportId, "RQ-TEST-001");
  });

  test("POST /api/reports duplicate report should be deduplicated (200 OK)", async () => {
    const report = {
      id: "RQ-TEST-001",
      type: "Trapped",
      severity: "Critical",
      revision: 1,
    };

    const res = await fetch(`${baseUrl}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.action, "deduplicated");
  });

  test("POST /api/reports with higher revision should update the record (200 OK)", async () => {
    const updatedReport = {
      id: "RQ-TEST-001",
      type: "Trapped",
      severity: "Critical",
      description: "Updated: 1 person extracted, 1 still trapped",
      revision: 2,
      latitude: 28.614,
      longitude: 77.2092,
      accuracy: 8,
      updatedAt: new Date().toISOString(),
    };

    const res = await fetch(`${baseUrl}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedReport),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.action, "updated");
    assert.strictEqual(body.serverRevision, 2);
  });

  test("GET /api/reports without rescuer credentials should return 401 Unauthorized", async () => {
    const res = await fetch(`${baseUrl}/api/reports`);
    assert.strictEqual(res.status, 401);
  });

  test("POST /api/auth/login with valid credentials should return session token", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "commander",
        password: "resqnet2026",
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.token);
    assert.strictEqual(body.rescuer.badgeNumber, "RN-901");
    rescuerToken = body.token;
  });

  test("GET /api/reports with rescuer token should list reports with filters", async () => {
    const res = await fetch(`${baseUrl}/api/reports?type=Trapped`, {
      headers: { Authorization: `Bearer ${rescuerToken}` },
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.total, 1);
    assert.strictEqual(body.reports[0].id, "RQ-TEST-001");
    assert.strictEqual(body.reports[0].description, "Updated: 1 person extracted, 1 still trapped");
  });

  test("PATCH /api/reports/:id/triage should update triage status", async () => {
    const res = await fetch(`${baseUrl}/api/reports/RQ-TEST-001/triage`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rescuerToken}`,
      },
      body: JSON.stringify({
        triageStatus: "dispatched",
        triageNotes: "Team Beta dispatched with rescue equipment",
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.report.triageStatus, "dispatched");
    assert.strictEqual(body.report.triageNotes, "Team Beta dispatched with rescue equipment");
    assert.ok(body.report.triageUpdatedBy.includes("RN-901"));
  });

  test("P2P signaling endpoints should store and retrieve offer/answer", async () => {
    // 1. Post offer
    const postOffer = await fetch(`${baseUrl}/api/p2p/signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: "ROOM-99",
        type: "offer",
        sdp: "v=0\r\ntest-sdp-offer",
      }),
    });
    assert.strictEqual(postOffer.status, 200);

    // 2. Fetch offer
    const getOffer = await fetch(`${baseUrl}/api/p2p/signal/ROOM-99?type=offer`);
    assert.strictEqual(getOffer.status, 200);
    const offerData = await getOffer.json();
    assert.strictEqual(offerData.sdp, "v=0\r\ntest-sdp-offer");
  });

  test("P2P beacon and nearby peers discovery should register and list active devices", async () => {
    // 1. Post beacon from Device Alpha with pending emergency report
    const mockReport = {
      id: "RQ-TEST-BEACON-1",
      type: "Trapped",
      contactName: "Rahul Sharma",
      people: 2,
    };
    const postBeacon = await fetch(`${baseUrl}/api/p2p/beacon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "dev-alpha-123",
        name: "Victim Rahul",
        pendingCount: 1,
        pendingReports: [mockReport],
      }),
    });
    assert.strictEqual(postBeacon.status, 200);

    // 2. Fetch nearby peers from Device Beta
    const getPeers = await fetch(`${baseUrl}/api/p2p/peers?excludeId=dev-beta-456`);
    assert.strictEqual(getPeers.status, 200);
    const peersData = await getPeers.json();
    assert.ok(Array.isArray(peersData.peers));
    const alpha = peersData.peers.find((p) => p.deviceId === "dev-alpha-123");
    assert.ok(alpha);
    assert.strictEqual(alpha.name, "Victim Rahul");
    assert.strictEqual(alpha.pendingCount, 1);
    assert.strictEqual(alpha.pendingReports.length, 1);
    assert.strictEqual(alpha.pendingReports[0].id, "RQ-TEST-BEACON-1");
  });
});
