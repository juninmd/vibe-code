# Stage 1: Build the frontend
FROM oven/bun:1.2-alpine AS web-builder
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --filter @vibe-code/web build

# Stage 2: Build the backend and combine
FROM oven/bun:1.2-alpine AS runner
WORKDIR /app

# Production environment variables
ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo
ENV DATA_DIR=/app/data
ENV PORT=3000

# Install system dependencies
RUN apk add --no-cache \
    git \
    openssh \
    curl \
    bash \
    python3 \
    py3-pip \
    build-base \
    nodejs \
    npm \
    tzdata

# Install OpenCode CLI
RUN curl -fsSL https://opencode.eachsense.ai/install.sh | bash && \
    mv /root/.opencode/bin/opencode /usr/local/bin/opencode && \
    rm -rf /root/.opencode

# Configure Git Identity (needed by AI agents to make commits)
RUN git config --global user.email "agent@vibe-code.local" && \
    git config --global user.name "Vibe Code Agent" && \
    git config --global core.quotepath false && \
    git config --global init.defaultBranch main

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

# Create and set permissions for the data directory
RUN mkdir -p /app/data && chmod 777 /app/data

# Expose port
EXPOSE 3000

# Start the server
WORKDIR /app/packages/server
CMD ["bun", "run", "src/index.ts"]
