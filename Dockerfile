# Build timestamp: 2026-06-10 00:57:02 UTC
# ─── Stage 1: Build React client ─────────────────────────────────────────────
FROM node:20-alpine AS client-builder
WORKDIR /build/client
COPY client/package*.json ./
RUN npm install --legacy-peer-deps
COPY client/ ./
RUN npm run build

# ─── Stage 2: Build server (compiles better-sqlite3 native addon) ────────────
FROM node:20-alpine AS server-builder
RUN apk add --no-cache python3 make g++
WORKDIR /build/server
COPY server/package*.json ./
RUN npm install --omit=dev

# ─── Stage 3: Runtime ────────────────────────────────────────────────────────
FROM node:20-alpine
RUN apk add --no-cache libstdc++

WORKDIR /app

COPY server/src           ./src
COPY server/package*.json ./
COPY --from=server-builder /build/server/node_modules ./node_modules
COPY --from=client-builder /build/client/dist         ./public

# Create data dir and set ownership BEFORE switching to non-root user
# SQLite lives at /app/data/nexusrdm.db — inside /app which we own
RUN mkdir -p /app/data \
    && addgroup -S nexus \
    && adduser -S nexus -G nexus \
    && chown -R nexus:nexus /app

USER nexus

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["node", "src/index.js"]
