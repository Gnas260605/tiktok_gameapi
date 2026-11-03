# Multi-stage production Dockerfile for TikUser API
FROM node:20-alpine AS builder

WORKDIR /app

# Enable pnpm via Corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependency specifications and lockfile
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY prisma ./prisma/

# Install dependencies deterministically
RUN pnpm install --frozen-lockfile

# Generate Prisma Client
RUN pnpm prisma generate

# Copy application source code
COPY src ./src/

# Compile TypeScript
RUN pnpm build

# Production Runner Stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Install dumb-init or curl for healthchecks
RUN apk add --no-cache curl

# Create non-root system user
RUN addgroup -S tikuser && adduser -S tikuser -G tikuser

# Enable pnpm for runtime production deps
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy production package manifests
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile && pnpm prisma generate

# Copy compiled JavaScript output from builder
COPY --from=builder /app/dist ./dist

# Set ownership to non-root user
RUN chown -R tikuser:tikuser /app

USER tikuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health/live || exit 1

CMD ["node", "dist/src/server.js"]
