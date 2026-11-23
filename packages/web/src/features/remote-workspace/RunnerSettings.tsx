import { useQuery } from "@tanstack/react-query";
import type { AgentRunnerSettings } from "@vibe-code/shared";
import { useEffect, useState } from "react";
import { api } from "../../api/client";

type Field = keyof AgentRunnerSettings;
const TEXT_FIELDS: [Field, string, string][] = [
  ["image", "Imagem do runner", "ghcr.io/juninmd/vibe-code:latest"],
  ["pvc", "PVC de dados", "harness-remote-data"],
  ["skillsPvc", "PVC de skills (opcional)", "harness-remote-skills"],
  ["imagePullSecret", "Pull secret (opcional)", "ghcr-pull-secret"],
];
const NUMBER_FIELDS: [Field, string, number][] = [
  ["idleMinutes", "Apagar o pod após (min sem turno)", 1],
  ["maxLifetimeHours", "Vida máxima do pod (h)", 0.25],
  ["startTimeoutSeconds", "Tempo para o pod subir (s)", 10],
  ["maxPodsPerUser", "Pods por usuário ao mesmo tempo", 1],
];
const RESOURCE_FIELDS: [Field, string][] = [
  ["cpuRequest", "CPU reservada"],
  ["cpuLimit", "Limite de CPU"],
  ["memoryRequest", "Memória reservada"],
  ["memoryLimit", "Limite de memória"],
  ["ephemeralStorageLimit", "Limite de disco temporário"],
];

/** Settings → Execução: run agents inside the server or in one pod per task. */
export function RunnerSettings() {
  const query = useQuery({
    queryKey: ["runner-settings"],
    queryFn: api.settings.runner.get,
    retry: false,
  });
  const [draft, setDraft] = useState<AgentRunnerSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (query.data && !draft) setDraft(query.data.settings);
  }, [query.data, draft]);

  const status = query.data;
  if (query.error) {
    return (
      <p className="rw-alert" role="alert">
        {(query.error as Error).message}
      </p>
    );
  }
  if (!status || !draft) return <p role="status">Carregando…</p>;

  const set = <K extends Field>(key: K, value: AgentRunnerSettings[K]) =>
    setDraft({ ...draft, [key]: value });
  const save = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await api.settings.runner.update(draft);
      setDraft(saved.settings);
      await query.refetch();
      setNotice(
        saved.settings.runner === "k8s"
          ? "Salvo. O próximo turno de cada sessão roda em um pod próprio."
          : "Salvo. O próximo turno roda dentro do servidor."
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rw-settings-card">
      <div className="rw-card-heading">
        <h2>Onde os agentes rodam</h2>
        <p>
          {status.inCluster
            ? `Servidor no cluster (namespace ${status.namespace}${status.nodeName ? `, nó ${status.nodeName}` : ""}) · ${status.activePods} pod(s) de agente ativo(s).`
            : "Servidor fora de um cluster Kubernetes: só a execução local está disponível."}{" "}
          Vale para o OpenCode; o terminal e as outras engines rodam sempre no servidor.
        </p>
      </div>
      <form
        className="rw-settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset className="rw-runner-modes">
          <legend>Modo de execução</legend>
          <label className="rw-runner-mode">
            <input
              type="radio"
              name="runner"
              checked={draft.runner === "local"}
              onChange={() => set("runner", "local")}
            />
            <span>
              <strong>Dentro do servidor</strong>
              <small>Cada turno roda no próprio pod do vibe-code, como sempre.</small>
            </span>
          </label>
          <label className="rw-runner-mode">
            <input
              type="radio"
              name="runner"
              checked={draft.runner === "k8s"}
              disabled={!status.inCluster}
              onChange={() => set("runner", "k8s")}
            />
            <span>
              <strong>Um pod por tarefa</strong>
              <small>
                Cria um pod com o worktree da tarefa, reaproveita entre turnos e apaga após o tempo
                sem atividade.
              </small>
            </span>
          </label>
        </fieldset>
        {draft.runner === "k8s" && (
          <>
            <div className="rw-field-grid">
              {TEXT_FIELDS.map(([key, label, placeholder]) => (
                <label key={key}>
                  {label}
                  <input
                    value={String(draft[key])}
                    placeholder={placeholder}
                    required={key === "image" || key === "pvc"}
                    onChange={(event) => set(key, event.target.value as never)}
                  />
                </label>
              ))}
            </div>
            <div className="rw-field-grid">
              {NUMBER_FIELDS.map(([key, label, min]) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    min={min}
                    step="any"
                    required
                    value={String(draft[key])}
                    onChange={(event) => set(key, Number(event.target.value) as never)}
                  />
                </label>
              ))}
            </div>
            <label className="rw-runner-mode">
              <input
                type="checkbox"
                checked={draft.forwardGitHubToken}
                onChange={(event) => set("forwardGitHubToken", event.target.checked)}
              />
              <span>
                <strong>Agente abre PRs de dentro do pod</strong>
                <small>
                  O pod recebe o token do GitHub de quem fez login (gh e git push). Desligado, o
                  token fica só no servidor e o PR sai pelo botão "Criar PR".
                </small>
              </span>
            </label>
            <div className="rw-field-grid">
              {RESOURCE_FIELDS.map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    value={String(draft[key])}
                    required
                    onChange={(event) => set(key, event.target.value as never)}
                  />
                </label>
              ))}
            </div>
          </>
        )}
        {error && (
          <p className="rw-alert" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rw-success">
            {notice}
          </p>
        )}
        <button type="submit" className="rw-button primary" disabled={busy}>
          Salvar execução
        </button>
      </form>
    </section>
  );
}
