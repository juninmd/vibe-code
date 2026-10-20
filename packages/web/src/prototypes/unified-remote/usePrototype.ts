import { useQuery } from "@tanstack/react-query";
import { MANUAL_TASK_TAG } from "@vibe-code/shared";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import {
  DEMO_PROJECTS,
  demoReply,
  initialSessions,
  messagesFromLogs,
  projectFromRepo,
  type Session,
  sessionFromTask,
} from "./model";

const STORAGE = "vibe-unified-prototype-v1";
function preferences(): { engine: string; model: string; effort: string } {
  try {
    return {
      engine: "opencode",
      model: "",
      effort: "",
      ...JSON.parse(localStorage.getItem("vibe-prototype-harness") ?? "{}"),
    };
  } catch {
    return { engine: "opencode", model: "", effort: "" };
  }
}
function readSessions(): Session[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE) ?? "null");
    if (
      Array.isArray(stored) &&
      stored.every(
        (s) =>
          typeof s.id === "string" &&
          typeof s.title === "string" &&
          Array.isArray(s.messages) &&
          Array.isArray(s.changes)
      )
    )
      return stored.map((s) => ({ ...s, status: s.status === "working" ? "waiting" : s.status }));
  } catch {
    /* Start from the candidate fixtures when storage is unavailable. */
  }
  return initialSessions();
}

export function usePrototype() {
  const [source, setSource] = useState<"demo" | "server">(() =>
    new URLSearchParams(window.location.search).get("demo") === "1" ? "demo" : "server"
  );
  const [demoSessions, setDemoSessions] = useState(readSessions);
  const [selectedId, setSelectedId] = useState<string | null>("unified");
  const [projectId, setProjectId] = useState("control");
  const [engine, setEngine] = useState(() => preferences().engine);
  const [model, setModel] = useState(() => preferences().model);
  const [effort, setEffort] = useState(() => preferences().effort);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [branch, setBranch] = useState("main");
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const server = source === "server";
  const data = useQuery({
    queryKey: ["unified-prototype", "server"],
    queryFn: async () => {
      const [repos, tasks] = await Promise.all([api.repos.list(), api.tasks.list()]);
      return { repos, tasks };
    },
    enabled: server,
    staleTime: 10_000,
    refetchInterval: server ? 15_000 : false,
    retry: false,
  });
  const projects = server ? (data.data?.repos ?? []).map(projectFromRepo) : DEMO_PROJECTS;
  const sessions = server
    ? (data.data?.tasks ?? []).filter((t) => t.status !== "archived").map(sessionFromTask)
    : demoSessions;
  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const project = projects.find((p) => p.id === (selected?.projectId ?? projectId)) ?? projects[0];
  const history = useQuery({
    queryKey: ["unified-prototype", "logs", selectedId],
    queryFn: async () => {
      if (!selectedId) return [];
      const runs = await api.tasks.runs(selectedId);
      const logs = await Promise.all(
        runs
          .slice(0, 5)
          .reverse()
          .map((run) => api.runs.logs(run.id))
      );
      return logs.flat();
    },
    enabled: server && !!selected,
    refetchInterval: server && selected?.status === "working" ? 5_000 : false,
    retry: false,
  });
  const messages =
    server && selected
      ? messagesFromLogs(selected, history.data ?? [])
      : (selected?.messages ?? []);

  useEffect(() => {
    try {
      localStorage.setItem("vibe-prototype-harness", JSON.stringify({ engine, model, effort }));
    } catch {
      /* Preferences are optional. */
    }
  }, [engine, model, effort]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(demoSessions));
    } catch {
      /* Preview remains usable without persistence. */
    }
  }, [demoSessions]);
  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
    },
    []
  );
  const selectSession = (id: string) => {
    setSelectedId(id);
    const session = sessions.find((s) => s.id === id);
    if (session) setProjectId(session.projectId);
  };
  const newSession = (repoId?: string) => {
    setSelectedId(null);
    const targetId = repoId ?? selected?.projectId ?? project?.id ?? projectId;
    setProjectId(targetId);
    setBranch(projects.find((p) => p.id === targetId)?.branch ?? "main");
  };
  const changeSource = (next: "demo" | "server") => {
    setSource(next);
    setSelectedId(next === "demo" ? "unified" : null);
    setProjectId(next === "demo" ? "control" : "");
    setBranch(next === "demo" ? "main" : "");
  };
  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || !project || selected?.status === "working" || sending) return false;
    if (server) {
      if (selected) return false;
      setSending(true);
      setSendError(null);
      try {
        const task = await api.tasks.create({
          repoId: project.id,
          description: prompt,
          engine,
          ...(model ? { model } : {}),
          baseBranch: branch || project.branch,
          tags: [MANUAL_TASK_TAG],
        });
        await data.refetch();
        setSelectedId(task.id);
        return true;
      } catch (error) {
        setSendError(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        setSending(false);
      }
    }
    const id = selected?.id ?? `demo-${crypto.randomUUID()}`;
    const message = { id: crypto.randomUUID(), role: "user" as const, text: prompt };
    const current: Session = selected ?? {
      id,
      projectId: project.id,
      title: prompt.split("\n")[0].slice(0, 70),
      description: prompt,
      status: "waiting",
      engine,
      model: model || "Modelo padrão",
      effort,
      branch: branch || project.branch,
      updatedAt: new Date().toISOString(),
      messages: [],
      changes: [],
    };
    setDemoSessions((all) => [
      {
        ...current,
        status: "working",
        messages: [...current.messages, message],
        updatedAt: new Date().toISOString(),
      },
      ...all.filter((s) => s.id !== id),
    ]);
    setSelectedId(id);
    timers.current.set(
      id,
      setTimeout(() => {
        setDemoSessions((all) =>
          all.map((s) =>
            s.id === id
              ? {
                  ...s,
                  status: "waiting",
                  messages: [
                    ...s.messages,
                    { id: crypto.randomUUID(), role: "assistant", text: demoReply(prompt) },
                  ],
                  updatedAt: new Date().toISOString(),
                }
              : s
          )
        );
        timers.current.delete(id);
      }, 850)
    );
    return true;
  };
  const stop = () => {
    if (!selected || server) return;
    const timer = timers.current.get(selected.id);
    if (timer) clearTimeout(timer);
    timers.current.delete(selected.id);
    setDemoSessions((all) =>
      all.map((s) => (s.id === selected.id ? { ...s, status: "waiting" } : s))
    );
  };
  return {
    source,
    server,
    projects,
    sessions,
    selected,
    project,
    projectId,
    setProjectId,
    engine,
    setEngine,
    model,
    setModel,
    effort,
    setEffort,
    sending,
    sendError,
    branch,
    setBranch,
    messages,
    logs: history.data ?? [],
    historyLoading: history.isLoading && server,
    historyError: history.error,
    refreshHistory: history.refetch,
    data,
    selectSession,
    newSession,
    changeSource,
    send,
    stop,
  };
}
