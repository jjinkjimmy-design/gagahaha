# NexusRDM

Self-hosted Remote Device Management — web panel + Windows agent.  
One Docker container. Deploy anywhere. No platform lock-in.

---

## Architecture

```
[ Any hosting platform ]
  └── One Docker container
        ├── Express API      →  /api/*
        ├── WebSocket hub    →  /ws
        └── React panel      →  /* (static, same-origin)

[ Windows devices ]
  └── nexus-agent-<name>.exe
        └── HTTPS heartbeat every N seconds  →  server
```

TLS is terminated by the platform proxy (Railway, Render, Fly.io, DigitalOcean App Platform).  
Your container runs plain HTTP internally. The agent always connects via `https://`.

---

## Quick Start — Local

```bash
git clone https://github.com/you/nexus-rdm
cd nexus-rdm

cp .env.example .env
# Edit .env — fill in the three secrets (see below)

docker compose up -d
# Panel: http://localhost:4000
```

---

## Deploy to any platform

The project is a single `Dockerfile`. Point any container platform at it.

### Railway
1. New project → Deploy from GitHub → select this repo
2. Add a Postgres database plugin
3. Set env vars (copy from `.env.example`, fill secrets)
4. Deploy → get your URL

### Render
1. New Web Service → connect repo → Runtime: Docker
2. Add a Postgres database
3. Set env vars
4. Deploy → get your URL

### Fly.io
```bash
fly launch     # detects Dockerfile
fly postgres create --name nexusrdm-db
fly secrets set JWT_SECRET=... JWT_REFRESH_SECRET=... ENCRYPTION_KEY=...
fly deploy
```

### DigitalOcean / any VPS
```bash
# On the server:
git clone https://github.com/you/nexus-rdm
cd nexus-rdm
cp .env.example .env && nano .env
docker compose up -d
```

---

## Environment Variables

| Variable              | Description                              | How to generate           |
|-----------------------|------------------------------------------|---------------------------|
| `DATABASE_URL`        | Full Postgres connection string          | Platform provides this    |
| `POSTGRES_PASSWORD`   | DB password (local dev only)             | Any strong password       |
| `JWT_SECRET`          | Access token signing secret              | `openssl rand -hex 64`    |
| `JWT_REFRESH_SECRET`  | Refresh token signing secret             | `openssl rand -hex 64`    |
| `ENCRYPTION_KEY`      | AES-256 key for TOTP secrets at rest     | `openssl rand -hex 32`    |
| `NODE_ENV`            | `production`                             | Set to `production`       |
| `PORT`                | Server port (default: 4000)              | Usually set by platform   |

---

## First-Run Setup

1. Open the panel at your URL
2. Click **"First run? Create admin account"**
3. Fill in name, email, and password (min 12 chars)
4. Sign in
5. Go to **Settings → Security → Enable 2FA** (recommended)

Registration is disabled after the first account is created.

---

## Building the Windows Agent

The agent is compiled locally on your machine — not on the server.  
Each `.exe` is unique: server URL, device key, name, interval, and flags are baked in.

### Prerequisites (on your build machine)
- Python 3.8+ in PATH
- Internet access (pip downloads PyInstaller)

### Steps

1. In the panel: **Devices → Register Device** → copy the API key (shown once)
2. On your build machine:
```
cd agent
build.bat
```
3. Follow the prompts:

```
[1/6] SERVER URL      → https://your-app.up.railway.app
[2/6] DEVICE API KEY  → nrdm_xxxxxxxxxxxx  (input hidden)
[3/6] DEVICE NAME     → johns-laptop
[4/6] INTERVAL        → 30  (seconds, 10-300)
[5/6] PRIVILEGES      → y   (run as admin)
[6/6] WINDOW MODE     → y   (silent background)
```

4. Output: `agent/dist/nexus-agent-johns-laptop.exe`
5. Copy the `.exe` to the target Windows machine and run it
6. The device appears online in the panel within one interval

---

## Security Model

| Layer                  | Implementation                                         |
|------------------------|--------------------------------------------------------|
| Password hashing       | Argon2id — 64 MB memory, 3 iterations, 4 parallelism  |
| Access tokens          | JWT HS256, 15-minute expiry                            |
| Refresh tokens         | Rotated on every use, stored as SHA-256 hash           |
| 2FA                    | TOTP RFC 6238, ±30s window, Google Authenticator       |
| TOTP secrets at rest   | AES-256-GCM encrypted in database                     |
| Device API keys        | SHA-256 hashed, raw key shown once, never stored       |
| Brute force            | Account lock after 5 failures (30 min cooldown)        |
| Rate limiting          | Login: 10/15min · TOTP: 5/5min · API: 120/min         |
| Audit log              | Every action: user, device, IP, timestamp              |
| TLS                    | Platform proxy (auto cert) → plain HTTP in container   |
| Headers                | Helmet.js: CSP, HSTS, X-Frame-Options, etc.            |
| CORS                   | Not needed — same-origin architecture                  |

---

## Project Structure

```
nexus-rdm/
├── Dockerfile                   ← multi-stage: builds React → serves from Express
├── docker-compose.yml           ← local dev only
├── .env.example                 ← all variables documented
│
├── docker/
│   └── init.sql                 ← full Postgres schema
│
├── server/                      ← Express backend
│   └── src/
│       ├── index.js             ← API + static + WebSocket
│       ├── config/db.js
│       ├── utils/auth.js        ← Argon2, JWT, TOTP, AES-GCM
│       ├── middleware/
│       │   ├── auth.js          ← JWT guard, RBAC, device key auth
│       │   ├── rateLimiter.js
│       │   └── audit.js
│       └── routes/
│           ├── auth.js          ← login, register, 2FA, refresh, logout
│           └── devices.js       ← CRUD, heartbeat, stats
│
├── client/                      ← React panel
│   └── src/
│       ├── pages/
│       │   ├── Login.jsx        ← creds + 2FA + first-run register
│       │   └── Dashboard.jsx    ← device grid, stats, add device modal
│       ├── store/auth.js        ← Zustand persisted auth state
│       └── utils/api.js         ← Axios + silent token refresh
│
└── agent/
    ├── agent.py                 ← Windows agent template
    ├── build.bat                ← interactive builder → .exe
    └── requirements.txt
```

---

## Roadmap

- [ ] Web terminal (xterm.js + WebSocket PTY relay)
- [ ] Real-time metrics charts (CPU, RAM, disk via WebSocket push)
- [ ] File browser + transfer
- [ ] Alert rules (offline timeout, high CPU/RAM threshold)
- [ ] Multi-user management (invite, roles)
- [ ] Remote command execution with audit trail
- [ ] Agent auto-update via panel
