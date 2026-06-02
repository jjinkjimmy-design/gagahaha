# ─── Stage 1: Build React client ────────────────────────────────────────────
FROM node:20-alpine AS client-builder

WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ─── Stage 2: Build server deps ──────────────────────────────────────────────
FROM node:20-alpine AS server-builder

RUN apk add --no-cache python3 make g++
WORKDIR /build/server
COPY server/package*.json ./
RUN npm ci --omit=dev

# ─── Stage 3: Final image ─────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Copy server source
COPY server/src ./src
COPY server/package*.json ./
COPY --from=server-builder /build/server/node_modules ./node_modules

# Copy built React into server's public folder
COPY --from=client-builder /build/client/dist ./public

# Non-root user
RUN addgroup -S nexus && adduser -S nexus -G nexus
USER nexus

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["node", "src/index.js"]
