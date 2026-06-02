"use strict";
const express = require("express");
const crypto  = require("crypto");
const router  = express.Router();

const { query }                          = require("../config/db");
const { authenticate, requireRole,
        authenticateDevice }             = require("../middleware/auth");
const { generateDeviceKey }             = require("../utils/auth");
const { audit }                         = require("../middleware/audit");
const { deviceLimiter }                 = require("../middleware/rateLimiter");

// ─── GET /api/devices ─────────────────────────────────────────────────────────
router.get("/", authenticate, async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, api_key_prefix, tags, os, hostname, ip_address,
            status, last_seen, heartbeat_interval, metadata, created_at
     FROM devices WHERE owner_id=$1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json({ devices: rows });
});

// ─── GET /api/devices/stats ───────────────────────────────────────────────────
router.get("/stats", authenticate, async (req, res) => {
  const { rows } = await query(
    `SELECT
       COUNT(*)                                    AS total,
       COUNT(*) FILTER (WHERE status='online')     AS online,
       COUNT(*) FILTER (WHERE status='offline')    AS offline,
       COUNT(*) FILTER (WHERE status='warning')    AS warning
     FROM devices WHERE owner_id=$1`,
    [req.user.id]
  );
  res.json(rows[0]);
});

// ─── POST /api/devices ────────────────────────────────────────────────────────
router.post("/", authenticate, requireRole("admin", "operator"), async (req, res) => {
  const { name, tags = [], heartbeat_interval = 30 } = req.body;
  if (!name?.trim())
    return res.status(400).json({ error: "Device name required" });

  const interval = Math.min(300, Math.max(10, parseInt(heartbeat_interval, 10) || 30));
  const rawKey   = generateDeviceKey();
  const keyHash  = crypto.createHash("sha256").update(rawKey).digest("hex");
  const keyPfx   = rawKey.slice(0, 12);

  const { rows } = await query(
    `INSERT INTO devices (name, api_key_hash, api_key_prefix, owner_id, tags, heartbeat_interval)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, name, api_key_prefix, tags, status, heartbeat_interval, created_at`,
    [name.trim(), keyHash, keyPfx, req.user.id, tags, interval]
  );

  await audit({ userId: req.user.id, deviceId: rows[0].id, action: "device.created", req });

  // Return raw key ONCE — never stored plaintext
  res.status(201).json({ device: rows[0], apiKey: rawKey });
});

// ─── GET /api/devices/:id ─────────────────────────────────────────────────────
router.get("/:id", authenticate, async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, api_key_prefix, tags, os, hostname, ip_address,
            status, last_seen, heartbeat_interval, metadata, created_at
     FROM devices WHERE id=$1 AND owner_id=$2`,
    [req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Device not found" });
  res.json({ device: rows[0] });
});

// ─── PATCH /api/devices/:id ───────────────────────────────────────────────────
router.patch("/:id", authenticate, requireRole("admin", "operator"), async (req, res) => {
  const { name, tags, heartbeat_interval } = req.body;
  const { rows } = await query(
    `UPDATE devices SET
       name               = COALESCE($1, name),
       tags               = COALESCE($2, tags),
       heartbeat_interval = COALESCE($3, heartbeat_interval)
     WHERE id=$4 AND owner_id=$5
     RETURNING id, name, tags, heartbeat_interval`,
    [name, tags, heartbeat_interval, req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Device not found" });
  res.json({ device: rows[0] });
});

// ─── DELETE /api/devices/:id ──────────────────────────────────────────────────
router.delete("/:id", authenticate, requireRole("admin"), async (req, res) => {
  const { rowCount } = await query(
    "DELETE FROM devices WHERE id=$1 AND owner_id=$2",
    [req.params.id, req.user.id]
  );
  if (!rowCount) return res.status(404).json({ error: "Device not found" });
  await audit({ userId: req.user.id, deviceId: req.params.id, action: "device.deleted", req });
  res.json({ ok: true });
});

// ─── POST /api/devices/heartbeat  (Windows agent calls this) ─────────────────
router.post("/heartbeat", deviceLimiter, authenticateDevice, async (req, res) => {
  const { os, hostname, ip_address, metadata = {} } = req.body;

  await query(
    `UPDATE devices SET
       status     = 'online',
       last_seen  = NOW(),
       os         = COALESCE($1, os),
       hostname   = COALESCE($2, hostname),
       ip_address = COALESCE($3, ip_address),
       metadata   = metadata || $4::jsonb
     WHERE id=$5`,
    [os, hostname, ip_address, JSON.stringify(metadata), req.device.id]
  );

  res.json({ ok: true, interval: req.device.heartbeat_interval });
});

// ─── GET /api/devices/audit/:id ───────────────────────────────────────────────
router.get("/audit/:id", authenticate, async (req, res) => {
  const { rows } = await query(
    `SELECT action, details, ip_address, created_at
     FROM audit_logs WHERE device_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [req.params.id]
  );
  res.json({ logs: rows });
});

module.exports = router;
