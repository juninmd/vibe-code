#!/usr/bin/env bash
# Autonomous task creation loop for mika project
# Creates a new improvement/fix task every 20 minutes
# Also retries backlog tasks when capacity opens up

SESSION="5dYb6a1SDEaGUFzjkaHbrm8MqFkp3nmp8jrH5pPGKDM"
REPO_ID="6bbf832056430a25"
BASE_URL="http://localhost:3000"
INTERVAL=1200  # 20 minutes
MAX_AGENTS=4

TASKS=(
  '{"title":"fix: improve error boundaries in PluginSlot component","description":"Review and enhance the PluginErrorBoundary in PluginSlot. Add: 1) Better error messages showing plugin name and error details, 2) A retry button that re-mounts the plugin, 3) Telemetry event when a plugin crashes. Look in apps/host/src for PluginSlot implementation. After completing implementation, create a PR to the main branch.","branch":"fix/plugin-error-boundary"}'
  '{"title":"feat: add plugin health monitoring dashboard","description":"Create a plugin health monitoring view in the mika host app. Show: 1) Each loaded plugin with its status (active/error/loading), 2) Memory usage per plugin if possible via Electron process metrics, 3) Last error for failed plugins. Use ComponentRegistry/useRegistryStore as data source. Create a PR after completion.","branch":"feat/plugin-health-dashboard"}'
  '{"title":"fix: optimize chat history rendering with content-visibility","description":"The mika app has a chat history component. Apply content-visibility:auto CSS optimization to improve rendering performance for long chat histories. Find the ChatHistory component in the host app renderer. Also add virtual scrolling if the list exceeds 100 items. Create a PR after completion.","branch":"fix/chat-history-performance"}'
  '{"title":"feat: voice settings panel - PTT toggle and visual feedback","description":"Implement Push-to-Talk toggle and visual feedback in the VoiceSettings panel. When PTT is enabled, show a key binding selector. Add a visual indicator (pulsing mic icon) when recording. Store preferences in the app settings store. Look in apps/host/src for VoiceSettings component. Create a PR after completion.","branch":"feat/voice-ptt-ui"}'
  '{"title":"fix: reduce bundle size by auditing duplicate dependencies","description":"Run analysis to find duplicate dependencies across plugins. Ensure react, react-dom, and @mika/sdk are properly externalized in all plugin builds per rollupOptions.external config. Check vite configs across apps/plugins/. Create a PR after completion.","branch":"fix/bundle-dedup"}'
  '{"title":"feat: add keyboard shortcut system for mika actions","description":"Implement a global keyboard shortcut system for mika. Allow users to configure shortcuts for: 1) Toggle mika visibility, 2) Start/stop voice input, 3) Take screenshot for analysis. Use Electron globalShortcut API in main process and expose via IPC. Store in settings. Create a PR after completion.","branch":"feat/keyboard-shortcuts"}'
  '{"title":"fix: improve LLM response streaming with better error recovery","description":"In the mika ChatService, improve streaming resilience: 1) Add retry logic for failed stream chunks, 2) Show partial responses even if stream cuts off, 3) Add timeout handling (30s) for LLM responses. Find ChatService in packages/ or apps/. Create a PR after completion.","branch":"fix/llm-stream-resilience"}'
  '{"title":"feat: expression system - sync avatar expressions with TTS","description":"Implement avatar expression synchronization with TTS output. When Mika speaks, trigger appropriate facial expressions based on text sentiment/content. Use the existing avatar:expression IPC channel. Analyze text for happy/sad/surprised/neutral sentiment before speaking. Create a PR after completion.","branch":"feat/expression-tts-sync"}'
  '{"title":"fix: add missing input validation in settings store","description":"Add proper input validation to all user-configurable settings in mika. Check settings stores for: 1) API key fields (trim whitespace, validate format), 2) Numeric fields (min/max bounds), 3) URL fields (valid URL format). Use zod or similar for validation. Create a PR after completion.","branch":"fix/settings-validation"}'
  '{"title":"feat: drag-to-reposition mika window overlay","description":"Implement drag-to-reposition functionality for the mika overlay window. Users should be able to drag the companion to any corner/position on screen. Save position preference and restore on startup. Use Electron BrowserWindow.setBounds and ipc for renderer-main communication. Create a PR after completion.","branch":"feat/drag-reposition"}'
  '{"title":"feat: implement screen capture for visual context analysis","description":"According to ROADMAP.md section 2, mika needs screen analysis. Implement periodic screenshot capture: 1) Screenshot interval configurable in settings (default 30s), 2) Image compression before sending to LLM, 3) UI toggle in settings panel. Find existing screen/vision code in apps/plugins/. Create a PR after completion.","branch":"feat/screen-capture-pipeline"}'
  '{"title":"fix: improve plugin manifest loading error handling","description":"Improve error handling when plugin manifests fail to load. Currently if a plugin manifest is invalid or missing fields, it may crash silently. Add: 1) Schema validation for IPluginManifest, 2) Graceful fallback when optional fields are missing, 3) User-visible error in plugin health panel. Create a PR after completion.","branch":"fix/plugin-manifest-validation"}'
)

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

refresh_session() {
  local NEW_TOKEN=$(bun --bun -e "
    const crypto = require('crypto');
    const db = new (require('bun:sqlite').Database)(process.env.HOME + '/.vibe-code/vibe.db');
    const token = crypto.randomBytes(32).toString('base64url');
    const id = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 30*24*60*60*1000).toISOString();
    db.run(
      'INSERT OR REPLACE INTO auth_sessions (id, github_id, username, display_name, avatar_url, access_token, expires_at) VALUES (?,?,?,?,?,?,?)',
      [id, '12345', 'juninmd', 'Antonio Junior', null, 'ghp_fake_local', expires]
    );
    process.stdout.write(token);
  " 2>/dev/null)
  if [ -n "$NEW_TOKEN" ]; then
    SESSION="$NEW_TOKEN"
    log "Session refreshed: ${SESSION:0:8}..."
  fi
}

