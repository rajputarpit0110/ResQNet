import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readData() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = {
        reports: [],
        rescuers: [
          {
            id: "rescuer-default",
            username: "rescuer",
            passwordHash: "resqnet2026", // Universal default rescuer
            name: "Authorized Rescuer",
            role: "lead_rescuer",
            badgeNumber: "RN-100",
          },
          {
            id: "rescuer-1",
            username: "commander",
            passwordHash: "resqnet2026", // Default demo credentials
            name: "Commander Sarah Chen",
            role: "lead_rescuer",
            badgeNumber: "RN-901",
          },
          {
            id: "rescuer-2",
            username: "medic",
            passwordHash: "medic123",
            name: "Dr. Marcus Vance",
            role: "paramedic",
            badgeNumber: "MED-412",
          },
        ],
        auditLogs: [],
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }
    const content = fs.readFileSync(DB_FILE, "utf8");
    return JSON.parse(content);
  } catch (err) {
    console.error("Error reading database:", err);
    return { reports: [], rescuers: [], auditLogs: [] };
  }
}

function writeData(data) {
  try {
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error("Error writing database:", err);
    throw err;
  }
}

// In-memory signaling cache for P2P pairing
const signalingRooms = new Map();

export const db = {
  getReports(query = {}) {
    const data = readData();
    let results = [...data.reports];

    // Filter by type
    if (query.type) {
      results = results.filter((r) => r.type?.toLowerCase() === query.type.toLowerCase());
    }

    // Filter by severity
    if (query.severity) {
      results = results.filter(
        (r) => r.severity?.toLowerCase() === query.severity.toLowerCase()
      );
    }

    // Filter by triageStatus
    if (query.triageStatus) {
      results = results.filter(
        (r) => (r.triageStatus || "new").toLowerCase() === query.triageStatus.toLowerCase()
      );
    }

    // Filter by GPS presence
    if (query.hasLocation === "true") {
      results = results.filter((r) => r.latitude != null && r.longitude != null);
    } else if (query.hasLocation === "false") {
      results = results.filter((r) => r.latitude == null || r.longitude == null);
    }

    // Search query
    if (query.search) {
      const q = query.search.toLowerCase();
      results = results.filter(
        (r) =>
          r.id?.toLowerCase().includes(q) ||
          r.description?.toLowerCase().includes(q) ||
          r.type?.toLowerCase().includes(q)
      );
    }

    // Sort: default newest first
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Optional priority sort (Critical > High > Medium > Low)
    if (query.sortBy === "urgency") {
      const severityScore = { Critical: 4, High: 3, Medium: 2, Low: 1, Unassessed: 0 };
      results.sort((a, b) => {
        const scoreDiff = (severityScore[b.severity] || 0) - (severityScore[a.severity] || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    }

    const total = results.length;
    const page = Math.max(1, parseInt(query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || "50", 10)));
    const paginated = results.slice((page - 1) * limit, page * limit);

    return {
      reports: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  getReportById(id) {
    const data = readData();
    return data.reports.find((r) => r.id === id) || null;
  },

  upsertReport(incomingReport) {
    const data = readData();
    const existingIndex = data.reports.findIndex((r) => r.id === incomingReport.id);
    const now = new Date().toISOString();

    if (existingIndex === -1) {
      // New report creation
      const record = {
        ...incomingReport,
        triageStatus: incomingReport.triageStatus || "new",
        cloudReceivedAt: now,
        serverRevision: 1,
      };
      data.reports.unshift(record);
      data.auditLogs.push({
        action: "report_ingested",
        reportId: record.id,
        timestamp: now,
      });
      writeData(data);
      return { action: "created", report: record };
    }

    // Existing report deduplication and conflict resolution
    const existing = data.reports[existingIndex];
    const incomingRev = incomingReport.revision || 1;
    const existingRev = existing.revision || 1;
    const incomingTime = new Date(incomingReport.updatedAt || incomingReport.createdAt || 0).getTime();
    const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();

    const isNewer =
      incomingRev > existingRev || (incomingRev === existingRev && incomingTime > existingTime);

    if (isNewer) {
      const updated = {
        ...existing,
        ...incomingReport,
        triageStatus: existing.triageStatus || "new", // preserve existing triage notes
        triageNotes: existing.triageNotes,
        triageUpdatedAt: existing.triageUpdatedAt,
        triageUpdatedBy: existing.triageUpdatedBy,
        cloudReceivedAt: existing.cloudReceivedAt,
        cloudUpdatedAt: now,
        serverRevision: (existing.serverRevision || 1) + 1,
      };
      data.reports[existingIndex] = updated;
      data.auditLogs.push({
        action: "report_updated",
        reportId: updated.id,
        timestamp: now,
      });
      writeData(data);
      return { action: "updated", report: updated };
    }

    // Deduplicated - already have this or newer revision
    return { action: "deduplicated", report: existing };
  },

  updateTriage(id, { triageStatus, triageNotes, updatedBy }) {
    const data = readData();
    const index = data.reports.findIndex((r) => r.id === id);
    if (index === -1) return null;

    const now = new Date().toISOString();
    const existing = data.reports[index];

    existing.triageStatus = triageStatus || existing.triageStatus;
    if (triageNotes !== undefined) existing.triageNotes = triageNotes;
    existing.triageUpdatedAt = now;
    existing.triageUpdatedBy = updatedBy || "Authorized Rescuer";

    data.auditLogs.push({
      action: "triage_updated",
      reportId: id,
      triageStatus: existing.triageStatus,
      updatedBy: existing.triageUpdatedBy,
      timestamp: now,
    });

    writeData(data);
    return existing;
  },

  getRescuerByUsername(username) {
    const data = readData();
    return data.rescuers.find((r) => r.username.toLowerCase() === username.toLowerCase()) || null;
  },

  createRescuer({ username, passwordHash, name, role }) {
    const data = readData();
    const cleanUsername = String(username).trim();
    const cleanName = name || cleanUsername.charAt(0).toUpperCase() + cleanUsername.slice(1);
    const badgeNumber = `RN-${Math.floor(100 + Math.random() * 900)}`;

    const newRescuer = {
      id: `rescuer-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      username: cleanUsername,
      passwordHash: passwordHash || "resqnet2026",
      name: cleanName.toLowerCase().includes("rescuer") ? cleanName : `Rescuer ${cleanName}`,
      role: role || "field_rescuer",
      badgeNumber,
      createdAt: new Date().toISOString(),
    };

    data.rescuers = data.rescuers || [];
    data.rescuers.push(newRescuer);
    writeData(data);
    return newRescuer;
  },

  // In-memory P2P signaling helper
  setSignal(roomId, type, sdp) {
    if (!signalingRooms.has(roomId)) {
      signalingRooms.set(roomId, {});
    }
    const room = signalingRooms.get(roomId);
    room[type] = { sdp, timestamp: Date.now() };

    // Clean old rooms after 5 minutes
    const cleanupTimer = setTimeout(() => {
      if (signalingRooms.has(roomId)) {
        const r = signalingRooms.get(roomId);
        if (Date.now() - (r[type]?.timestamp || 0) > 300000) {
          signalingRooms.delete(roomId);
        }
      }
    }, 300000);
    if (typeof cleanupTimer.unref === "function") {
      cleanupTimer.unref();
    }
  },

  getSignal(roomId, type) {
    const room = signalingRooms.get(roomId);
    if (!room || !room[type]) return null;
    return room[type];
  },

  // Proximity Mesh Beaconing & Discovery
  registerBeacon({ deviceId, name, pendingCount }) {
    if (!global.resqnetBeacons) {
      global.resqnetBeacons = new Map();
    }
    global.resqnetBeacons.set(deviceId, {
      deviceId,
      name: name || `Device ${deviceId.slice(0, 8)}`,
      pendingCount: Number(pendingCount) || 0,
      lastSeen: Date.now(),
    });
  },

  getNearbyPeers(excludeDeviceId) {
    if (!global.resqnetBeacons) {
      global.resqnetBeacons = new Map();
    }
    const now = Date.now();
    const peers = [];
    for (const [id, beacon] of global.resqnetBeacons.entries()) {
      if (now - beacon.lastSeen > 20000) {
        global.resqnetBeacons.delete(id); // purge stale beacons after 20s
      } else if (id !== excludeDeviceId) {
        peers.push(beacon);
      }
    }
    return peers;
  },
};

