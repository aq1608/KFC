# syntax=docker/dockerfile:1

# ---- Build stage: install dependencies (incl. native better-sqlite3) ----
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Toolchain needed to compile better-sqlite3 if no prebuilt binary is available.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install production dependencies against a cached layer (reproducible via lockfile).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Runtime stage: slim image with just the app + node_modules ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# Copy installed modules and application source.
COPY --from=build /app/node_modules ./node_modules
COPY . .

# Persist SQLite databases (kfc.db, sessions.db) outside the image layer.
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME ["/app/data"]

USER node
EXPOSE 3000

# Container is healthy once /healthz responds 2xx.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
