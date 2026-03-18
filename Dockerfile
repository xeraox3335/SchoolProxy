# ─── Build stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ─── Runtime stage ───────────────────────────────────────────────────────────
FROM node:20-alpine

# Add dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy production dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY server.js ./
COPY src/ ./src/

# Non-root user for security
RUN addgroup -S proxy && adduser -S proxy -G proxy
USER proxy

# The port is configurable via the PORT env var (defaults to 3000)
ENV PORT=3000
EXPOSE $PORT

# Graceful shutdown via dumb-init
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
