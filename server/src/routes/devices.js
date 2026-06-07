"use strict";
const express  = require("express");
const crypto   = require("crypto");
const { v4: uuidv4 } = require("uuid");
const router   = express.Router();

const db = require("../config/db");
const { authenticate, requireRole, authenticateDevice } = require("../middleware/auth");
const { generateDeviceKey } = require("../utils/auth");
const { audit }             = require("../middleware/audit");
const { deviceLimiter }     = require("../middleware/rateLimiter");

// ─── Background offline detector ─────────────────────────────────────────────
// Runs every 60s. Marks a device offline if last_seen is older than
// (heartbeat_interval * 3) seconds — gives 3 missed beats before offline.
function startOfflineDetector() {
  setInterval(() => {
    try {
      const result = db.prepare(`
        UPDATE devices
        SET status = 'offline', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE status = 'online'
          AND last_seen IS NOT NULL
          AND (
            CAST((julianday('now') - julianday(last_seen)) * 86400 AS INTEGER)
            > (heartbeat_interval * 3)
          )
      `).run();
      if (result.changes > 0)
        console.log(`[offline-detector] marked ${result.changes} device(s) offline`);
    } catch (err) {
      console.error("[offline-detector] error:", err.message);
    }
  }, 60_000);
}
startOfflineDetector();

// ─── GET /api/devices ─────────────────────────────────────────────────────────
router.get("/", authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, api_key_prefix, tags, os, os_version, hostname, username,
           ip_address, arch, cpu_model, cpu_cores, ram_total, ram_used,
           disk_total, disk_used, battery_percent, battery_charging,
           agent_version, status, last_seen, ping_ms, heartbeat_interval,
           metadata, created_at
    FROM devices WHERE owner_id = ? ORDER BY
      CASE status WHEN 'online' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      created_at DESC
  `).all(req.user.id);
  res.json({ devices: rows.map(parseDevice) });
});

// ─── GET /api/devices/stats ───────────────────────────────────────────────────
router.get("/stats", authenticate, (req, res) => {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='online'  THEN 1 ELSE 0 END) AS online,
      SUM(CASE WHEN status='offline' THEN 1 ELSE 0 END) AS offline,
      SUM(CASE WHEN status='warning' THEN 1 ELSE 0 END) AS warning
    FROM devices WHERE owner_id = ?
  `).get(req.user.id);
  res.json(row ?? { total: 0, online: 0, offline: 0, warning: 0 });
});

