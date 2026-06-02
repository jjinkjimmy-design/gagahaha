"use strict";
const argon2     = require("argon2");
const jwt        = require("jsonwebtoken");
const crypto     = require("crypto");
const { authenticator } = require("otplib");
const QRCode     = require("qrcode");

// ─── Argon2id ─────────────────────────────────────────────────────────────────
const ARGON_OPTS = {
  type:        argon2.argon2id,
  memoryCost:  65536,   // 64 MB
  timeCost:    3,
  parallelism: 4,
};
const hashPassword   = (pw)       => argon2.hash(pw, ARGON_OPTS);
const verifyPassword = (hash, pw) => argon2.verify(hash, pw);

// ─── JWT ──────────────────────────────────────────────────────────────────────
const ACCESS_TTL         = "15m";
const REFRESH_TTL        = "7d";
const REFRESH_TTL_MS     = 7 * 24 * 60 * 60 * 1000;

const signAccess   = (payload) => jwt.sign(payload, process.env.JWT_SECRET,         { expiresIn: ACCESS_TTL,  algorithm: "HS256" });
const signRefresh  = (payload) => jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL, algorithm: "HS256" });
const verifyAccess = (token)   => jwt.verify(token, process.env.JWT_SECRET);
const verifyRefresh= (token)   => jwt.verify(token, process.env.JWT_REFRESH_SECRET);

const generateRefreshRaw = () => crypto.randomBytes(64).toString("hex");
const hashToken          = (t) => crypto.createHash("sha256").update(t).digest("hex");

// ─── TOTP ─────────────────────────────────────────────────────────────────────
authenticator.options = { window: 1 };

const generateTotpSecret = ()               => authenticator.generateSecret(32);
const verifyTotp         = (code, secret)   => { try { return authenticator.verify({ token: code, secret }); } catch { return false; } };
const totpUri            = (email, secret)  => authenticator.keyuri(email, process.env.TOTP_ISSUER || "NexusRDM", secret);
const totpQR             = (uri)            => QRCode.toDataURL(uri);

// ─── AES-256-GCM (TOTP secret encryption at rest) ────────────────────────────
const ALGO = "aes-256-gcm";

const encryptSecret = (plain) => {
  const key = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
  const iv  = crypto.randomBytes(12);
  const c   = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
};

const decryptSecret = (cipher) => {
  const key          = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
  const [ivH, tagH, encH] = cipher.split(":");
  const d = crypto.createDecipheriv(ALGO, key, Buffer.from(ivH, "hex"));
  d.setAuthTag(Buffer.from(tagH, "hex"));
  return d.update(Buffer.from(encH, "hex")) + d.final("utf8");
};

// ─── Device API key ───────────────────────────────────────────────────────────
const generateDeviceKey = () => `nrdm_${crypto.randomBytes(32).toString("hex")}`;

module.exports = {
  hashPassword, verifyPassword,
  signAccess, signRefresh, verifyAccess, verifyRefresh,
  generateRefreshRaw, hashToken, REFRESH_TTL_MS,
  generateTotpSecret, verifyTotp, totpUri, totpQR,
  encryptSecret, decryptSecret,
  generateDeviceKey,
};
