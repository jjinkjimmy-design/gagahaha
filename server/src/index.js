"use strict";
require("dotenv").config();
require("./config/db");

const express = require("express");
const http    = require("http");
const path    = require("path");
const helmet  = require("helmet");
const { WebSocketServer, WebSocket } = require("ws");
const { verifyAccess } = require("./utils/auth");
const db = require("./config/db");

const { apiLimiter } = require("./middleware/rateLimiter");
const authRoutes     = require("./routes/auth");
const deviceRoutes   = require("./routes/devices");

const app    = express();
const server = http.createServer(app);

app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:"],
      connectSrc: ["'self'", "wss:", "ws:"],
      workerSrc:  ["'self'", "blob:"],
    },
  },
  crossOriginResourcePolicy: { policy: "same-origin" },
}));

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

app.get("/api/health", (_req, res) =>
  res.json({ status: "ok", version: "1.0.0", ts: new Date().toISOString() })
);

app.use("/api",         apiLimiter);
app.use("/api/auth",    authRoutes);
app.use("/api/devices", deviceRoutes);

const STATIC = path.join(__dirname, "..", "public");
app.use(express.static(STATIC, { maxAge: "1y", immutable: true }));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(STATIC, "index.html"), { maxAge: 0 });
});

// ─── WebSocket Hub ────────────────────────────────────────────────────────────
// Two types of connections:
//   1. Agent connections: device authenticates with X-Device-Key header
//      ws.role = "agent", ws.deviceId = "uuid"
//   2. Browser connections: browser authenticates with ?token=JWT&deviceId=X
//      ws.role = "browser", ws.deviceId = "uuid", ws.sessionId = "uuid"
//
// Message routing:
//   browser → server → agent  (type: "shell:input", "shell:resize", "shell:open", "shell:close")
//   agent   → server → browser (type: "shell:output", "shell:exit", "shell:ready")

const wss = new WebSocketServer({ server, path: "/ws" });

// Maps for routing
const agentSockets  = new Map(); // deviceId → WebSocket (agent)
const browserSockets = new Map(); // sessionId → WebSocket (browser)
const sessionToDevice = new Map(); // sessionId → deviceId
const sessionToDevice2 = new Map(); // deviceId → Set<sessionId>

const { v4: uuidv4 } = require("uuid");

const crypto = require("crypto");

wss.on("connection", (ws, req) => {
  const url    = new URL(req.url, "http://localhost");
  const params = url.searchParams;

  // ── Agent connection ──────────────────────────────────────────
  const deviceKey = req.headers["x-device-key"];
  if (deviceKey) {
    const keyHash = crypto.createHash("sha256").update(deviceKey).digest("hex");
    const device  = db.prepare("SELECT id, name FROM devices WHERE api_key_hash = ?").get(keyHash);
    if (!device) { ws.close(4001, "Invalid device key"); return; }

    ws.role     = "agent";
    ws.deviceId = device.id;
    ws.isAlive  = true;

    // Replace any existing agent connection for this device
    const old = agentSockets.get(device.id);
    if (old && old.readyState === WebSocket.OPEN) old.close(1000, "Replaced");
    agentSockets.set(device.id, ws);

    console.log(`[ws] agent connected: ${device.name} (${device.id})`);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        // Forward agent messages to the correct browser session
        const { sessionId } = msg;
        if (sessionId) {
          const bws = browserSockets.get(sessionId);
          if (bws && bws.readyState === WebSocket.OPEN) {
            bws.send(JSON.stringify(msg));
          }
        }
      } catch (e) { console.error("[ws/agent] parse error:", e.message); }
    });

    ws.on("close", () => {
      agentSockets.delete(device.id);
      // Notify all browser sessions connected to this device
      const sessions = sessionToDevice2.get(device.id) || new Set();
      sessions.forEach(sid => {
        const bws = browserSockets.get(sid);
        if (bws && bws.readyState === WebSocket.OPEN) {
          bws.send(JSON.stringify({ type: "shell:exit", code: -1, reason: "Agent disconnected" }));
        }
      });
      console.log(`[ws] agent disconnected: ${device.id}`);
    });

    ws.on("pong", () => { ws.isAlive = true; });
    ws.on("error", e => console.error("[ws/agent] error:", e.message));

    ws.send(JSON.stringify({ type: "connected", role: "agent" }));
    return;
  }

  // ── Browser connection ────────────────────────────────────────
  const token    = params.get("token");
  const deviceId = params.get("deviceId");

  if (!token || !deviceId) { ws.close(4002, "Missing token or deviceId"); return; }

  let userPayload;
  try { userPayload = verifyAccess(token); }
  catch { ws.close(4003, "Invalid token"); return; }

  // Verify device belongs to user
  const device = db.prepare(
    "SELECT id, name, hostname, username, os, os_version FROM devices WHERE id = ? AND owner_id = ?"
  ).get(deviceId, userPayload.sub);
  if (!device) { ws.close(4004, "Device not found"); return; }

  const sessionId = uuidv4();
  ws.role      = "browser";
  ws.deviceId  = deviceId;
  ws.sessionId = sessionId;
  ws.isAlive   = true;

  browserSockets.set(sessionId, ws);
  sessionToDevice.set(sessionId, deviceId);
  if (!sessionToDevice2.has(deviceId)) sessionToDevice2.set(deviceId, new Set());
  sessionToDevice2.get(deviceId).add(sessionId);

  console.log(`[ws] browser connected: session=${sessionId} device=${deviceId}`);

  // Send session info to browser
  ws.send(JSON.stringify({
    type: "session:info",
    sessionId,
    device: { id: device.id, name: device.name, hostname: device.hostname,
              username: device.username, os: device.os, os_version: device.os_version },
  }));

  // Check if agent is online
  const agentWs = agentSockets.get(deviceId);
  if (!agentWs || agentWs.readyState !== WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "shell:error", message: "Device is offline or not connected" }));
  }

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      // Forward browser messages to the agent, injecting sessionId
      const agent = agentSockets.get(deviceId);
      if (agent && agent.readyState === WebSocket.OPEN) {
        agent.send(JSON.stringify({ ...msg, sessionId }));
      } else {
        ws.send(JSON.stringify({ type: "shell:error", message: "Device not connected" }));
      }
    } catch (e) { console.error("[ws/browser] parse error:", e.message); }
  });

  ws.on("close", () => {
    browserSockets.delete(sessionId);
    sessionToDevice.delete(sessionId);
    const sessions = sessionToDevice2.get(deviceId);
    if (sessions) { sessions.delete(sessionId); if (!sessions.size) sessionToDevice2.delete(deviceId); }
    // Tell agent to close this shell session
    const agent = agentSockets.get(deviceId);
    if (agent && agent.readyState === WebSocket.OPEN) {
      agent.send(JSON.stringify({ type: "shell:close", sessionId }));
    }
    console.log(`[ws] browser disconnected: session=${sessionId}`);
  });

  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("error", e => console.error("[ws/browser] error:", e.message));
});

// Ping all clients every 30s
const pingInterval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30_000);

wss.on("close", () => clearInterval(pingInterval));

app.use((err, _req, res, _next) => {
  console.error("[error]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = parseInt(process.env.PORT ?? "4000", 10);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ NexusRDM listening on :${PORT}  [${process.env.NODE_ENV ?? "development"}]`);
});

const shutdown = (sig) => {
  console.log(`[shutdown] ${sig}`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