// ─── POST /api/devices ────────────────────────────────────────────────────────
router.post("/", authenticate, requireRole("admin", "operator"), (req, res) => {
  const { name, tags = [], heartbeat_interval = 30 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Device name required" });

  const interval = Math.min(300, Math.max(10, parseInt(heartbeat_interval, 10) || 30));
  const rawKey   = generateDeviceKey();
  const keyHash  = crypto.createHash("sha256").update(rawKey).digest("hex");
  const keyPfx   = rawKey.slice(0, 12);
  const id       = uuidv4();

  try {
    db.prepare(`
      INSERT INTO devices (id, name, api_key_hash, api_key_prefix, owner_id, tags, heartbeat_interval)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), keyHash, keyPfx, req.user.id, JSON.stringify(tags), interval);

    audit({ userId: req.user.id, deviceId: id, action: "device.created", req });

    const device = db.prepare(
      "SELECT id, name, api_key_prefix, tags, status, heartbeat_interval, created_at FROM devices WHERE id = ?"
    ).get(id);
    res.status(201).json({ device: parseDevice(device), apiKey: rawKey });
  } catch (err) {
    if (err.message?.includes("UNIQUE"))
      return res.status(409).json({ error: "Device name conflict" });
    console.error("[devices/create]", err.message);
    res.status(500).json({ error: "Failed to create device" });
  }
});

// ─── GET /api/devices/:id ─────────────────────────────────────────────────────
router.get("/:id", authenticate, (req, res) => {
  const device = db.prepare(`
    SELECT id, name, api_key_prefix, tags, os, os_version, hostname, username,
           ip_address, arch, cpu_model, cpu_cores, ram_total, ram_used,
           disk_total, disk_used, battery_percent, battery_charging,
           agent_version, status, last_seen, ping_ms, heartbeat_interval,
           metadata, created_at
    FROM devices WHERE id = ? AND owner_id = ?
  `).get(req.params.id, req.user.id);
  if (!device) return res.status(404).json({ error: "Device not found" });
  res.json({ device: parseDevice(device) });
});

// ─── PATCH /api/devices/:id ───────────────────────────────────────────────────
router.patch("/:id", authenticate, requireRole("admin", "operator"), (req, res) => {
  const { name, tags, heartbeat_interval } = req.body;
  const existing = db.prepare("SELECT * FROM devices WHERE id = ? AND owner_id = ?")
    .get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: "Device not found" });

  db.prepare(`
    UPDATE devices SET
      name               = ?,
      tags               = ?,
      heartbeat_interval = ?,
      updated_at         = strftime('%Y-%m-%dT%H:%M:%SZ','now')
    WHERE id = ? AND owner_id = ?
  `).run(
    name ?? existing.name,
    tags !== undefined ? JSON.stringify(tags) : existing.tags,
    heartbeat_interval ?? existing.heartbeat_interval,
    req.params.id, req.user.id
  );

  const device = db.prepare("SELECT * FROM devices WHERE id = ?").get(req.params.id);
  res.json({ device: parseDevice(device) });
});

// ─── DELETE /api/devices/:id ──────────────────────────────────────────────────
router.delete("/:id", authenticate, requireRole("admin"), (req, res) => {
  const result = db.prepare("DELETE FROM devices WHERE id = ? AND owner_id = ?")
    .run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: "Device not found" });
  audit({ userId: req.user.id, deviceId: req.params.id, action: "device.deleted", req });
  res.json({ ok: true });
});

// ─── POST /api/devices/heartbeat ─────────────────────────────────────────────
router.post("/heartbeat", deviceLimiter, authenticateDevice, (req, res) => {
  const b = req.body ?? {};

  const str  = (v) => (v != null && v !== "" ? String(v).slice(0, 512)        : null);
  const int  = (v) => (v != null && !isNaN(Number(v)) ? Math.round(Number(v)) : null);
  const bool = (v) => (v != null ? (v === true || v === "true" || v === 1 ? 1 : 0) : null);

  let merged = "{}";
  try {
    const existing = db.prepare("SELECT metadata FROM devices WHERE id = ?").get(req.device.id);
    const prev     = JSON.parse(existing?.metadata || "{}");
    const incoming = (typeof b.metadata === "object" && b.metadata !== null) ? b.metadata : {};
    merged = JSON.stringify({ ...prev, ...incoming });
  } catch { merged = "{}"; }

  try {
    db.prepare(`
      UPDATE devices SET
        status           = 'online',
        last_seen        = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
        updated_at       = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
        os               = COALESCE(?, os),
        os_version       = COALESCE(?, os_version),
        hostname         = COALESCE(?, hostname),
        username         = COALESCE(?, username),
        ip_address       = COALESCE(?, ip_address),
        arch             = COALESCE(?, arch),
        cpu_model        = COALESCE(?, cpu_model),
        cpu_cores        = COALESCE(?, cpu_cores),
        ram_total        = COALESCE(?, ram_total),
        ram_used         = ?,
        disk_total       = COALESCE(?, disk_total),
        disk_used        = ?,
        battery_percent  = ?,
        battery_charging = ?,
        agent_version    = COALESCE(?, agent_version),
        ping_ms          = COALESCE(?, ping_ms),
        metadata         = ?
      WHERE id = ?
    `).run(
      str(b.os),            str(b.os_version),   str(b.hostname),  str(b.username),
      str(b.ip_address),    str(b.arch),          str(b.cpu_model), int(b.cpu_cores),
      int(b.ram_total),     int(b.ram_used),
      int(b.disk_total),    int(b.disk_used),
      int(b.battery_percent), bool(b.battery_charging),
      str(b.agent_version), int(b.ping_ms),
      merged, req.device.id
    );
  } catch (err) {
    console.error("[heartbeat] db error:", err.message);
    return res.status(500).json({ error: "Heartbeat failed" });
  }

  res.json({ ok: true, interval: req.device.heartbeat_interval });
});

// ─── GET /api/devices/audit/:id ───────────────────────────────────────────────
router.get("/audit/:id", authenticate, (req, res) => {
  const logs = db.prepare(`
    SELECT action, details, ip_address, created_at
    FROM audit_logs WHERE device_id = ? ORDER BY created_at DESC LIMIT 100
  `).all(req.params.id);
  res.json({ logs: logs.map(l => ({ ...l, details: JSON.parse(l.details || "{}") })) });
});

// ─── Helper ───────────────────────────────────────────────────────────────────
function parseDevice(d) {
  if (!d) return d;
  return {
    ...d,
    tags:             JSON.parse(d.tags     || "[]"),
    metadata:         JSON.parse(d.metadata || "{}"),
    battery_charging: d.battery_charging === 1 || d.battery_charging === true,
  };
}

module.exports = router;
