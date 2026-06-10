"use strict";
const crypto = require("crypto");
const db     = require("./db");

/**
 * Ensure JWT secrets exist. If not set via env vars, generate them once
 * and persist them in the SQLite database so they survive restarts.
 * This means the server works out-of-the-box without manual secret setup,
 * while still respecting explicitly set env vars.
 */
function ensureSecrets() {
  // If all secrets are set via env, nothing to do
  if (process.env.JWT_SECRET && process.env.JWT_REFRESH_SECRET && process.env.ENCRYPTION_KEY) {
    console.log("[secrets] using environment-provided secrets");
    return;
  }

  // Ensure a secrets table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_secrets (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const getOrCreate = (envKey, dbKey, length = 64) => {
    if (process.env[envKey]) return process.env[envKey];
    let row = db.prepare("SELECT value FROM app_secrets WHERE key = ?").get(dbKey);
    if (!row) {
      const val = crypto.randomBytes(length).toString("hex");
      db.prepare("INSERT INTO app_secrets (key, value) VALUES (?, ?)").run(dbKey, val);
      row = { value: val };
      console.log(`[secrets] generated ${dbKey} (persisted to DB)`);
    }
    return row.value;
  };

  process.env.JWT_SECRET          = getOrCreate("JWT_SECRET",          "jwt_secret",          64);
  process.env.JWT_REFRESH_SECRET  = getOrCreate("JWT_REFRESH_SECRET",  "jwt_refresh_secret",  64);
  process.env.ENCRYPTION_KEY      = getOrCreate("ENCRYPTION_KEY",      "encryption_key",      32);

  console.log("[secrets] secrets ready");
}

module.exports = { ensureSecrets };
