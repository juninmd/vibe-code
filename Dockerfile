# syntax=docker/dockerfile:1.7
ARG BUN_VERSION=1.3

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

# OS deps: git (worktrees), curl/ca (CLI installers + healthcheck), openssh (git@), tini (PID 1),
# build-essential + pkg-config (C compiler/linker `cc`/`ld` for native builds, e.g. Rust/cgo agents),
# plus the everyday CLIs agents reach for: wget, jq, make, ripgrep, python3/pip, java, ruby.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git ca-certificates curl wget gnupg openssh-client tini unzip xz-utils \
      build-essential pkg-config make jq ripgrep \
      python3 python3-pip python3-venv \
      default-jdk-headless ruby-full \
 && rm -rf /var/lib/apt/lists/*

# Node + pnpm (claude-code is intentionally NOT installed in the container —
# the cluster deployment runs OpenCode free models only).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && npm i -g pnpm yarn \
 && npm cache clean --force

# GitHub CLI (official apt repo): agents in runner pods open PRs with `gh pr create`
RUN mkdir -p -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# Docker CLI + buildx/compose (official apt repo). Client only: a runner pod has no daemon;
# point DOCKER_HOST at one if the cluster offers it.
RUN install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && chmod a+r /etc/apt/keyrings/docker.asc \
 && . /etc/os-release \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-buildx-plugin docker-compose-plugin \
 && rm -rf /var/lib/apt/lists/*

# Google Cloud CLI (gcloud, bq, gsutil) and Trivy, from their official apt repos.
RUN curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
      | gpg --dearmor -o /etc/apt/keyrings/cloud.google.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
      > /etc/apt/sources.list.d/google-cloud-sdk.list \
 && curl -fsSL https://aquasecurity.github.io/trivy-repo/deb/public.key \
      | gpg --dearmor -o /etc/apt/keyrings/trivy.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb generic main" \
      > /etc/apt/sources.list.d/trivy.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends google-cloud-cli trivy \
 && rm -rf /var/lib/apt/lists/*

# Go (official tarball; Debian's golang lags) and Rust (rustup, minimal profile).
ARG GO_VERSION=1.27.4
ENV GOROOT=/usr/local/go GOPATH=/usr/local/gopath \
    RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo
ENV PATH=/usr/local/go/bin:/usr/local/gopath/bin:/usr/local/cargo/bin:$PATH
RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-$(dpkg --print-architecture).tar.gz" \
      | tar -C /usr/local -xz \
 && curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable --no-modify-path

# uv (pinned installer) and the reviewer's scanners: semgrep (via uv), gitleaks (also the
# pre-push guard, scripts/git-hooks), trufflehog and hadolint (official pinned images).
COPY --from=ghcr.io/trufflesecurity/trufflehog:3.100.0 /usr/bin/trufflehog /usr/local/bin/trufflehog
COPY --from=hadolint/hadolint:v2.15.1 /bin/hadolint /usr/local/bin/hadolint
ARG UV_VERSION=0.13.9
ARG SEMGREP_VERSION=1.186.0
ARG GITLEAKS_VERSION=v8.30.1
RUN curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" \
      | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh \
 && UV_PYTHON_PREFERENCE=only-system UV_TOOL_DIR=/opt/uv-tools UV_TOOL_BIN_DIR=/usr/local/bin \
      uv tool install "semgrep==${SEMGREP_VERSION}" \
 && GOBIN=/usr/local/bin go install "github.com/zricethezav/gitleaks/v8@${GITLEAKS_VERSION}" \
 && go clean -cache -modcache

# GitLab CLI (agents open MRs with `glab`), release tarball checked against its checksums.
ARG GLAB_VERSION=1.130.0
RUN arch="$(dpkg --print-architecture)" \
 && base="https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/packages/generic/glab/${GLAB_VERSION}" \
 && file="glab_${GLAB_VERSION}_linux_${arch}.tar.gz" \
 && cd /tmp \
 && curl -fsSLO "${base}/${file}" \
 && curl -fsSL "${base}/checksums.txt" | grep " ${file}\$" | sha256sum -c - \
 && tar -xzf "${file}" bin/glab \
 && install -m 0755 bin/glab /usr/local/bin/glab \
 && rm -rf /tmp/bin "/tmp/${file}"

# Default MCPs every session gets: Playwright (browser + screenshots as PR evidence) and
# Context7 (library docs), pinned and preinstalled so runs never fetch them through npx.
# Chromium and its system libraries come from the Playwright build the MCP pins.
ARG PLAYWRIGHT_MCP_VERSION=0.0.85
ARG CONTEXT7_MCP_VERSION=4.7.3
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_MCP_BROWSER=chromium \
    PLAYWRIGHT_MCP_NO_SANDBOX=true
RUN npm i -g --ignore-scripts --no-audit --no-fund \
      "@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}" "@upstash/context7-mcp@${CONTEXT7_MCP_VERSION}" \
 && node "$(npm root -g)/@playwright/mcp/node_modules/playwright/cli.js" install --with-deps chromium \
 && chmod -R a+rX /ms-playwright \
 && npm cache clean --force \
 && rm -rf /var/lib/apt/lists/*

# OpenCode CLI (binary installer)
RUN curl -fsSL https://opencode.ai/install | bash \
 && mv /root/.opencode/bin/opencode /usr/local/bin/opencode \
 && rm -rf /root/.opencode

# VS Code in the browser (code-server), one loopback instance per session behind /vscode/<id>/
ARG CODE_SERVER_VERSION=4.145.2
RUN arch="$(dpkg --print-architecture)" \
 && curl -fsSL "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server-${CODE_SERVER_VERSION}-linux-${arch}.tar.gz" \
      | tar -xz -C /opt \
 && ln -s "/opt/code-server-${CODE_SERVER_VERSION}-linux-${arch}/bin/code-server" /usr/local/bin/code-server

# Git defaults expected by the agents
RUN git config --system core.quotepath false \
 && git config --system init.defaultBranch main \
 && git config --system safe.directory '*'

# Non-root runtime user
RUN groupadd -g 10001 vibe && useradd -m -u 10001 -g vibe -s /bin/bash vibe

WORKDIR /app
COPY --from=builder --chown=vibe:vibe /app/node_modules ./node_modules
COPY --from=builder --chown=vibe:vibe /app/packages ./packages
COPY --from=builder --chown=vibe:vibe /app/migrations ./migrations
COPY --from=builder --chown=vibe:vibe /app/package.json /app/bun.lock /app/tsconfig.json ./
# Pre-built web assets served by the server in production
COPY --from=builder --chown=vibe:vibe /app/packages/web/dist ./packages/web/dist

# OpenCode default config — use free models, no external API key required
RUN mkdir -p /home/vibe/.config/opencode \
 && echo '{"$schema":"https://opencode.ai/config.json","model":"opencode/deepseek-v4.1-flash-free","share":"disabled","permission":{"*":"allow"}}' \
      > /home/vibe/.config/opencode/opencode.json

# Mount points expected by the operator
# .local/{share,state}: runner pods mount OpenCode sessions below them; must stay user-owned.
# Non-recursive chown: lets `go install`/`cargo install` write without copying the toolchains.
RUN mkdir -p /usr/local/gopath/bin /usr/local/cargo/registry /usr/local/cargo/git \
 && chown vibe:vibe /usr/local/gopath /usr/local/gopath/bin \
      /usr/local/cargo /usr/local/cargo/bin /usr/local/cargo/registry /usr/local/cargo/git \
 && mkdir -p /data /home/vibe/.agents /home/vibe/.local/share /home/vibe/.local/state \
 && chown -R vibe:vibe /data /home/vibe

# VIBE_REQUIRE_GITLEAKS: the pre-push guard blocks instead of skipping when gitleaks is missing.
ENV HOME=/home/vibe \
    NODE_ENV=production \
    VIBE_REQUIRE_GITLEAKS=1 \
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
  CMD curl -fsS "http://localhost:${PORT}/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "run", "src/index.ts"]
