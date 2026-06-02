"use strict";
const rateLimit = require("express-rate-limit");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many login attempts. Try again in 15 minutes." },
  keyGenerator: (req) => `${req.ip}:${req.body?.email ?? ""}`,
  standardHeaders: true, legacyHeaders: false,
});

const totpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  message: { error: "Too many 2FA attempts. Try again in 5 minutes." },
  standardHeaders: true, legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: "Rate limit exceeded." },
  standardHeaders: true, legacyHeaders: false,
});

const deviceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "Device rate limit exceeded." },
  keyGenerator: (req) => req.headers["x-device-key"] ?? req.ip,
  standardHeaders: true, legacyHeaders: false,
});

module.exports = { loginLimiter, totpLimiter, apiLimiter, deviceLimiter };
