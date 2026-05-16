export interface VibeRepo {
  id: string;
  url: string;
  status: string;
}

export interface VibeTask {
  id: string;
  status: string;
  latestRun?: { id: string } | null;
}

function authHeaders(): Record<string, string> {
  const token = process.env.VIBE_SESSION_TOKEN;
  if (token) return { Cookie: `vibe_session=${token}` };
  return {};
}

async function apiFetch(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${url}: ${body}`);
  }
  return res.json();
}

export async function listRepos(serverUrl: string): Promise<VibeRepo[]> {
  const data = (await apiFetch(`${serverUrl}/api/repos`)) as { data: VibeRepo[] };
  return data.data;
}

export async function ensureRepo(serverUrl: string, url: string): Promise<string> {
  const repos = await listRepos(serverUrl);
  const existing = repos.find((r) => r.url === url);
  if (existing) return existing.id;
  const created = (await apiFetch(`${serverUrl}/api/repos`, {
    method: "POST",
    body: JSON.stringify({ url }),
  })) as { data: VibeRepo };
  return created.data.id;
}

export async function waitReady(
  serverUrl: string,
  repoId: string,
  timeoutMs = 120_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = (await apiFetch(`${serverUrl}/api/repos/${repoId}`)) as {
      data: VibeRepo;
    };
    if (resp.data.status === "ready") return;
    if (resp.data.status === "error") throw new Error(`Repo ${repoId} failed to clone`);
    await Bun.sleep(2000);
  }
  throw new Error(`Repo ${repoId} not ready after ${timeoutMs}ms`);
}

export async function createTask(
  serverUrl: string,
  opts: { repoId: string; title: string; description?: string; engine?: string }
): Promise<VibeTask> {
  const resp = (await apiFetch(`${serverUrl}/api/tasks`, {
    method: "POST",
    body: JSON.stringify({
      title: opts.title,
      repoId: opts.repoId,
      description: opts.description,
      engine: opts.engine ?? "opencode",
    }),
  })) as { data: VibeTask };
  return resp.data;
}

export async function launchTask(serverUrl: string, taskId: string): Promise<string> {
  const resp = (await apiFetch(`${serverUrl}/api/tasks/${taskId}/launch`, {
    method: "POST",
    body: JSON.stringify({}),
  })) as { data: { id: string } };
  return resp.data.id; // runId
}

export async function watchTask(
  serverUrl: string,
  taskId: string,
  timeoutMs = 30 * 60 * 1000
): Promise<"completed" | "failed" | "timeout"> {
  return new Promise((resolve) => {
    const wsUrl = `${serverUrl.replace(/^http/, "ws")}/ws`;
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      resolve("timeout");
    }, timeoutMs);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "subscribe", taskId }));
    });

    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          type: string;
          task?: { id: string; status: string };
        };
        if (msg.type === "task_updated" && msg.task?.id === taskId) {
          const s = msg.task.status;
          if (s === "done" || s === "completed") {
            clearTimeout(timer);
            ws.close();
            resolve("completed");
          } else if (s === "failed") {
            clearTimeout(timer);
            ws.close();
            resolve("failed");
          }
        }
      } catch {
        // ignore malformed
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timer);
      resolve("failed");
    });
  });
}

export async function getTaskLogs(serverUrl: string, runId: string, lines = 100): Promise<string> {
  const resp = (await apiFetch(`${serverUrl}/api/runs/${runId}/logs?limit=${lines}`)) as {
    data: Array<{ content: string }>;
  };
  return resp.data.map((l) => l.content).join("\n");
}
