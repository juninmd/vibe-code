import { useQuery } from "@tanstack/react-query";
import { MANUAL_TASK_TAG, REMOTE_SESSION_TAG, SUPERVISED_TAG } from "@vibe-code/shared";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { withSupervised } from "./approvals";
import {
  DEMO_PROJECTS,
  demoReply,
  initialSessions,
  messagesFromLogs,
  projectFromRepo,
  type Session,
  sessionFromTask,
} from "./model";
import { useApprovals } from "./useApprovals";

const STORAGE = "vibe-unified-prototype-v1";
const SUPERVISED_KEY = "rw-supervised";
function readSupervised(): boolean {
  try {
    return localStorage.getItem(SUPERVISED_KEY) === "1";
  } catch {
    return false;
  }
}

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

export function useRemoteWorkspace() {
  const [source, setSource] = useState<"demo" | "server">(() =>
    new URLSearchParams(window.location.search).get("demo") === "1" ? "demo" : "server"
  );
  const [demoSessions, setDemoSessions] = useState(readSessions);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("session") ?? "unified"
  );
  const [projectId, setProjectId] = useState("control");
  const [engine, setEngine] = useState(() => preferences().engine);
  const [model, setModel] = useState(() => preferences().model);
  const [effort, setEffort] = useState(() => preferences().effort);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [branch, setBranch] = useState("main");
  /** Model chosen for the next turn of the open session (empty = keep the session's). */
  const [nextModel, setNextModel] = useState("");
  /** Engine that takes over the open session on the next turn (empty = keep the session's). */
  const [nextEngine, setNextEngine] = useState("");
  /** New sessions ask before edits and commands (OpenCode only). */
  const [supervised, setSupervisedState] = useState(() => readSupervised());
  const [savingDefault, setSavingDefault] = useState(false);
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
    refetchInterval: server ? 3_000 : false,
    retry: false,
  });
  const projects = server ? (data.data?.repos ?? []).map(projectFromRepo) : DEMO_PROJECTS;
  const sessions = server
    ? (data.data?.tasks ?? []).filter((t) => t.status !== "archived").map(sessionFromTask)
    : demoSessions;
  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const approvals = useApprovals(sessions, server);
  const project = projects.find((p) => p.id === (selected?.projectId ?? projectId)) ?? projects[0];
  const engines = useQuery({
    queryKey: ["prototype-engines"],
    queryFn: api.engines.list,
    enabled: server,
    staleTime: 60_000,
  });
  const branches = useQuery({
    queryKey: ["remote-branches", project?.id],
    queryFn: () => api.repos.branches(project?.id ?? ""),
    enabled: server && !!project && !selected,
    retry: false,
  });
  const history = useQuery({
    queryKey: ["unified-prototype", "logs", selectedId],
    queryFn: async () => {
      if (!selectedId) return [];
      // Rewound turns were undone: they leave the conversation.
      const runs = (await api.tasks.runs(selectedId)).filter((run) => !run.rewoundAt);
      const logs = await Promise.all(
        runs
          .slice(0, 5)
          .reverse()
          .map((run) => api.runs.logs(run.id))
      );
      return logs.flat();
    },
    enabled: server && !!selected,
    refetchInterval: server && selected?.status === "working" ? 1_000 : 5_000,
    retry: false,
  });
  const messages =
    server && selected
      ? messagesFromLogs(selected, history.data ?? [])
      : (selected?.messages ?? []);

  // A new session starts with the project's default engine/model, like CC's per-repo default.
  const projectDefaultKey = `${project?.id ?? ""}|${project?.defaultEngine ?? ""}|${project?.defaultModel ?? ""}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: apply only when the project (or its default) changes.
  useEffect(() => {
    if (selectedId && sessions.some((s) => s.id === selectedId)) return;
    if (!project?.defaultModel && !project?.defaultEngine) return;
    if (project.defaultEngine) setEngine(project.defaultEngine);
    if (project.defaultModel) {
      const [base, variant] = project.defaultModel.split("#");
      setModel(base);
      setEffort(variant ?? "");
    }
  }, [projectDefaultKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a model switch belongs to one session.
  useEffect(() => {
    setNextModel("");
    setNextEngine("");
  }, [selectedId]);
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
    const url = new URL(window.location.href);
    url.searchParams.set("session", id);
    window.history.replaceState(null, "", url);
    const session = sessions.find((s) => s.id === id);
    if (session) setProjectId(session.projectId);
  };
  const newSession = (repoId?: string) => {
    setSelectedId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("session");
    window.history.replaceState(null, "", url);
    const targetId = repoId ?? selected?.projectId ?? project?.id ?? projectId;
    setProjectId(targetId);
    setBranch(projects.find((p) => p.id === targetId)?.branch ?? "main");
  };
  const changeSource = (next: "demo" | "server") => {
    const url = new URL(window.location.href);
    if (next === "demo") url.searchParams.set("demo", "1");
    else url.searchParams.delete("demo");
    url.searchParams.delete("session");
    window.history.replaceState(null, "", url);
    setSource(next);
    setSelectedId(next === "demo" ? "unified" : null);
    setProjectId(next === "demo" ? "control" : "");
    setBranch(next === "demo" ? "main" : "");
  };
  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || !project || selected?.status === "working" || sending) return false;
    if (server) {
      setSending(true);
      setSendError(null);
      try {
        if (selected) {
          await api.tasks.message(selected.id, prompt, {
            model: nextModel || undefined,
            engine: nextEngine || undefined,
          });
          setNextModel("");
          setNextEngine("");
          await Promise.all([data.refetch(), history.refetch()]);
          return true;
        }
        if (!engines.data)
          throw new Error("Aguarde o carregamento dos harnesses e tente novamente.");
        const conversational =
          engines.data?.find((item) => item.name === engine)?.supportsResume === true;
        const task = await api.tasks.create({
          repoId: project.id,
          description: prompt,
          engine,
          ...(model
            ? {
                model: engine === "opencode" && effort ? `${model.split("#")[0]}#${effort}` : model,
              }
            : {}),
          baseBranch: branch || project.branch,
          tags: [
            MANUAL_TASK_TAG,
            ...(conversational ? [REMOTE_SESSION_TAG] : []),
            ...(conversational && supervised && engine === "opencode" ? [SUPERVISED_TAG] : []),
          ],
        });
        // Keep the created session selected even if launching fails, so retry cannot duplicate it.
        setSelectedId(task.id);
        const url = new URL(window.location.href);
        url.searchParams.set("session", task.id);
        window.history.replaceState(null, "", url);
        await data.refetch();
        if (conversational) await api.tasks.launch(task.id);
        await data.refetch();
        return true;
      } catch (error) {
        setSendError(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        setSending(false);
      }
    }
    const id = selected?.id ?? `demo-${crypto.randomUUID()}`;
    const message = {
      id: crypto.randomUUID(),
      role: "user" as const,
      text: prompt,
      at: new Date().toISOString(),
    };
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
                    {
                      id: crypto.randomUUID(),
                      role: "assistant",
                      text: demoReply(prompt),
                      at: new Date().toISOString(),
                    },
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
  const stop = async () => {
    if (!selected) return;
    if (server) {
      setSending(true);
      setSendError(null);
      try {
        await api.tasks.cancel(selected.id);
        await data.refetch();
      } catch (error) {
        setSendError(error instanceof Error ? error.message : String(error));
      } finally {
        setSending(false);
      }
      return;
    }
    const timer = timers.current.get(selected.id);
    if (timer) clearTimeout(timer);
    timers.current.delete(selected.id);
    setDemoSessions((all) =>
      all.map((s) => (s.id === selected.id ? { ...s, status: "waiting" } : s))
    );
  };
  /** Save the composer's engine/model as this project's default for new sessions. */
  const saveProjectDefault = async (clear = false) => {
    if (!server || !project) return;
    setSavingDefault(true);
    setSendError(null);
    try {
      await api.repos.updateDefaults(
        project.id,
        clear
          ? { defaultEngine: null, defaultModel: null }
          : {
              defaultEngine: engine,
              defaultModel: model ? (effort ? `${model}#${effort}` : model) : null,
            }
      );
      await data.refetch();
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingDefault(false);
    }
  };
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  /** "Create PR": commit the session's work, push its branch and open/update the PR. */
  const createPullRequest = async () => {
    if (!server || !selected || selected.status === "working" || publishing) return null;
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await api.tasks.pullRequest(selected.id);
      await Promise.all([data.refetch(), history.refetch()]);
      return result;
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setPublishing(false);
    }
  };
  const setSupervised = (on: boolean) => {
    setSupervisedState(on);
    try {
      localStorage.setItem(SUPERVISED_KEY, on ? "1" : "0");
    } catch {
      // A preference, not data.
    }
  };
  /** Applies to the open session's next turn, like switching mode in Claude Code. */
  const setSessionSupervised = async (on: boolean) => {
    if (!selected || !server) return;
    setSendError(null);
    try {
      await api.tasks.update(selected.id, { tags: withSupervised(selected.tags ?? [], on) });
      await data.refetch();
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    }
  };
  /** Undo `runId` and later turns; resolves with the undone message, or null on failure. */
  const rewind = async (runId: string) => {
    if (!selected || !server) return null;
    setSendError(null);
    try {
      const { message } = await api.tasks.rewind(selected.id, runId);
      await Promise.all([data.refetch(), history.refetch()]);
      return message;
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
      return null;
    }
  };
  return {
    source,
    server,
    rewind,
    supervised,
    setSupervised,
    setSessionSupervised,
    approvals,
    projects,
    sessions,
    selected,
    project,
    projectId,
    engines,
    branches,
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
    createPullRequest,
    nextModel,
    setNextModel,
    nextEngine,
    setNextEngine,
    saveProjectDefault,
    savingDefault,
    publishing,
    publishError,
  };
}
