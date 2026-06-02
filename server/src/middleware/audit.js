"use strict";
const { query } = require("../config/db");

const audit = async ({ userId = null, deviceId = null, action, details = {}, req = null }) => {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, device_id, action, details, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        userId,
        deviceId,
        action,
        JSON.stringify(details),
        req?.ip ?? null,
        (req?.headers?.["user-agent"] ?? "").slice(0, 256) || null,
      ]
    );
  } catch (err) {
    console.error("[audit] failed:", err.message);
  }
};

module.exports = { audit };