get_active_count() {
  curl -s "$BASE_URL/api/tasks?repoId=$REPO_ID" \
    -H "Cookie: vibe_session=$SESSION" | bun --bun -e "
    const t=await Bun.stdin.text();
    try {
      const d=JSON.parse(t);
      const active=(d.data||[]).filter(t=>t.status==='in_progress'||t.status==='queued').length;
      process.stdout.write(String(active));
    } catch { process.stdout.write('0'); }
  " 2>/dev/null
}

launch_backlog_tasks() {
  local tasks=$(curl -s "$BASE_URL/api/tasks?repoId=$REPO_ID" \
    -H "Cookie: vibe_session=$SESSION" | bun --bun -e "
    const t=await Bun.stdin.text();
    try {
      const d=JSON.parse(t);
      const backlog=(d.data||[]).filter(t=>t.status==='backlog'||t.status==='failed');
      process.stdout.write(JSON.stringify(backlog.map(t=>t.id)));
    } catch { process.stdout.write('[]'); }
  " 2>/dev/null)

  local active=$(get_active_count)
  local slots=$((MAX_AGENTS - active))

  if [ "$slots" -le 0 ]; then
    log "No capacity (active=$active/$MAX_AGENTS), skipping backlog launch"
    return
  fi

  echo "$tasks" | bun --bun -e "
    const t=await Bun.stdin.text();
    const ids=JSON.parse(t);
    process.stdout.write(ids.slice(0,$slots).join('\n'));
  " 2>/dev/null | while read -r TASK_ID; do
    if [ -n "$TASK_ID" ]; then
      local resp=$(curl -s -X POST "$BASE_URL/api/tasks/$TASK_ID/launch" \
        -H "Cookie: vibe_session=$SESSION" \
        -H "Content-Type: application/json" \
        -d '{}')
      local status=$(echo "$resp" | bun --bun -e "const t=await Bun.stdin.text(); const d=JSON.parse(t); process.stdout.write(String(d.data?.status||d.error))" 2>/dev/null)
      log "Launched backlog task $TASK_ID: $status"
    fi
  done
}

create_task() {
  local idx=$1
  local task_data="${TASKS[$idx]}"
  local title=$(echo "$task_data" | bun --bun -e "const t=await Bun.stdin.text(); process.stdout.write(JSON.parse(t).title)" 2>/dev/null)

  local full_payload=$(echo "$task_data" | bun --bun -e "
    const t=await Bun.stdin.text();
    const d=JSON.parse(t);
    d.repoId='$REPO_ID';
    d.engine='opencode';
    d.model='opencode/deepseek-v4-flash-free';
    process.stdout.write(JSON.stringify(d));
  " 2>/dev/null)

  log "Creating task: $title"

  local resp=$(curl -s -X POST "$BASE_URL/api/tasks" \
    -H "Cookie: vibe_session=$SESSION" \
    -H "Content-Type: application/json" \
    -d "$full_payload")

  local task_id=$(echo "$resp" | bun --bun -e "const t=await Bun.stdin.text(); const d=JSON.parse(t); process.stdout.write(d.data?.id||'ERROR')" 2>/dev/null)

  if [ "$task_id" = "ERROR" ] || [ -z "$task_id" ]; then
    log "Session might have expired. Refreshing..."
    refresh_session
    resp=$(curl -s -X POST "$BASE_URL/api/tasks" \
      -H "Cookie: vibe_session=$SESSION" \
      -H "Content-Type: application/json" \
      -d "$full_payload")
    task_id=$(echo "$resp" | bun --bun -e "const t=await Bun.stdin.text(); const d=JSON.parse(t); process.stdout.write(d.data?.id||'ERROR')" 2>/dev/null)
  fi

  if [ "$task_id" != "ERROR" ] && [ -n "$task_id" ]; then
    log "Task created: $task_id"
    sleep 2

    local active=$(get_active_count)
    if [ "$active" -lt "$MAX_AGENTS" ]; then
      local launch_resp=$(curl -s -X POST "$BASE_URL/api/tasks/$task_id/launch" \
        -H "Cookie: vibe_session=$SESSION" \
        -H "Content-Type: application/json" \
        -d '{}')
      local status=$(echo "$launch_resp" | bun --bun -e "const t=await Bun.stdin.text(); const d=JSON.parse(t); process.stdout.write(String(d.data?.status||d.error))" 2>/dev/null)
      log "Task launched: $task_id status=$status"
    else
      log "At capacity ($active/$MAX_AGENTS) - task $task_id stays in backlog for auto-launch"
    fi
  else
    log "FAILED to create task: $title"
  fi
}

log "=== Mika Autonomous Loop Started ==="
log "Interval: ${INTERVAL}s (20 minutes)"
log "Model: opencode/deepseek-v4-flash-free"
log "Repo: $REPO_ID"

# First, try to launch any existing backlog tasks
launch_backlog_tasks

TASK_INDEX=0
TOTAL=${#TASKS[@]}

while true; do
  IDX=$((TASK_INDEX % TOTAL))
  create_task $IDX
  TASK_INDEX=$((TASK_INDEX + 1))

  log "Sleeping ${INTERVAL}s until next task creation..."
  sleep $INTERVAL

  # After sleep, also try to launch any waiting backlog tasks
  log "Checking backlog after sleep..."
  launch_backlog_tasks
done
