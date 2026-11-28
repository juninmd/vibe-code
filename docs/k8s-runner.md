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
  the same paths. Diff, checkpoints, rewind and the "Criar PR" button keep running
  on the server.
- **PRs from inside the pod** ("Agente abre PRs de dentro do pod", on by default):
  the image ships `git` and `gh`, and the pod receives the signed-in user's GitHub
  token as `GH_TOKEN`/`GITHUB_TOKEN` plus git's auth header (`GIT_CONFIG_*`), so the
  agent can `git push` and `gh pr create` itself, as that user. Turned off, every
  GitHub credential stays on the server and PRs go through "Criar PR". A new
  login (new token) replaces the task's idle pod.
- **Secrets**: the provider env (`OPENCODE_API_KEY`, `OPENCODE_CONFIG_CONTENT`,
  LiteLLM settings) and the serve password go into a per-pod Secret owned by the
  pod (garbage-collected with it), never into the pod spec. Server-only keys are
  already stripped by `agentProcessEnv`; the runner also drops `GIT_ASKPASS`,
  `KUBERNETES_*` and service-link variables, and the GitHub credentials above
  when forwarding is off.
- **Isolation**: no ServiceAccount token, non-root (uid 10001), no privilege
  escalation, all capabilities dropped, `activeDeadlineSeconds` as a hard cap.
  The namespace enforces Pod Security `restricted`, so neither the server nor a
  pod it creates can run as root, mount host paths or add capabilities.
- **Network**: `agent-runner-ingress` lets only the server reach port 4096;
  `agent-runner-egress` lets a runner reach DNS and the public internet only, so
  it cannot call the Kubernetes API, another user's runner, a cluster Service, the
  node or the home LAN. An in-cluster model gateway (LiteLLM) must be allowed
  explicitly; the manifest has a commented rule for it.
- **Per user**: a pod carries `vibe-code/owner=<hash of the workspace>`. Each user
  may hold "Pods por usuário" pods at once; a new task frees that user's oldest
  idle pod, and is refused (with the reason) only when all of theirs are mid-turn.
  Users never share a pod, a Secret or a mount.
- **Resources**: CPU, memory and ephemeral-storage limits per pod (the worktree
  lives on the PVC; the limit covers the image layer, `/tmp` and caches). The
  namespace `ResourceQuota` caps the total and the `LimitRange` caps one container.
- **Image**: `imagePullPolicy: IfNotPresent` and the server's node, so the
  multi-GB image the server already runs is reused instead of re-pulled.
- A changed provider setting (new key, other provider) replaces an idle pod.
- Approvals, engine handoff and rewind work as in `local`.

## Tools in the runner image

The default image (`Dockerfile`) is both the server and the runner image. It ships
git, curl, wget, jq, make, ripgrep, gh, Node 22 (npm, pnpm, yarn), bun,
python3/pip, uv, Docker CLI (+ buildx, compose; no daemon in the pod, set
`DOCKER_HOST` to use one), gcloud/bq/gsutil, Go, Rust/cargo, Java, Ruby, and the
scanners gitleaks, trivy, semgrep and trufflehog. `GO_VERSION`, `UV_VERSION` and
`SEMGREP_VERSION` are build args. `go install` and `cargo install` work as the
runtime user.

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
| Agent opens PRs from the pod (user's GitHub token) | `VIBE_K8S_FORWARD_GITHUB_TOKEN` | `true` |
| CPU request / limit | `VIBE_K8S_CPU_REQUEST` / `_LIMIT` | `250m` / `2` |
| Memory request / limit | `VIBE_K8S_MEMORY_REQUEST` / `_LIMIT` | `512Mi` / `4Gi` |
| Scratch disk limit (ephemeral-storage) | `VIBE_K8S_EPHEMERAL_STORAGE_LIMIT` | `10Gi` |
| Pods per user at once | `VIBE_K8S_MAX_PODS_PER_USER` | `2` |

Deployment facts stay in env, not Settings: `VIBE_K8S_NAMESPACE` (default: the
server pod's namespace, which must be the PVC's), `VIBE_K8S_NODE_NAME` (required node affinity to
the server's node; required for `ReadWriteOnce` PVCs, set from the downward
API in the manifest) and `VIBE_K8S_SKILLS_DIR` (`/home/vibe/.agents`).

The server needs the `harness-remote` ServiceAccount and the
`harness-remote-agent-runner` Role from `infrastructure/k8s/harness-remote.yaml`
(pods: create/get/list/delete; secrets: create/patch/delete).

## Two ways to run sessions

| | Dentro do servidor | Um pod por tarefa |
| --- | --- | --- |
| Process | child of the server pod | its own pod |
| Users | share the server pod | one pod per task, owner-labelled, capped per user |
| CPU / memory / disk | the server container's limits (`1` CPU, `3Gi`, `20Gi` scratch) | per pod, from Settings |
| Network | the server's | DNS + public internet only |
| Concurrency | `VIBE_CODE_MAX_AGENTS` | `VIBE_CODE_MAX_AGENTS` + per-user cap + namespace quota |

Use the server mode for a single trusted user; use pods when several users share
one deployment or a task should not be able to touch the server.

## Homologation on k3s

```bash
kubectl apply -f infrastructure/k8s/harness-remote.yaml
kubectl -n harness-remote rollout status deploy/harness-remote
# Settings → Execução → "Um pod por tarefa", save, send a turn, then:
kubectl -n harness-remote get pods -l app.kubernetes.io/component=agent-runner -L vibe-code/owner
kubectl -n harness-remote describe resourcequota harness-remote
# From a runner pod: the API and the LAN are blocked, the internet is not.
kubectl -n harness-remote exec <runner-pod> -- sh -c 'curl -m5 -sk https://kubernetes.default.svc || echo blocked; curl -m5 -sI https://github.com | head -1'
```

Rollback: `kubectl label ns harness-remote pod-security.kubernetes.io/enforce-`
lifts the Pod Security enforcement; `kubectl -n harness-remote delete
networkpolicy/agent-runner-egress resourcequota/harness-remote limitrange/harness-remote`
removes the rest.

## Limits

- Only OpenCode over `serve` uses the runner. `VIBE_OPENCODE_TRANSPORT=cli`, other
  engines and the interactive terminal still run in the server pod.
- The pool lives in memory: after a server restart the old pods are deleted and
  the next turn starts a new one (the session resumes from the volume).
- `VIBE_CODE_MAX_AGENTS` still caps concurrent turns; raise it once runner pods
  carry the load, since the server pod no longer runs the agent itself.
- The session board reads OpenCode sessions from the server's own store, so turns that ran in runner pods (stored under `runner/opencode/`) do not appear there.
- `runner/opencode/<hash>` session stores are kept after the pod goes (the next turn
  resumes from them) and are removed with the task's worktree. Deleting a whole
  repository leaves them behind.
- The data PVC is shared: Kubernetes cannot cap one task's share of it, and a
  `ReadWriteOnce` PVC keeps every runner on the server's node.
- The quota and limit range are sized for one user on one node; raise
  `ResourceQuota/harness-remote` together with the per-user cap. Over the quota,
  pod creation fails and the turn shows the API's message.
- The Role cannot be narrowed with `resourceNames` (runner Secret names are random),
  so the server can also patch or delete other Secrets in its namespace. Creating
  pods already lets it read them; keep the namespace dedicated to vibe-code.
- With `GIT_TOKEN` set on the server, the bare clone's `origin` URL embeds that
  token, and the runner pod mounts the bare repository, so it can read it even
  with forwarding off. Prefer the GitHub login token (header-based) over `GIT_TOKEN`.
