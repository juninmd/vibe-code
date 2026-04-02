# Stage 1: Build the frontend
FROM oven/bun:1.2-alpine AS web-builder
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --filter @vibe-code/web build

# Stage 2: Runtime image
FROM oven/bun:1.2-alpine AS runner
WORKDIR /app

# Production environment variables
ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo
ENV DATA_DIR=/app/data
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
