"use strict";
const crypto     = require("crypto");
const { verifyAccess } = require("../utils/auth");
const { query }        = require("../config/db");

// ─── JWT access token guard ───────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Bearer "))
      return res.status(401).json({ error: "No token provided" });

    const payload = verifyAccess(header.slice(7));

    const { rows } = await query(
      "SELECT id, email, name, role, totp_enabled FROM users WHERE id = $1",
      [payload.sub]
    );
    if (!rows.length) return res.status(401).json({ error: "User not found" });

    req.user = rows[0];
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError")
      return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
    return res.status(401).json({ error: "Invalid token" });
  }
};

// ─── Role-based access control ────────────────────────────────────────────────
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (!roles.includes(req.user.role))
    return res.status(403).json({ error: "Insufficient permissions" });
  next();
};

// ─── Device API key guard (used by Windows agent) ─────────────────────────────
const authenticateDevice = async (req, res, next) => {
  try {
    const key = req.headers["x-device-key"] ?? "";
    if (!key) return res.status(401).json({ error: "No device key" });

    const keyHash = crypto.createHash("sha256").update(key).digest("hex");
    const { rows } = await query(
      "SELECT id, name, owner_id, heartbeat_interval FROM devices WHERE api_key_hash = $1",
      [keyHash]
    );
    if (!rows.length) return res.status(401).json({ error: "Invalid device key" });

    req.device = rows[0];
    next();
  } catch {
    return res.status(500).json({ error: "Auth error" });
  }
};

module.exports = { authenticate, requireRole, authenticateDevice };
