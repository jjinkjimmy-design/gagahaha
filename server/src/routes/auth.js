"use strict";
const express   = require("express");
const { body, validationResult } = require("express-validator");
const router    = express.Router();

const { query }          = require("../config/db");
const {
  hashPassword, verifyPassword,
  signAccess, signRefresh, verifyAccess, verifyRefresh,
  generateRefreshRaw, hashToken, REFRESH_TTL_MS,
  generateTotpSecret, verifyTotp, totpUri, totpQR,
  encryptSecret, decryptSecret,
} = require("../utils/auth");
const { authenticate }              = require("../middleware/auth");
const { loginLimiter, totpLimiter } = require("../middleware/rateLimiter");
const { audit }                     = require("../middleware/audit");

const MAX_FAILS      = 5;
const LOCKOUT_MS     = 30 * 60 * 1000;

// ─── POST /api/auth/register (first-run only — creates the admin account) ─────
router.post(
  "/register",
  [
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 12 }).withMessage("Min 12 characters"),
    body("name").trim().notEmpty(),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

    try {
      // Allow registration only if no users exist yet
      const { rows: existing } = await query("SELECT id FROM users LIMIT 1");
      if (existing.length)
        return res.status(403).json({ error: "Registration closed. Contact your admin." });

      const { email, password, name } = req.body;
      const hash = await hashPassword(password);
      const { rows } = await query(
        `INSERT INTO users (email, password, name, role)
         VALUES ($1,$2,$3,'admin') RETURNING id, email, name, role`,
        [email, hash, name]
      );
      await audit({ userId: rows[0].id, action: "user.registered", req });
      res.status(201).json({ user: rows[0] });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "Email already in use" });
      console.error("[auth/register]", err.message);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post(
  "/login",
  loginLimiter,
  [
    body("email").isEmail().normalizeEmail(),
    body("password").notEmpty(),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

    const { email, password } = req.body;
    try {
      const { rows } = await query("SELECT * FROM users WHERE email = $1", [email]);
      const user = rows[0];

      // Always run a hash to prevent timing-based user enumeration
      const sentinel = "$argon2id$v=19$m=65536,t=3,p=4$c2VudGluZWw$sentinelhashsentinelhashsentinel";
      const valid    = await verifyPassword(user?.password ?? sentinel, password);

      if (!valid || !user)
        return res.status(401).json({ error: "Invalid credentials" });

      // Lockout check
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        await audit({ userId: user.id, action: "login.blocked_locked", req });
        return res.status(423).json({ error: "Account locked. Try again later." });
      }

      if (!valid) {
        const fails     = (user?.failed_logins ?? 0) + 1;
        const lockUntil = fails >= MAX_FAILS ? new Date(Date.now() + LOCKOUT_MS) : null;
        if (user)
          await query("UPDATE users SET failed_logins=$1,locked_until=$2 WHERE id=$3",
            [fails, lockUntil, user.id]);
        await audit({ userId: user?.id, action: "login.failed", details: { fails }, req });
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Reset failure counter
      await query(
        "UPDATE users SET failed_logins=0,locked_until=NULL,last_login=NOW() WHERE id=$1",
        [user.id]
      );

      // 2FA required?
      if (user.totp_enabled) {
        const tempToken = signAccess({ sub: user.id, type: "2fa_pending" });
        await audit({ userId: user.id, action: "login.2fa_required", req });
        return res.json({ require2fa: true, tempToken });
      }

      const tokens = await issueTokens(user, req);
      await audit({ userId: user.id, action: "login.success", req });
      res.json({ user: safe(user), ...tokens });
    } catch (err) {
      console.error("[auth/login]", err.message);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

// ─── POST /api/auth/2fa/verify ────────────────────────────────────────────────
router.post("/2fa/verify", totpLimiter, async (req, res) => {
  const { tempToken, code } = req.body;
  if (!tempToken || !code)
    return res.status(400).json({ error: "tempToken and code required" });

  try {
    let payload;
    try { payload = verifyAccess(tempToken); }
    catch { return res.status(401).json({ error: "Invalid or expired token" }); }

    if (payload.type !== "2fa_pending")
      return res.status(400).json({ error: "Wrong token type" });

    const { rows } = await query("SELECT * FROM users WHERE id=$1", [payload.sub]);
    const user = rows[0];
    if (!user?.totp_secret) return res.status(401).json({ error: "2FA not configured" });

    const secret = decryptSecret(user.totp_secret);
    if (!verifyTotp(code, secret)) {
      await audit({ userId: user.id, action: "2fa.verify.failed", req });
      return res.status(401).json({ error: "Invalid code" });
    }

    const tokens = await issueTokens(user, req);
    await audit({ userId: user.id, action: "login.success.2fa", req });
    res.json({ user: safe(user), ...tokens });
  } catch (err) {
    console.error("[auth/2fa/verify]", err.message);
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: "No refresh token" });

  try {
    try { verifyRefresh(refreshToken); }
    catch { return res.status(401).json({ error: "Invalid refresh token", code: "REFRESH_INVALID" }); }

    const hash = hashToken(refreshToken);
    const { rows } = await query(
      `SELECT rt.*, u.id uid, u.email, u.name, u.role
       FROM refresh_tokens rt JOIN users u ON u.id=rt.user_id
       WHERE rt.token_hash=$1 AND rt.revoked=FALSE AND rt.expires_at>NOW()`,
      [hash]
    );
    if (!rows.length)
      return res.status(401).json({ error: "Refresh token invalid or expired", code: "REFRESH_INVALID" });

    // Rotate
    await query("UPDATE refresh_tokens SET revoked=TRUE WHERE token_hash=$1", [hash]);
    const tokens = await issueTokens(rows[0], req);
    res.json(tokens);
  } catch (err) {
    console.error("[auth/refresh]", err.message);
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post("/logout", authenticate, async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken)
    await query("UPDATE refresh_tokens SET revoked=TRUE WHERE token_hash=$1",
      [hashToken(refreshToken)]);
  await audit({ userId: req.user.id, action: "logout", req });
  res.json({ ok: true });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get("/me", authenticate, (req, res) => res.json({ user: req.user }));

// ─── GET /api/auth/2fa/setup ──────────────────────────────────────────────────
router.get("/2fa/setup", authenticate, async (req, res) => {
  if (req.user.totp_enabled)
    return res.status(400).json({ error: "2FA already enabled" });

  const secret    = generateTotpSecret();
  const uri       = totpUri(req.user.email, secret);
  const qrCode    = await totpQR(uri);
  const encrypted = encryptSecret(secret);

  await query("UPDATE users SET totp_secret=$1 WHERE id=$2", [encrypted, req.user.id]);
  res.json({ qrCode, manualKey: secret });
});

// ─── POST /api/auth/2fa/enable ────────────────────────────────────────────────
router.post("/2fa/enable", authenticate, totpLimiter, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "code required" });

  const { rows } = await query("SELECT totp_secret FROM users WHERE id=$1", [req.user.id]);
  if (!rows[0]?.totp_secret)
    return res.status(400).json({ error: "Call /2fa/setup first" });

  const secret = decryptSecret(rows[0].totp_secret);
  if (!verifyTotp(code, secret))
    return res.status(400).json({ error: "Invalid code" });

  await query("UPDATE users SET totp_enabled=TRUE WHERE id=$1", [req.user.id]);
  await audit({ userId: req.user.id, action: "2fa.enabled", req });
  res.json({ ok: true });
});

// ─── POST /api/auth/2fa/disable ───────────────────────────────────────────────
router.post("/2fa/disable", authenticate, totpLimiter, async (req, res) => {
  const { code, password } = req.body;
  if (!code || !password)
    return res.status(400).json({ error: "code and password required" });

  const { rows } = await query("SELECT * FROM users WHERE id=$1", [req.user.id]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: "Not found" });

  if (!(await verifyPassword(user.password, password)))
    return res.status(401).json({ error: "Wrong password" });

  if (!verifyTotp(code, decryptSecret(user.totp_secret)))
    return res.status(400).json({ error: "Invalid code" });

  await query("UPDATE users SET totp_enabled=FALSE,totp_secret=NULL WHERE id=$1", [req.user.id]);
  await audit({ userId: req.user.id, action: "2fa.disabled", req });
  res.json({ ok: true });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function issueTokens(user, req) {
  const accessToken  = signAccess({ sub: user.id ?? user.uid, role: user.role, email: user.email });
  const rawRefresh   = generateRefreshRaw();
  const refreshToken = signRefresh({ sub: user.id ?? user.uid });
  const hash         = hashToken(rawRefresh);

  await query(
    `INSERT INTO refresh_tokens (user_id,token_hash,expires_at,user_agent,ip_address)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      user.id ?? user.uid,
      hash,
      new Date(Date.now() + REFRESH_TTL_MS),
      (req?.headers?.["user-agent"] ?? "").slice(0, 256) || null,
      req?.ip ?? null,
    ]
  );

  // Keep only last 5 refresh tokens per user
  await query(
    `DELETE FROM refresh_tokens WHERE user_id=$1 AND id NOT IN (
       SELECT id FROM refresh_tokens WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5
     )`,
    [user.id ?? user.uid]
  );

  return { accessToken, refreshToken: rawRefresh };
}

function safe({ password, totp_secret, failed_logins, locked_until, ...u }) { return u; }

module.exports = router;
