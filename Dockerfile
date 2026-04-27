# Multi-stage Dockerfile for Vibe-Code v2
# Builds: @vibe-code/server + @vibe-code/web
# Runtime: Alpine Linux with Bun

# Stage 1: Dependencies & Build
FROM oven/bun:1.3-alpine AS builder
WORKDIR /app

# Copy all source files
COPY . .

# Install dependencies with frozen lockfile for reproducibility
RUN bun install --frozen-lockfile

# Build TypeScript packages
RUN bun run build

# Build web frontend
RUN bun run --filter @vibe-code/web build

# Stage 2: Runtime
FROM oven/bun:1.3-alpine
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache curl postgresql-client

# Environment
ENV NODE_ENV=production
ENV TZ=UTC
ENV PORT=3000

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S bunuser -u 1001

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/bunfig.toml ./bunfig.toml
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/packages ./packages
COPY --chown=bunuser:nodejs --from=builder /app/migrations ./migrations

# Copy web dist
RUN mkdir -p /app/packages/web/dist
COPY --from=builder /app/packages/web/dist ./packages/web/dist

# Switch to non-root user
USER bunuser

# Health check
HEALTHCHECK --interval=10s --timeout=5s --retries=10 --start-period=30s \
  CMD curl -f http://localhost:${PORT}/health || exit 1

# Run server
CMD ["bun", "run", "--filter", "@vibe-code/server", "dev"]
ENV PORT=3000

# Configure git identity via env vars (overridable at runtime)
ENV GIT_AUTHOR_NAME="Vibe Code Agent"
ENV GIT_AUTHOR_EMAIL="agent@vibe-code.local"
ENV GIT_COMMITTER_NAME="Vibe Code Agent"
ENV GIT_COMMITTER_EMAIL="agent@vibe-code.local"

# Install only necessary runtime dependencies (no build-base, nodejs, npm)
RUN apk add --no-cache \
    git \
    openssh \
    curl \
    bash \
    tzdata

# Install OpenCode CLI — download to file first, verify it's a shell script, then execute
RUN curl -fsSL https://opencode.eachsense.ai/install.sh -o /tmp/opencode-install.sh \
    && file /tmp/opencode-install.sh | grep -q "shell\|text" \
    && bash /tmp/opencode-install.sh \
    && mv /root/.opencode/bin/opencode /usr/local/bin/opencode \
    && rm -rf /root/.opencode /tmp/opencode-install.sh

# Configure Git (needed by AI agents to make commits)
RUN git config --global core.quotepath false \
    && git config --global init.defaultBranch main

# Create non-root user for running the application
RUN addgroup -g 1001 vibe \
    && adduser -D -u 1001 -G vibe vibe

# Copy package files and lockfile for dependency caching
COPY package.json bun.lock ./
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/

# Install only production dependencies
RUN bun install --frozen-lockfile --production

# Copy source code and built frontend
COPY packages/server ./packages/server
COPY packages/shared ./packages/shared
COPY --from=web-builder /app/packages/web/dist ./packages/web/dist

# Create data directory with correct ownership (non-root user only)
RUN mkdir -p /app/data && chown -R vibe:vibe /app/data && chmod 750 /app/data

# Switch to non-root user
USER vibe

# Expose port
EXPOSE 3000

# Start the server
WORKDIR /app/packages/server
CMD ["bun", "run", "src/index.ts"]
