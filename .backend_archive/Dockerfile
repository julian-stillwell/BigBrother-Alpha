# ── Build stage ──────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY src ./src/

RUN npx prisma generate
RUN npx tsc

# ── Production stage ────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy Prisma schema + generated client
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy compiled JS
COPY --from=builder /app/dist ./dist/

# Create storage directory
RUN mkdir -p /app/storage/artifacts

# Run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000

CMD ["node", "dist/index.js"]
