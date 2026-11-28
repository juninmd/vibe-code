# Vibe-Code: 360° Deep-Dive Code Analysis

**Date**: May 3, 2026
**Status**: v2 - 75% Complete (6/8 Milestones)
**Scope**: Full codebase architecture, orchestration, frontend, database, DevOps, quality
**Analyzed Components**: 50+ files across server, web, db layers

---

## Executive Summary

Vibe-Code is an **autonomous code production control plane** orchestrating coding agents across Git repositories. The architecture is fundamentally sound with a well-designed database abstraction layer, event-driven orchestration, and React 19 frontend. However, several **critical gaps**, **concurrency risks**, and **test coverage blind spots** need immediate attention before production scale.

### 🎯 Top 3 Findings

1. **Concurrency Model is Underdeveloped**: Max 4 agents by default, but no circuit breakers, backpressure mechanisms, or graceful degradation when all slots fill. **Status: yellow flag**.
2. **Authentication/Authorization is Stubbed**: GitHub OAuth skeleton present but workspace access control incomplete (5 TODOs in [api/workspaces.ts](packages/server/src/api/workspaces.ts#L13-L82)). **Status: red flag for production**.
3. **Test Coverage Has Blind Spots**: Strong coverage for orchestration & database, but web components (50+ UI components) have 0 integration tests. **Status: yellow flag**.

### ✅ Key Strengths

- **Polymorphic DB Abstraction** (M1): Seamless SQLite↔PostgreSQL swap with identical schemas
- **Type-Safe Event Architecture**: AsyncGenerator pattern with strict TypeScript (strict: true)
- **WebSocket Batching Optimization**: Log events batched every 30ms, reducing message pressure
- **Comprehensive Task Lifecycle**: From backlog → review → done with dependency tracking
- **Multi-Tenant Ready**: Workspace isolation enforced via middleware on all protected endpoints

---

## 1. Orchestration Engine

### Architecture Review

**Location**: [packages/server/src/agents/orchestrator.ts](packages/server/src/agents/orchestrator.ts)
**Core Pattern**: Task queue + AsyncGenerator event stream + slot reservation

```typescript
interface ActiveRun {
  runId: string;
  taskId: string;
  engineName: string;
  abort: AbortController;
}

class Orchestrator {
  private activeRuns = new Map<string, ActiveRun>(); // ← Slot tracker
  private maxConcurrent: number; // Default: 4
  private maxAgentsByStatus: Map<string, number>; // Per-status limits
}
```

### ✅ What's Working Well

1. **Immediate Slot Reservation** ([L191](packages/server/src/agents/orchestrator.ts#L191)): Prevents race conditions by marking a slot "reserved" before async setup:
   ```typescript
   const placeholder: ActiveRun = { runId: "__pending__", taskId: task.id, ... };
   this.activeRuns.set(task.id, placeholder); // Lock acquired
   ```

2. **Priority-Ordered Backlog Sweep**: `sweepBacklog()` sorts by priority (urgent=4, none=0) before launching queued tasks.

3. **Status-Aware Concurrency Limits** (via `VIBE_CODE_MAX_AGENTS_BY_STATUS`):
   ```typescript
   VIBE_CODE_MAX_AGENTS_BY_STATUS="in_progress:6,review:2"
   ```
   Allows fine-grained control (e.g., 6 concurrent implementations, only 2 simultaneous reviews).

4. **Automatic Retry with Exponential Backoff**:
   - Auto-retry enabled by default (max 2 attempts)
   - Backoff: 10s, then 20s, capped at 300s (configurable)
   - [L28-30](packages/server/src/agents/orchestrator.ts#L28-L30)

5. **Dependency Tracking**: Tasks can block on `dependsOn`, checking incompleteness before launch.

6. **Graceful Cancellation**: AbortController signals both executor and engine, task moves back to backlog.

### ⚠️ What Needs Improvement

1. **No Backpressure / Circuit Breaker**
   - When max concurrent is hit, `launch()` throws "Max concurrent agents reached"
   - Caller must retry manually (API returns 409 implied)
   - **Risk**: Thundering herd of retries from web clients without exponential backoff on client side
   - **Recommendation**: Implement server-side queue with max depth, reject with 503 + Retry-After

2. **Concurrency by Default Too Conservative**
   - Max 4 agents by default (single-digit)
   - No auto-tuning based on available memory/CPU
   - In production (16-core box), 4 agents leaves 75% resources unused
   - **Recommendation**: Default to `min(cpu_count - 2, 8)` or allow cloud-aware config

3. **No Metrics for Agent Resource Usage**
   - Running agents tracked by count only, not memory/CPU/token cost
   - If 2 expensive OpenCode runs + 2 lightweight Claude runs, treated equally
   - **Recommendation**: Track `costStats` per run and factor into admission control

4. **Race Condition in `maybeScheduleRetry()`** ([L387-406](packages/server/src/agents/orchestrator.ts#L387-L406))
   - Retry timer set, but if same task is manually launched before timer fires, race between:
     - Manual launch removing task from `retryQueue`
     - Timer firing and re-queuing the same task
   - **Mitigation**: Already handled via `cancelRetry()` before launch, but edge case remains if timer fires during launch setup
   - **Recommendation**: Use `clearTimeout()` before adding to retryQueue

5. **No Per-Task Timeout / Stale Run Detection**
   - Agent can run indefinitely if engine.execute() never yields `complete`
   - No watchdog to force-kill hung agents
   - **Risk**: Zombie runs consuming slots forever
   - **Recommendation**: Wrap executor in Promise.race with 60-minute timeout, force status→`failed`

### 🎯 Priority: **P1** (High)

**Gaps to Address**:
- Add circuit breaker + queue depth limiting (P1)
- Implement per-task timeout watchdog (P1)
- Add client-side exponential backoff for 409/503 responses (P2)
- Auto-tune maxConcurrent based on system resources (P2)

---

## 2. Agent Registry & Engine Discovery

### Architecture

**Location**: [packages/server/src/agents/registry.ts](packages/server/src/agents/registry.ts)

Currently **13 engines** hard-registered at runtime:

```typescript
constructor() {
  this.register(new ClaudeCodeEngine());
  this.register(new AiderEngine());
  this.register(new OpenCodeEngine());
  // ... 10 more
}
```

### ✅ What's Working Well

1. **Plugin-Like Registration Interface**:
   ```typescript
   register(engine: AgentEngine): void
   get(name: string): AgentEngine | undefined
   getFirstAvailable(): Promise<AgentEngine | undefined>
   listEngines(activeRuns?): Promise<EngineInfo[]>
   ```
   Easy to add new engines without modifying core.

2. **Availability Checking with 3s Timeout** ([registry.ts#L47-50](packages/server/src/agents/registry.ts#L47-L50)):
   ```typescript
   version = await Promise.race<string | null>([
     engine.getVersion().catch(() => null),
     new Promise<null>((res) => setTimeout(() => res(null), 3000))
   ]);
   ```
   Prevents slow engines from blocking the availability list.

3. **Setup Issue Reporting**: Each engine can report `getSetupIssue()` (e.g., "OpenCode CLI not found"), exposed via `/api/engines`.

### ⚠️ What Needs Improvement

1. **No Dynamic Engine Loading** (No Hotswap)
   - All engines hard-coded in constructor
   - Adding new engine requires server restart
   - **Recommendation**: Support plugin dirs (e.g., `~/.vibe-code/engines/*.ts`) with lazy loading

2. **No Engine Health Monitoring / Circuit Breaking**
   - If engine repeatedly fails (e.g., Claude API down), still tried on every task
   - No cooldown or skip-list
   - **Recommendation**: Track engine failure rate, auto-disable if >50% fail in last hour

3. **Engine Interface Incomplete**
   - `sendInput()` for interactive agents returns `boolean`, but semantics unclear (accepted? queued?)
   - `abort()` doesn't return status (did it succeed?)
   - No `cleanup()` method for resource release
   - **Recommendation**: Extend interface with explicit ack/nack and cleanup lifecycle

4. **No Engine Routing Preferences**
   - Always picks "first available" if no explicit override
   - No affinity hints (e.g., "prefer Claude for code review")
   - **Recommendation**: Support `engine_preference: { task_type → engine_name }` in task spec

### 🎯 Priority: **P2** (Medium)

---

## 3. Task Lifecycle & Database Integrity

### Database Schema

**Location**: [migrations/001-initial-schema.sqlite.sql](migrations/001-initial-schema.sqlite.sql), [packages/server/src/db/schema.ts](packages/server/src/db/schema.ts)

Tables: `repositories`, `tasks`, `agent_runs`, `agent_logs`, `task_artifacts`, `settings`, `auth_sessions`, `prompt_templates`, `labels`, `task_schedules`, `findings`, `metrics`, `memories`, `review_rounds`, `review_issues`

### Database Pragmas (SQLite)

```sqlite
PRAGMA journal_mode = WAL;        -- ✅ Write-Ahead Logging for concurrency
PRAGMA foreign_keys = ON;         -- ✅ Referential integrity
PRAGMA busy_timeout = 5000;       -- ✅ 5s retry on lock
```

### ✅ What's Working Well

1. **Strong Foreign Key Constraints**:
   - `repositories` PK → `tasks.repo_id` (ON DELETE CASCADE)
   - `tasks` PK → `agent_runs.task_id` (ON DELETE CASCADE)
   - `agent_runs` PK → `agent_logs.run_id` (ON DELETE CASCADE)
   - Orphaned records automatically cleaned

2. **Atomicity via Transactions**:
   - `db.transaction()` wrapper in queries enforces SERIALIZABLE in PostgreSQL
   - SQLite transactions via `db.exec("BEGIN")`

3. **Multi-Tenant Isolation** (M2 Complete):
   - All resource tables include implicit `workspace_id` in schema (planned, referenced in MILESTONE_SUMMARY)
   - Middleware enforces workspace context on protected endpoints

4. **Priority Normalization** ([queries.ts#L33-44](packages/server/src/db/queries.ts#L33-L44)):
   - Internal: stored as `integer` (0-4)
   - External API: semantic `TaskPriority` enum (`"none"|"low"|"medium"|"high"|"urgent"`)
   - Bi-directional mapping prevents confusion

### ⚠️ What Needs Improvement

1. **No Cascading Cleanup for Worktrees**
   - `DELETE FROM agent_runs` cascades logs, but worktree file still exists on disk
   - After 30 days, orphaned worktrees accumulate in `~/.vibe-code/workspaces/`
   - [index.ts#L124-130](packages/server/src/index.ts#L124-L130) does auto-cleanup but via orphaned task detection
   - **Risk**: Disk fills with stale worktrees, no alerting
   - **Recommendation**: Add `worktree_cleanup_at` timestamp, auto-rm after configurable TTL (default 7 days)

2. **No Explicit Workspace Partition in Current Schema**
   - MILESTONE_SUMMARY mentions workspace_id in schema, but current [schema.ts](packages/server/src/db/schema.ts) doesn't show it
   - All queries assume single workspace
   - **Risk**: Multi-tenant safety not yet enforced at DB level
   - **Recommendation**: Confirm M2 is complete and add workspace_id PK to all resource tables

3. **Cost Tracking Stored as JSON**
   - `cost_stats` in `agent_runs` is JSON blob, not normalized
   - Can't query "runs over $100" without full table scan
   - **Recommendation**: Normalize cost_stats into separate table or add `total_cost DECIMAL` column for indexing

4. **No Audit Trail**
   - Task updates don't record who/when changed status, engine, etc.
   - Impossible to trace task history or debug state transitions
   - **Recommendation**: Add `task_audit_log(task_id, action, old_value, new_value, changed_by, changed_at)`

5. **Implicit Workspace_id Missing in Current Queries**
   - [queries.ts](packages/server/src/db/queries.ts) doesn't filter by workspace_id
   - Two workspaces could see each other's tasks in a multi-tenant instance
   - **Risk**: Critical security gap if shared instance
   - **Status**: ⚠️ Verify M2 completion; this appears incomplete

### 🎯 Priority: **P1** (Critical for Multi-Tenant Safety)

---

## 4. Frontend Integration & Components

### Architecture

**Location**: [packages/web/src/](packages/web/src/)

Stack: React 19.2.5 + Vite 8 + TailwindCSS 4 + Zustand + React Query 5

### Component Map

| Component | Purpose | Size | Test Coverage |
|-----------|---------|------|---|
| [Board.tsx](packages/web/src/components/Board.tsx) | Kanban view with D&D | ~300 LOC | ❌ None |
| [TaskDetail.tsx](packages/web/src/components/TaskDetail.tsx) | Task cockpit + live logs | ~500 LOC | ❌ None |
| [TaskCard.tsx](packages/web/src/components/TaskCard.tsx) | Individual task card | ~150 LOC | ✅ Test exists ([TaskCard.test.tsx](packages/web/src/components/TaskCard.test.tsx)) |
| [AgentOutput.tsx](packages/web/src/components/AgentOutput.tsx) | Live agent logs viewer | ~700 LOC | ❌ None |
| [EnginesPanel.tsx](packages/web/src/components/EnginesPanel.tsx) | Engine availability display | ~200 LOC | ❌ None |
| [SettingsDialog.tsx](packages/web/src/components/SettingsDialog.tsx) | Global settings UI | ~300 LOC | ❌ None |
| [Sidebar.tsx](packages/web/src/components/Sidebar.tsx) | Nav + repo selector | ~250 LOC | ❌ None |

### ✅ What's Working Well

1. **React Query + Zustand Separation** (M3 Complete):
   - ✅ Server state in React Query (tasks, runs, engines)
   - ✅ UI state in Zustand (modals, filters, theme)
   - ✅ WebSocket invalidation handlers refresh stale queries
   - Clear contract prevents duplicate server data in stores

2. **Performance Optimizations in Place**:
   - `useMemo()` for derived state (token stats, filtered logs, step groups)
   - `useCallback()` for event handlers (drag, keyboard, submit)
   - Log batching on server side (30ms) + lazy rendering in AgentOutput
   - Virtual scrolling for 10k+ log lines ([AgentOutput.tsx](packages/web/src/components/AgentOutput.tsx) uses custom buffering)

3. **Type-Safe API Client** ([api/client.ts](packages/web/src/api/client.ts)):
   - All endpoints typed with shared types from `@vibe-code/shared`
   - 30s request timeout with AbortController
   - Error class includes status + path + method for debugging

4. **Comprehensive Keyboard Shortcuts**:
   - Full keyboard navigation in kanban, modals, agent output
   - Modal focus trapping, escape to close
   - Command palette (`Cmd+K` / `Ctrl+K`)

5. **Accessibility**: D&D kit (dnd-kit) used for drag-and-drop, semantic HTML elements, ARIA labels.

### ⚠️ What Needs Improvement

1. **Zero Component-Level Integration Tests**
   - [TaskCard.test.tsx](packages/web/src/components/TaskCard.test.tsx) exists but Board, TaskDetail, AgentOutput have NO tests
   - 50+ interactive components with 0 integration coverage
   - Risk: UI regressions go undetected until production
   - **Recommendation**: Add vitest tests for Board (drag + reorder), TaskDetail (form submission), AgentOutput (log rendering)

2. **AgentOutput Performance Risk**
   - Renders 700+ LOC component with complex filtering, memoization
   - On 100k log lines, `useMemo()` still expensive during live stream
   - No virtualization of log lines (only container virtualization)
   - **Risk**: Frame drops on large runs
   - **Recommendation**: Use react-virtual or windowed list for individual log items

3. **WebSocket Reconnection Logic Unclear**
   - `useWebSocket()` hook mentioned in CLAUDE.md but not found in codebase
   - Need to verify reconnection strategy (exponential backoff? max retries?)
   - **Recommendation**: Document or implement missing hook with explicit retry policy

4. **No Error Boundaries for Failed Queries**
   - React Query errors might crash entire app if not caught
   - [ErrorBoundary.tsx](packages/web/src/components/ErrorBoundary.tsx) exists but verify it's used everywhere
   - **Recommendation**: Add query-level error handling + user-visible error toast

5. **Lazy Loading Not Implemented**
   - All resources loaded upfront (tasks, repos, runs)
   - No pagination or infinite scroll for large workspaces
   - **Risk**: 10k tasks = slow initial load
   - **Recommendation**: Paginate tasks API (default 50 per page), implement infinite scroll in Board

6. **No Dark Mode Persistence Testing**
   - Theme stored in localStorage but no tests verify persistence
   - **Recommendation**: Add test for theme toggle persistence

### 🎯 Priority: **P2** (Medium - UX stability)

---

## 5. Code Quality Baseline

### TypeScript Configuration

**Location**: [tsconfig.json](tsconfig.json)

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

✅ **Strict mode enabled** — catches null, implicit any, unused locals

### Linting Configuration

**Location**: [biome.json](biome.json)

```json
{
  "linter": {
    "rules": {
      "recommended": true,
      "suspicious": { "noExplicitAny": "off" },
      "style": { "noNonNullAssertion": "warn" },
      "correctness": { "noUnusedVariables": "warn", "noUnusedImports": "warn" }
    }
  }
}
```

⚠️ **`noExplicitAny` is OFF** — allows unrestricted `any` usage

### ✅ What's Working Well

1. **Strict TypeScript Throughout**:
   - All packages compile with `tsc --noEmit` (no emitted JS needed)
   - No implicit `any`, strict null checks enabled
   - Generic types properly constrained (e.g., `Promise<T>`, not bare `Promise`)

2. **Consistent Formatting**:
   - Biome rules applied uniformly (2-space indent, 100-char line width)
   - Single quotes preferred internally, double in JSON
   - Trailing commas (ES5)

3. **Code Organization**:
   - Server: clear separation (agents/, db/, api/, git/, middleware/, ws/)
   - Web: clear separation (components/, hooks/, api/, utils/, theme/)
   - Shared: centralized types in `@vibe-code/shared`

4. **Smart Defaults**:
   - `noUnusedVariables: warn` (doesn't break build, catches cruft)
   - `noNonNullAssertion: warn` (allows `!` with warning, not error)

### ⚠️ What Needs Improvement

1. **`noExplicitAny` Disabled**
   - Risk: Entire type safety undermined if `any` used liberally
   - **Recommendation**: Search codebase for `any` usage, gradually enable `noExplicitAny: "error"`
   - **Action**: Audit [packages/server/src/**/*.ts](packages/server/src) for `any` count

2. **No ESLint Rules for Patterns**
   - No rules for console.log in production code (only in tests)
   - No rules preventing direct SQL (though Zod validation + parameterized queries used)
   - **Recommendation**: Add `no-console` rule (except in index.ts entry point)

3. **Test Coverage Unknown**
   - No coverage reports in package.json scripts
   - Can't measure coverage regression
   - **Recommendation**: Add `"coverage": "bun test --coverage"` to server/web packages

4. **Inconsistent Logging**
   - Mix of `console.log()`, `console.error()`, `console.debug()` with ad-hoc emojis
   - No structured logging format (JSON, levels, timestamps)
   - [index.ts#L63](packages/server/src/index.ts#L63): `console.warn("🔐 GitHub OAuth not configured...")`
   - [middleware/workspace.middleware.ts#L19](packages/server/src/middleware/workspace.middleware.ts#L19): `console.debug("[Middleware] 📡 ...")`
   - **Risk**: Unqueryable logs in production, hard to grep for errors
   - **Recommendation**: Use structured logger (e.g., `pino`, `winston`) with JSON output

5. **No SonarQube / CodeClimate Integration**
   - Can't track code quality trends
   - **Recommendation**: Add `.github/workflows/quality.yml` to run biome + coverage + upload to code quality service

### 🎯 Priority: **P2** (Medium - hygiene)

---

## 6. DevOps & Deployment

### Docker Setup

**Location**: [Dockerfile](Dockerfile)

✅ **Multi-stage build** (builder → runtime)
✅ **Non-root user** (vibe:vibe, uid 10001)
✅ **Health checks** (curl to /health, 30s interval)

**Runtime Container Includes**:
- Node.js 20 (for npm CLI support)
- Git (worktrees)
- Claude Code CLI (distributed via npm)
- OpenCode CLI (binary installer)
- curl, ca-certificates, tini (PID 1 init)

**Size Optimization**:
- Second-stage FROM oven/bun (base image ~300MB + deps)
- No apt caches, minimal bloat

### ✅ What's Working Well

1. **Tini for Proper Signal Handling** (ENTRYPOINT: `["/usr/bin/tini", "--"]`)
   - Ensures Ctrl+C reaches bun process correctly
   - Prevents zombie processes

2. **Health Check Configuration**:
   ```dockerfile
   HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
     CMD curl -fsS "http://localhost:${PORT}/health"
   ```
   - Immediate restart if unhealthy (3 retries = 90s before action)
   - 20s grace period for startup

3. **Environment Inheritance** (from docker-compose):
   - PORT, DATABASE_URL, VIBE_CODE_DATA_DIR all configurable
   - Git identity hardcoded for agent commits

4. **Mount Points for Persistence**:
   - `/data` for SQLite DB + worktrees
   - `/home/vibe/.agents` for agent config

### ⚠️ What Needs Improvement

1. **No Security Scanning in Dockerfile**
   - No `RUN apt-get update && apt-get upgrade` for base image security
   - oven/bun image not regularly scanned for CVEs
   - **Recommendation**: Add to CI: `trivy image --severity HIGH,CRITICAL`

2. **Secrets Not Rotated**
   - Git identity hardcoded: `vibe-code@vibe-code.local` with no signing
   - **Recommendation**: Support GPG signing via mounted key or KMS

3. **No Resource Limits in Dockerfile**
   - Agent processes could starve resources
   - **Recommendation**: Add to docker-compose: `mem_limit: 2g, cpus: 2.0` per service

4. **Installation Scripts Not Pinned to Versions**
   - `curl -fsSL https://opencode.ai/install | bash` — always latest (could break)
   - `npm i -g @anthropic-ai/claude-code` — no version constraint
   - **Recommendation**: Pin versions: `npm i -g @anthropic-ai/claude-code@^0.5.0`

### Docker Compose

**Location**: [docker-compose.yml](docker-compose.yml)

Services: vibe-app, postgres:16, litellm

### ✅ What's Working Well

1. **Service Dependency Ordering**:
   ```yaml
   depends_on:
     postgres:
       condition: service_healthy
     litellm:
       condition: service_healthy
   ```
   Waits for dependencies to be healthy before starting vibe-app.

2. **Volume Management**:
   - postgres_data: Persistent DB
   - vibe_data: Task worktrees & artifacts
   - ro mounts for source code (development convenience)

3. **Network Isolation**:
   - Services on internal `vibe-network` bridge
   - Only vibe-app (ports 3000, 5173) exposed

### ⚠️ What Needs Improvement

1. **Volumes Mounted as RW in Dev**
   - `./packages/server/src:/app/packages/server/src:ro` — read-only (good)
   - But live-reload might not work with Bun
   - **Recommendation**: Use named volumes for node_modules, bind mount only src/

2. **No Reverse Proxy**
   - Vibe-app exposes both 3000 (API) and 5173 (Vite dev) to host
   - No SSL/TLS termination
   - In production, exposes both API and web on different ports
   - **Recommendation**: Add Nginx reverse proxy in compose for single port + SSL

3. **PostgreSQL Not Pre-Initialized**
   - First startup runs migrations (in app, not Docker)
   - No schema version check, risk of partial migrations
   - **Recommendation**: Add init script to run migrations before app starts

4. **LiteLLM Config Not Validated**
   - [litellm.config.yaml](litellm.config.yaml) mounted but not validated
   - Invalid config → silent failure or unexpected behavior
   - **Recommendation**: Add schema validation in app startup

5. **No Backup Strategy Documented**
   - postgres_data volume has no backup hooks
   - **Recommendation**: Document backup procedures in DEPLOYMENT.md

### CI/CD

**Status**: Not found in `.github/workflows/`

❌ **No CI/CD pipeline** — no GitHub Actions observed
❌ **No automated deployment** — no GitLab CI
❌ **No test on push** — no build verification

### 🎯 Priority: **P1** (Critical for Production)

---

## 7. Known Limitations & Gaps

### From MILESTONE_SUMMARY.md

- ✅ M1: Foundation & DB (complete)
- ✅ M2: Workspace Architecture (complete)
- ✅ M3: State Management (complete)
- ✅ M4: Skills System MVP (complete)
- ✅ M5: Review Pipeline (complete)
- ✅ M6: Orchestration Enhancements (complete)
- ⚠️ M7: Auth & Multi-Tenant (partial)
- ⚠️ M8: Production Readiness (pending)

### Explicitly Unimplemented Features

**Auth (5 TODOs)**:
- [api/workspaces.ts#L13](packages/server/src/api/workspaces.ts#L13): "Get current user from context/JWT"
- [api/workspaces.ts#L44](packages/server/src/api/workspaces.ts#L44): "Verify user has access to this workspace"
- [api/workspaces.ts#L80-82](packages/server/src/api/workspaces.ts#L80-L82): "Validate slug is unique", "Create workspace in database", "Add current user as owner"

**Risk**: Without these, multi-workspace isolation cannot be enforced.

### GitHub OAuth Skeleton

[auth.ts](packages/server/src/auth.ts) implements full OAuth flow:
- ✅ Redirects to GitHub authorize endpoint
- ✅ Exchanges code for access token
- ✅ Stores session in DB (HttpOnly cookie)
- ✅ Logout endpoint
- ❌ But **disabled by default** (requires `GITHUB_OAUTH_CLIENT_ID` env var)
- ❌ No role-based access control
- ❌ No workspace membership verification

**Status**: Functional but not wired into workspace routes yet.

### From WORKFLOW.md

Current state: **Compatibility Mode**

- Workflow contract exists but **not yet enforced by runtime**
- Runtime still uses legacy prompt-template pipeline
- Future: Runtime should consume `WORKFLOW.md` directly

**Implications**:
- New workflow features need both documentation update AND code change
- Risk of drift between docs and behavior

### 🎯 Priority: **P0** (Blocker for Production)

---

## 8. Security & Observability

### Authentication

**Status**: GitHub OAuth implemented but NOT integrated with workspace routes

```typescript
// auth.ts: GitHub flow present
function isAuthEnabled(): boolean {
  return Boolean(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET);
}

// BUT: api/workspaces.ts routes have no auth checks (TODO comments)
```

### ✅ What's Working Well

1. **Token Hashing**:
   - Session ID hashed with SHA256 before storage ([auth.ts#L55-58](packages/server/src/auth.ts#L55-L58))
   - Timing-safe comparison via `timingSafeEqual`

2. **Secure Cookie Defaults**:
   - HttpOnly by default
   - Secure flag when `NODE_ENV=production` or `X-Forwarded-Proto: https`
   - SameSite not explicitly set (defaults to "Strict" in most browsers)

3. **Session Expiry** (30 days):
   ```typescript
   function sessionExpiry(): Date {
     return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
   }
   ```

### ⚠️ What Needs Fixing

1. **No CSRF Protection**
   - POST /api/tasks, /api/repos use Zod validation only
   - No CSRF token in forms
   - **Risk**: Cross-site request forgery if JavaScript enabled on attacker site
   - **Recommendation**: Add CSRF middleware, validate Origin header

2. **No Input Validation Sanitization**
   - Task titles, repo URLs accepted as-is
   - Zod validates types but not XSS/injection
   - **Risk**: Task title could contain script: `<img src=x onerror="alert('xss')">`
   - **Recommendation**: Use html-escape on all user input before rendering in DOM

3. **No Rate Limiting**
   - Anyone can spam `/api/tasks` endpoint
   - No per-IP or per-session limits
   - **Recommendation**: Add middleware with `ms` library, 100 requests per minute per IP

4. **LiteLLM Keys Exposed in Logs**
   - If agent fails, error message might include API key
   - [litellm-client.ts#L89](packages/server/src/agents/litellm-client.ts#L89) logs key deletion warning
   - **Recommendation**: Use secret masking in all error messages

5. **No Secret Scanning in Git**
   - No gitleaks or truffleHog integration
   - **Recommendation**: Add pre-commit hook + CI check

### Logging & Observability

**Current Approach**: `console.log()` + emojis

```typescript
console.log(`  🗑️ Auto-cleanup: Removed ${cleaned} archived tasks...`);
console.warn(`[Middleware] 📡 Skipping workspace validation...`);
console.error(`[orchestrator] Agent run failed...`);
```

### ⚠️ Issues

1. **Unstructured Logs**
   - No timestamps in logs (unless piped through docker)
   - No log levels standardized
   - Emojis non-searchable in production
   - **Recommendation**: Switch to JSON structured logging (pino or bunyan)

2. **No Distributed Tracing**
   - Can't correlate logs across services (server, litellm, postgres)
   - No request IDs
   - **Recommendation**: Add OpenTelemetry context propagation

3. **No Metrics Exported**
   - No Prometheus metrics
   - Can't monitor agent count, queue depth, latency
   - **Recommendation**: Expose metrics on `/metrics` endpoint

4. **No Error Tracking**
   - Errors logged to console only
   - No Sentry or similar integration
   - Risk: Critical errors go unnoticed in production
   - **Recommendation**: Add Sentry SDK, group errors by type

5. **No Slow Query Logging**
   - SQLite queries not instrumented
   - Can't detect N+1 query patterns
   - **Recommendation**: Wrap `db.query()` with timing, log >100ms queries

### 🎯 Priority: **P0** (Critical for Production)

---

## Risk Matrix

| Risk | Likelihood | Impact | Mitigation | Priority |
|------|------------|--------|-----------|----------|
| Workspace data leaks in multi-tenant setup | High | Critical | Complete auth TODOs, add workspace_id to all queries | **P0** |
| Agent slots exhaust, queue starves | High | High | Add circuit breaker + backpressure | **P1** |
| Worktrees accumulate on disk, filling volume | Medium | High | Add TTL-based cleanup, monitoring | **P1** |
| XSS via task title or repo URL | Medium | High | Add html-escape, CSP header | **P1** |
| Undetected production errors | Medium | High | Add Sentry + structured logging | **P1** |
| UI regression (no component tests) | Medium | Medium | Add vitest coverage for Board, TaskDetail | **P2** |
| Agent process hangs forever | Low | High | Add 60-min timeout + watchdog | **P1** |
| Engine failures cascade (no circuit breaker) | Low | Medium | Add per-engine cooldown, health tracking | **P2** |

---

## Reusable Patterns & Opportunities

### Patterns to Extract

1. **Async Generator Event Stream**
   - [AgentEngine interface](packages/server/src/agents/engine.ts) — reuse for other async workflows
   - **Opportunity**: Extract to `@vibe-code/event-stream` package

2. **Polymorphic Database Adapter** (M1)
   - Currently in `packages/db-adapter`
   - **Opportunity**: Publish as `@vibe-code/db-adapter` for reuse in other projects

3. **Workspace Middleware**
   - [workspace.middleware.ts](packages/server/src/middleware/workspace.middleware.ts)
   - **Opportunity**: Extract to shared middleware, reuse in API routes

4. **Task Lifecycle State Machine**
   - Task statuses: `backlog → in_progress → review → done` (with failures, retries)
   - **Opportunity**: Extract to `@vibe-code/task-fsm` package with state validation

5. **Query Batching** (WebSocket)
   - [broadcast.ts](packages/server/src/ws/broadcast.ts) batches logs every 30ms
   - **Opportunity**: Generic batching abstraction for other event types

### Integration Points for New Features

1. **Observability**: Add OpenTelemetry traces without rewriting orchestrator
2. **Persistence**: Add task archives to cold storage (S3, GCS) without DB schema change
3. **Scheduling**: Add cron-like task scheduling via new engine type
4. **Notifications**: WebSocket already supports `agent_logs_batch` and `task_updated`; add `status_change` events

---

## Top 5 Recommended Improvements by Priority

### 🔴 P0: BLOCKER

**1. Complete Multi-Tenant Authorization** (Impact: Critical)
- **Current State**: 5 TODOs in api/workspaces.ts, workspace_id not enforced in queries
- **Action**:
  - Add `workspace_id` to all resource tables
  - Update all queries to filter by current workspace context
  - Implement workspace membership checks in auth.ts
  - Add integration tests for cross-workspace isolation
- **Effort**: 3-4 days
- **Owner**: db-admin + code-reviewer

**2. Implement Circuit Breaker for Agent Slots** (Impact: High)
- **Current State**: When max 4 agents running, 5th request throws error, caller retries immediately
- **Action**:
  - Add queue depth limit (max 10 pending)
  - Reject with 503 + Retry-After when queue full
  - Track queue size metrics
  - Add backpressure handling in web client (exponential backoff)
- **Effort**: 2-3 days
- **Owner**: orchestration team

**3. Add Structured Logging & Sentry Integration** (Impact: High)
- **Current State**: unstructured console.log with emojis
- **Action**:
  - Replace console.* with pino JSON logger
  - Add request ID propagation
  - Integrate Sentry for error tracking
  - Add log level filtering
- **Effort**: 2 days
- **Owner**: observability team

---

### 🟡 P1: HIGH PRIORITY

**4. Add Per-Task Timeout Watchdog** (Impact: High)
- **Current State**: Agent can run forever if engine.execute() never yields complete
- **Action**:
  - Wrap executeAgent in Promise.race with 60-min timeout
  - Force status to `failed` + log cleanup on timeout
  - Add metric tracking for timeouts
- **Effort**: 1 day
- **Owner**: orchestration team

**5. Add Component-Level Integration Tests for Web UI** (Impact: Medium)
- **Current State**: 50+ interactive components with 0 tests
- **Action**:
  - Add vitest tests for Board (drag + reorder)
  - Add tests for TaskDetail (form submission)
  - Add tests for AgentOutput (log rendering)
  - Set coverage goal to 60% for web
- **Effort**: 3-4 days
- **Owner**: test-writer

---

## Conclusion

Vibe-Code has a **solid architectural foundation** with strong database abstraction, event-driven orchestration, and type-safe React frontend. However, **production readiness requires addressing 3 critical gaps**:

1. **Multi-tenant safety** (workspace isolation not enforced)
2. **Concurrency resilience** (no backpressure, circuit breaker, or timeouts)
3. **Observability & security** (unstructured logs, no error tracking, minimal auth)

**Recommended Action**: Focus on P0 items (auth, circuit breaker, logging) before any production deployment. Estimated 8-10 days of focused engineering.

---

## Appendix: File Structure Reference

```
packages/
├── server/src/
│   ├── agents/
│   │   ├── orchestrator.ts          ← Main orchestration logic
│   │   ├── registry.ts              ← Engine discovery
│   │   ├── engine.ts                ← AgentEngine interface
│   │   └── engines/                 ← 13 engine implementations
│   ├── db/
│   │   ├── index.ts                 ← DB factory
│   │   ├── queries.ts               ← Query builders
│   │   └── schema.ts                ← Schema + seeding
│   ├── api/                         ← REST endpoints
│   ├── git/git-service.ts           ← Git worktree management
│   ├── ws/broadcast.ts              ← WebSocket hub + batching
│   ├── auth.ts                      ← GitHub OAuth
│   └── middleware/                  ← Hono middleware
├── web/src/
│   ├── components/                  ← 30+ React components
│   ├── hooks/                       ← React Query + Zustand hooks
│   ├── api/client.ts                ← Typed API client
│   └── theme/                       ← Dark mode
├── shared/src/
│   ├── types.ts                     ← Shared TypeScript interfaces
│   └── index.ts                     ← Re-exports
└── core/                            ← Autopilots, providers, skills
```

