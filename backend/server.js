import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(__dirname, "../frontend/dist");

const app = express();
const PORT = process.env.PORT || 4000;

// Security and standard middlewares
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// Security headers
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

// Privacy-conscious request audit logger (no PII in logs)
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[AUDIT] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Simple in-memory session token store for Rescuers
const activeSessions = new Map();

function rescuerAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : req.query.token;

  if (!token || !activeSessions.has(token)) {
    return res.status(401).json({ error: "Unauthorized: Rescuer access requires valid credentials" });
  }

  req.rescuer = activeSessions.get(token);
  next();
}

// --- Health Endpoints ---
const healthHandler = (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "ResQNet Emergency Ingestion API",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
};
app.get("/health", healthHandler);
app.get("/api/health", healthHandler);

// --- Rescuer Auth Endpoint ---
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  const rescuer = db.getRescuerByUsername(username);
  if (!rescuer || rescuer.passwordHash !== password) {
    return res.status(401).json({ error: "Invalid rescuer credentials" });
  }

  const token = `RQ-SESSION-${crypto.randomBytes(24).toString("hex")}`;
  activeSessions.set(token, {
    id: rescuer.id,
    username: rescuer.username,
    name: rescuer.name,
    role: rescuer.role,
    badgeNumber: rescuer.badgeNumber,
    issuedAt: Date.now(),
  });

  res.status(200).json({
    token,
    rescuer: {
      id: rescuer.id,
      name: rescuer.name,
      role: rescuer.role,
      badgeNumber: rescuer.badgeNumber,
    },
  });
});

// --- Report Ingestion Endpoints (Public emergency reporting) ---
const reportIngestionHandler = (req, res) => {
  const report = req.body;
  if (!report || !report.id || typeof report.id !== "string") {
    return res.status(400).json({ error: "Invalid emergency report: unique 'id' string required" });
  }

  // Idempotent upsert & deduplication
  const result = db.upsertReport(report);
  const status = result.action === "created" ? 201 : 200;

  return res.status(status).json({
    success: true,
    action: result.action,
    reportId: result.report.id,
    serverRevision: result.report.serverRevision,
    cloudReceivedAt: result.report.cloudReceivedAt,
    cloudUpdatedAt: result.report.cloudUpdatedAt,
  });
};

app.post("/reports", reportIngestionHandler);
app.post("/api/reports", reportIngestionHandler);

// Batch Ingestion for store-and-forward relay carriers
app.post("/api/reports/batch", (req, res) => {
  const { reports } = req.body || {};
  if (!Array.isArray(reports)) {
    return res.status(400).json({ error: "Expected 'reports' array in body" });
  }

  const results = reports.map((r) => {
    if (!r || !r.id) return { error: "Missing ID" };
    return db.upsertReport(r);
  });

  return res.status(200).json({
    success: true,
    processed: results.length,
    results,
  });
});

// --- Rescuer Endpoints (Authorized only) ---
const rescuerReportsHandler = (req, res) => {
  const reportsData = db.getReports(req.query);
  res.status(200).json(reportsData);
};

app.get("/reports", rescuerAuth, rescuerReportsHandler);
app.get("/api/reports", rescuerAuth, rescuerReportsHandler);

app.get("/api/reports/:id", rescuerAuth, (req, res) => {
  const report = db.getReportById(req.params.id);
  if (!report) return res.status(404).json({ error: "Report not found" });
  res.status(200).json(report);
});

// Triage update
app.patch("/api/reports/:id/triage", rescuerAuth, (req, res) => {
  const { triageStatus, triageNotes } = req.body || {};
  const validStatuses = ["new", "acknowledged", "dispatched", "rescued", "closed"];

  if (triageStatus && !validStatuses.includes(triageStatus.toLowerCase())) {
    return res.status(400).json({
      error: `Invalid triage status. Must be one of: ${validStatuses.join(", ")}`,
    });
  }

  const updated = db.updateTriage(req.params.id, {
    triageStatus: triageStatus?.toLowerCase(),
    triageNotes,
    updatedBy: `${req.rescuer.name} (${req.rescuer.badgeNumber})`,
  });

  if (!updated) {
    return res.status(404).json({ error: "Report not found" });
  }

  res.status(200).json({ success: true, report: updated });
});

// --- WebRTC P2P Signaling Endpoints (For local / network room pairing) ---
app.post(["/p2p/signal", "/api/p2p/signal"], (req, res) => {
  const { roomId, type, sdp } = req.body || {};
  if (!roomId || !type || !sdp) {
    return res.status(400).json({ error: "roomId, type, and sdp required" });
  }
  db.setSignal(roomId, type, sdp);
  res.status(200).json({ success: true });
});

app.get(["/p2p/signal/:roomId", "/api/p2p/signal/:roomId"], (req, res) => {
  const { roomId } = req.params;
  const { type = "offer" } = req.query;
  const signal = db.getSignal(roomId, type);

  if (!signal) {
    return res.status(404).json({ error: `No signal for room ${roomId} of type ${type}` });
  }
  res.status(200).json(signal);
});

// Serve frontend static assets in production if built
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get("*", (req, res, next) => {
    // Pass API, health, and signaling routes through if unmatched
    if (
      req.path.startsWith("/api") ||
      req.path.startsWith("/health") ||
      req.path.startsWith("/p2p")
    ) {
      return next();
    }
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

// Export app for testing and start server if run directly
export { app };

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`ResQNet Backend running on http://localhost:${PORT}`);
  });
}
