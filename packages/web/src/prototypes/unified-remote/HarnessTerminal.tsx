import { useQuery } from "@tanstack/react-query";
import { HARNESS_ENGINES, type HarnessEngine, type WsServerMessage } from "@vibe-code/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { TaskTerminal, type TaskTerminalHandle } from "../../components/TaskTerminal";
import { publishTerminalEvent } from "../../hooks/terminalBus";
import { useWebSocket } from "../../hooks/useWebSocket";
import { ErrorNotice } from "./ManagementViews";
import type { usePrototype } from "./usePrototype";

export function HarnessTerminal({ workspace }: { workspace: ReturnType<typeof usePrototype> }) {
  const session = workspace.selected;
  const taskId = session?.id ?? "";
  const ref = useRef<TaskTerminalHandle>(null);
  const [model, setModel] = useState(
    session?.model && session.model !== "Modelo padrão" ? session.model : workspace.model
  );
  const [effort, setEffort] = useState(workspace.effort);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [showSkills, setShowSkills] = useState(false);
  const [manualSkills, setManualSkills] = useState<string[] | undefined>();
  const [autoSkills, setAutoSkills] = useState(false);
  const skills = useQuery({
    queryKey: ["prototype-skills", "terminal"],
    queryFn: api.skills.index,
    enabled: showSkills,
    retry: false,
  });
  const state = useQuery({
    queryKey: ["prototype-terminal", taskId],
    queryFn: () => api.terminal.state(taskId),
    enabled: !!taskId,
    refetchInterval: 5_000,
    retry: false,
  });
  const engine = state.data?.engine ?? session?.engine;
  const supported = HARNESS_ENGINES.includes(engine as HarnessEngine);
  const models = useQuery({
    queryKey: ["prototype-harness-models", engine],
    queryFn: () => api.engines.harnessModels(engine ?? ""),
    enabled: supported && !state.data?.live,
    staleTime: 60_000,
    retry: false,
  });
  const selectedModel = models.data?.find((entry) => entry.id === model);
  const selectedEffort = selectedModel?.efforts.includes(effort) ? effort : "";
  const onMessage = useCallback((message: WsServerMessage) => {
    if (message.type === "terminal_opened")
      publishTerminalEvent(message.taskId, {
        kind: "opened",
        runId: message.runId,
        cols: message.cols,
        rows: message.rows,
      });
    if (message.type === "terminal_output")
      publishTerminalEvent(message.taskId, {
        kind: "output",
        chunk: message.chunk,
        replay: message.replay === true,
      });
    if (message.type === "terminal_closed")
      publishTerminalEvent(message.taskId, {
        kind: "closed",
        exitCode: message.exitCode,
        reason: message.reason ?? "exit",
      });
  }, []);
  const socket = useWebSocket(onMessage);
  useEffect(() => {
    if (!taskId) return;
    socket.subscribe(taskId);
    return () => socket.unsubscribe(taskId);
  }, [taskId, socket.subscribe, socket.unsubscribe]);
  const live = state.data?.live ?? false;
  const anotherRun = !live && session?.status === "working";
  const start = async () => {
    if (busy || !supported || !socket.connected) return;
    setBusy(true);
    setError(null);
    try {
      await api.terminal.start(taskId, {
        engine: engine as HarnessEngine,
        ...(model ? { model } : {}),
        ...(selectedEffort ? { effort: selectedEffort } : {}),
        ...(manualSkills
          ? { skills: manualSkills }
          : autoSkills
            ? { skillMode: "auto" as const }
            : {}),
        ...ref.current?.size(),
      });
      await Promise.all([state.refetch(), workspace.data.refetch()]);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rw-harness-terminal">
      <div className="rw-terminal-heading">
        <div>
          <strong>
            {engine === "opencode"
              ? "OpenCode"
              : engine === "claude-code"
                ? "Claude Code"
                : (engine ?? "Harness da sessão")}
          </strong>
          <small>{state.data?.cwd ?? "Workspace preparado ao iniciar"}</small>
        </div>
        <span className={`rw-status-dot ${live && socket.connected ? "working" : "waiting"}`} />
        <span>
          {!socket.connected ? "Reconectando…" : live ? "Terminal conectado" : "Terminal inativo"}
        </span>
      </div>
      <ErrorNotice error={error || state.error} />
      {live ? (
        <>
          <section className="rw-live-terminal" aria-label="Terminal do harness atual">
            <TaskTerminal
              ref={ref}
              taskId={taskId}
              connected={socket.connected}
              onWsSend={(message) => {
                if (socket.connected) socket.send(message);
              }}
            />
          </section>
          <div className="rw-terminal-actions">
            <span>
              {state.data?.model ?? "Modelo padrão"}
              {state.data?.effort ? ` · effort ${state.data.effort}` : ""} · Fechar esta aba mantém
              o harness em execução.
            </span>
            <button
              type="button"
              className="rw-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api.terminal.stop(taskId);
                  await state.refetch();
                  await workspace.data.refetch();
                } catch (error) {
                  setError(error);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Parar harness
            </button>
          </div>
        </>
      ) : (
        <div className="rw-terminal-start">
          <h2>
            {anotherRun ? "Esta sessão já está em execução" : "Continuar no harness da sessão"}
          </h2>
          <p>
            {anotherRun
              ? "A execução atual não possui terminal interativo. Aguarde o run terminar para retomar neste terminal."
              : "O terminal abre no workspace isolado desta sessão. Conversas existentes do harness são retomadas."}
          </p>
          {!supported && (
            <p role="alert">
              Este engine não possui um harness interativo compatível. OpenCode e Claude Code são
              suportados.
            </p>
          )}
          <ErrorNotice error={models.error} />
          <div className="rw-terminal-selectors">
            <label>
              Modelo
              <select
                aria-label="Modelo do terminal"
                disabled={busy || anotherRun || !supported}
                value={model}
                onChange={(event) => {
                  setModel(event.target.value);
                  setEffort("");
                }}
              >
                <option value="">Padrão do harness</option>
                {model && !models.data?.some((entry) => entry.id === model) && (
                  <option value={model}>{model}</option>
                )}
                {models.data?.map((entry) => (
                  <option value={entry.id} key={entry.id}>
                    {entry.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Effort
              <select
                aria-label="Effort do terminal"
                value={selectedEffort}
                disabled={busy || !selectedModel?.efforts.length || anotherRun}
                onChange={(event) => setEffort(event.target.value)}
              >
                <option value="">Padrão do modelo</option>
                {selectedModel?.efforts.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <details
            className="rw-terminal-skill-picker"
            onToggle={(event) => setShowSkills(event.currentTarget.open)}
          >
            <summary>
              Skills desta sessão{" "}
              <span>
                {manualSkills
                  ? `${manualSkills.length} selecionadas`
                  : autoSkills || state.data?.skillMode !== "manual"
                    ? "Seleção automática"
                    : "Plano manual da sessão"}
              </span>
            </summary>
            <p className="rw-section-note">
              O harness inclui as skills ativas da biblioteca. Escolha as necessárias ou mantenha a
              seleção automática pelo objetivo.
            </p>
            <ErrorNotice error={skills.error} />
            {skills.isLoading && <p role="status">Carregando skills…</p>}
            <div className="rw-terminal-skill-options">
              {skills.data?.skills
                .filter((skill) => skill.name !== "vibe-code-orchestrator")
                .map((skill) => (
                  <label key={skill.filePath}>
                    <input
                      type="checkbox"
                      checked={(
                        manualSkills ??
                        (autoSkills ? [] : state.data?.skills) ??
                        []
                      ).includes(skill.name)}
                      onChange={(event) => {
                        const current =
                          manualSkills ?? (autoSkills ? [] : state.data?.skills) ?? [];
                        setManualSkills(
                          event.target.checked
                            ? [...current, skill.name]
                            : current.filter((name) => name !== skill.name)
                        );
                        setAutoSkills(false);
                      }}
                    />
                    <span>
                      <strong>{skill.name}</strong>
                      <small>{skill.description}</small>
                    </span>
                  </label>
                ))}
            </div>
            <button
              type="button"
              className="rw-text-button"
              onClick={() => {
                setManualSkills(undefined);
                setAutoSkills(true);
              }}
            >
              Usar seleção automática
            </button>
          </details>
          <button
            type="button"
            className="rw-button primary"
            disabled={
              busy ||
              !supported ||
              anotherRun ||
              !socket.connected ||
              !state.data ||
              models.isFetching
            }
            onClick={() => void start()}
          >
            {busy
              ? "Preparando harness…"
              : `Iniciar ${engine === "opencode" ? "OpenCode" : engine === "claude-code" ? "Claude Code" : "harness"}`}
          </button>
          <p className="rw-section-note">
            Iniciar executa o agente real no servidor. Modelo e effort são aplicados ao iniciar ou
            retomar.
          </p>
        </div>
      )}
      {!!state.data?.applied.length && (
        <div className="rw-terminal-skills">
          <strong>Skills aplicadas</strong>
          <div className="rw-skill-chips">
            {state.data.applied.map((skill) => (
              <span key={skill.name} title={skill.reasons.join(", ")}>
                {skill.name} · {skill.source}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
