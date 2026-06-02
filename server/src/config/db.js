"use strict";
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }   // required by most hosted Postgres (Railway, Render, Supabase)
    : false,
});

pool.on("error", (err) => {
  console.error("[db] unexpected pool error:", err.message);
});

const query = async (text, params) => {
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error("[db] query error:", err.message, "| sql:", text.slice(0, 100));
    throw err;
  }
};

module.exports = { query, pool };
