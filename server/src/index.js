"use strict";
require("dotenv").config();

const express = require("express");
const http    = require("http");
const path    = require("path");
const helmet  = require("helmet");
const { WebSocketServer } = require("ws");

const { apiLimiter }  = require("./middleware/rateLimiter");
const authRoutes      = require("./routes/auth");
const deviceRoutes    = require("./routes/devices");
const { pool }        = require("./config/db");

const app    = express();
const server = http.createServer(app);

// ─── Trust proxy (Railway/Render/Fly terminate TLS upstream) ─────────────────
app.set("trust proxy", 1);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc:    ["'self'", "https://fonts.gstatic.com"],
        imgSrc:     ["'self'", "data:"],
        connectSrc: ["'self'", "wss:", "ws:"],
      },
    },
    // We're serving the frontend from same origin — no CORS needed
    crossOriginResourcePolicy: { policy: "same-origin" },
  })
);

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) =>
  res.json({ status: "ok", version: "1.0.0", ts: new Date().toISOString() })
);

// ─── API routes ───────────────────────────────────────────────────────────────
app.use("/api",         apiLimiter);
app.use("/api/auth",    authRoutes);
app.use("/api/devices", deviceRoutes);

// ─── Serve React static build (same origin — no CORS needed at all) ──────────
const STATIC = path.join(__dirname, "..", "public");
app.use(express.static(STATIC, { maxAge: "1y", immutable: true }));

// ─── SPA fallback — all non-API routes → index.html ──────────────────────────
app.get("*", (req, res) => {
  if (req.path.startsWith("/api"))
    return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(STATIC, "index.html"), { maxAge: 0 });
});

// ─── WebSocket server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const deviceKey = req.headers["x-device-key"];
  const ip        = req.socket.remoteAddress;
  console.log(`[ws] connection from ${ip} key=${deviceKey ? deviceKey.slice(0, 12) + "…" : "none"}`);

  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      // Future: route messages to registered handlers (shell output, file ops)
      console.log(`[ws] message type=${msg.type} from ${ip}`);
    } catch {
      ws.send(JSON.stringify({ error: "Invalid JSON" }));
    }
  });

  ws.on("close", () => console.log(`[ws] disconnected ${ip}`));
  ws.on("error", (err) => console.error(`[ws] error ${ip}:`, err.message));

  ws.send(JSON.stringify({ type: "connected", ts: Date.now() }));
});

// Ping all clients every 30s to detect dead connections
const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30_000);

wss.on("close", () => clearInterval(pingInterval));

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("[error]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? "4000", 10);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ NexusRDM listening on :${PORT}  [${process.env.NODE_ENV ?? "development"}]`);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const shutdown = (sig) => {
  console.log(`[shutdown] ${sig} received`);
  server.close(() => pool.end(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
