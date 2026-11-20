# Agent runner: local or one pod per task

**Settings → Execução** decides where OpenCode turns execute. A change applies to
the next turn of every session; no restart.

| Mode | Where the agent runs |
| --- | --- |
| Dentro do servidor (default) | A loopback `opencode serve` child process inside the server pod, as before. |
| Um pod por tarefa | One `opencode serve` pod per task, created on the task's first turn and deleted after the configured minutes without a turn. |

The pod option is disabled when the server is not inside a cluster, and saving it
is refused until the image and data PVC are set. Rollback: pick "Dentro do
servidor". Pods already running are still reaped after the switch; by hand:
`kubectl -n harness-remote delete pod -l app.kubernetes.io/component=agent-runner`.

## How the k8s runner works

```text
turn starts
  → PodPool: reuse the task's pod if Running+Ready, else create Secret + Pod
  → wait until Ready (fails fast on ImagePullBackOff / config errors)
  → SDK client talks to http://<podIP>:4096 with the pod's random password
turn ends → pod idles; reaper (every 30 s) deletes it after the idle minutes
next turn → fresh pod resumes the same OpenCode session from the volume
```

- **The repository is not cloned twice.** The server still owns the bare clone and
  the task worktree on the data PVC; the pod mounts only that worktree, its bare
  repository and the task's OpenCode session store (`runner/opencode/<hash>`), at
  the same paths. Diff, checkpoints, rewind, commit, push and the PR keep running
  on the server, so the **GitHub token never enters the runner pod**.
- **Secrets**: the provider env (`OPENCODE_API_KEY`, `OPENCODE_CONFIG_CONTENT`,
  LiteLLM settings) and the serve password go into a per-pod Secret owned by the
  pod (garbage-collected with it), never into the pod spec. Server-only keys are
  already stripped by `agentProcessEnv`; the runner also drops `GITHUB_TOKEN`,
  `GH_TOKEN`, `GIT_ASKPASS`, `GIT_CONFIG_*` (git auth headers), `KUBERNETES_*` and
  service-link variables.
- **Isolation**: no ServiceAccount token, non-root (uid 10001), no privilege
  escalation, all capabilities dropped, `activeDeadlineSeconds` as a hard cap.
  The NetworkPolicy lets only the server reach port 4096.
- A changed provider setting (new key, other provider) replaces an idle pod.
- Approvals, engine handoff and rewind work as in `local`.

## Configuration

Edited in Settings → Execução (`GET/PUT /api/settings/runner`, stored in the
`agent_runner` setting). Env vars only seed the defaults before anything is saved.

| Field | Default env | Default |
| --- | --- | --- |
| Mode | `VIBE_AGENT_RUNNER` | `local` |
| Runner image (needs `opencode` + `git`) | `VIBE_K8S_RUNNER_IMAGE` | — (required for pods) |
| Data PVC (holds `VIBE_CODE_DATA_DIR`) | `VIBE_K8S_PVC` | — (required for pods) |
| Skills PVC (mounted read-only) | `VIBE_K8S_SKILLS_PVC` | — |
| Pull secret | `VIBE_K8S_IMAGE_PULL_SECRET` | — |
| Idle minutes before deletion | `VIBE_K8S_IDLE_MINUTES` | `15` |
| Max pod lifetime, hours (`activeDeadlineSeconds`) | `VIBE_K8S_MAX_LIFETIME_HOURS` | `6` |
| Start timeout, seconds | `VIBE_K8S_START_TIMEOUT_SECONDS` | `180` |
| CPU request / limit | `VIBE_K8S_CPU_REQUEST` / `_LIMIT` | `250m` / `2` |
| Memory request / limit | `VIBE_K8S_MEMORY_REQUEST` / `_LIMIT` | `512Mi` / `4Gi` |

Deployment facts stay in env, not Settings: `VIBE_K8S_NAMESPACE` (default: the
server pod's namespace, which must be the PVC's), `VIBE_K8S_NODE_NAME` (pins pods
to the server's node; required for `ReadWriteOnce` PVCs, set from the downward
API in the manifest) and `VIBE_K8S_SKILLS_DIR` (`/home/vibe/.agents`).

The server needs the `harness-remote` ServiceAccount and the
`harness-remote-agent-runner` Role from `infrastructure/k8s/harness-remote.yaml`
(pods: create/get/list/delete; secrets: create/patch/delete).

## Limits

- Only OpenCode over `serve` uses the runner. `VIBE_OPENCODE_TRANSPORT=cli`, other
  engines and the interactive terminal still run in the server pod.
- The pool lives in memory: after a server restart the old pods are deleted and
  the next turn starts a new one (the session resumes from the volume).
- `VIBE_CODE_MAX_AGENTS` still caps concurrent turns; raise it once runner pods
  carry the load, since the server pod no longer runs the agent itself.
- The session board reads OpenCode sessions from the server's own store, so turns that ran in runner pods (stored under `runner/opencode/`) do not appear there.
- `runner/opencode/<hash>` session stores are kept after the pod goes (the next turn
  resumes from them) and are not yet removed with the task's workspace.
- The Role cannot be narrowed with `resourceNames` (runner Secret names are random),
  so the server can also patch or delete other Secrets in its namespace. Creating
  pods already lets it read them; keep the namespace dedicated to vibe-code.
