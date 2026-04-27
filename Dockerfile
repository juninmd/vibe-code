# syntax=docker/dockerfile:1.7
ARG BUN_VERSION=1.2

# ─── Stage 1: build ──────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-debian AS builder
WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY bunfig.toml* ./
COPY packages ./packages
COPY migrations ./migrations

RUN bun install --frozen-lockfile
RUN bun run build

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM oven/bun:${BUN_VERSION}-debian AS runtime
ENV DEBIAN_FRONTEND=noninteractive

# OS deps: git (worktrees), curl/ca (CLI installers + healthcheck), openssh (git@), tini (PID 1)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git ca-certificates curl openssh-client tini \
 && rm -rf /var/lib/apt/lists/*

# Node + Claude Code CLI (distributed via npm)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && npm i -g @anthropic-ai/claude-code \
 && npm cache clean --force

# OpenCode CLI (binary installer)
RUN curl -fsSL https://opencode.ai/install | bash \
 && mv /root/.opencode/bin/opencode /usr/local/bin/opencode \
 && rm -rf /root/.opencode

# Git defaults expected by the agents
RUN git config --system core.quotepath false \
 && git config --system init.defaultBranch main \
 && git config --system safe.directory '*'

# Non-root runtime user
RUN groupadd -g 1000 vibe && useradd -m -u 1000 -g vibe -s /bin/bash vibe

WORKDIR /app
COPY --from=builder --chown=vibe:vibe /app/node_modules ./node_modules
COPY --from=builder --chown=vibe:vibe /app/packages ./packages
COPY --from=builder --chown=vibe:vibe /app/migrations ./migrations
COPY --from=builder --chown=vibe:vibe /app/package.json /app/bun.lock /app/tsconfig.json ./

# Mount points expected by the operator
RUN mkdir -p /data /home/vibe/.agents \
 && chown -R vibe:vibe /data /home/vibe

ENV HOME=/home/vibe \
    NODE_ENV=production \
    PORT=3000 \
    VIBE_CODE_DATA_DIR=/data \
    GIT_AUTHOR_NAME="vibe-code" \
    GIT_AUTHOR_EMAIL="agent@vibe-code.local" \
    GIT_COMMITTER_NAME="vibe-code" \
    GIT_COMMITTER_EMAIL="agent@vibe-code.local"

USER vibe
WORKDIR /app/packages/server
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT}/api/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "run", "src/index.ts"]
