import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RegistryAssetRecord, SkillsEntry, UpdateSettingsRequest } from "@vibe-code/shared";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../../api/client";
import { Icon } from "./Icon";
import { importRemoteSkills, type SkillImportProgress, uniqueRemoteSkills } from "./importSkills";
import type { usePrototype } from "./usePrototype";

type Workspace = ReturnType<typeof usePrototype>;
export type ManagementPage = "skills" | "plugins" | "agents" | "settings";
const LABELS = { skill: "Skill", agent: "Agente", rule: "Regra", workflow: "Workflow" };
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <p className="rw-alert" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </p>
  ) : null;
}
function useAction() {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const run = async (id: string, work: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(id);
    setError(null);
    setNotice("");
    try {
      await work();
      setNotice(success);
    } catch (error) {
      setError(error);
    } finally {
      setBusy("");
    }
  };
  return { busy, error, notice, run };
}

export function ManagementViews({
  page,
  workspace,
  compact,
  setCompact,
  inspector,
  setInspector,
  onPage,
  onSource,
}: {
  page: ManagementPage;
  workspace: Workspace;
  compact: boolean;
  setCompact: (value: boolean) => void;
  inspector: boolean;
  setInspector: (value: boolean) => void;
  onPage: (page: ManagementPage) => void;
  onSource: (source: "demo" | "server") => void;
}) {
  return (
    <div className="rw-management">
      <header className="rw-page-heading">
        <span className="rw-eyebrow">WORKSPACE / RECURSOS E CONEXÕES</span>
        <h1>
          {
            {
              skills: "Biblioteca de skills",
              plugins: "Plugins remotos",
              agents: "Agentes especializados",
              settings: "Configurações",
            }[page]
          }
        </h1>
        <p>
          {
            {
              skills: "Explore as instruções disponíveis para os seus harnesses.",
              plugins: "Traga skills, agentes e regras do GitHub para o seu ambiente.",
              agents: "Consulte os agentes e as skills que compõem cada especialidade.",
              settings: "Conexões, harnesses e preferências, no mesmo lugar.",
            }[page]
          }
        </p>
      </header>
      <nav className="rw-management-nav" aria-label="Recursos do workspace">
        {(
          [
            ["skills", "Skills"],
            ["plugins", "Plugins remotos"],
            ["agents", "Agentes"],
            ["settings", "Configurações"],
          ] as const
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-current={page === id ? "page" : undefined}
            className={page === id ? "selected" : ""}
            onClick={() => onPage(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="rw-management-content">
        {page === "skills" && <SkillsPage workspace={workspace} />}
        {page === "plugins" && <PluginsPage />}
        {page === "agents" && <AgentsPage />}
        {page === "settings" && (
          <SettingsPage
            workspace={workspace}
            compact={compact}
            setCompact={setCompact}
            inspector={inspector}
            setInspector={setInspector}
            onSource={onSource}
          />
        )}
      </div>
    </div>
  );
}

function SkillsPage({ workspace }: { workspace: Workspace }) {
  const [scope, setScope] = useState("global");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SkillsEntry | null>(null);
  const query = useQuery({
    queryKey: ["prototype-skills", scope, workspace.project?.id],
    queryFn: () =>
      scope === "project" && workspace.server && workspace.project
        ? api.repos.skills(workspace.project.id)
        : api.skills.index(),
    retry: false,
  });
  const content = useQuery({
    queryKey: ["prototype-skill-content", selected?.filePath],
    queryFn: () => api.skills.content(selected?.filePath ?? ""),
    enabled: !!selected && scope === "global",
    retry: false,
  });
  const entries = query.data
    ? [...query.data.skills, ...query.data.agents, ...query.data.rules, ...query.data.workflows]
    : [];
  const filtered = entries.filter(
    (entry) =>
      (category === "all" || entry.category === category) &&
      `${entry.name} ${entry.description}`.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <>
      <div className="rw-page-tools">
        <label className="rw-search">
          <Icon name="search" />
          <input
            aria-label="Buscar skills"
            placeholder="Buscar por nome ou descrição…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select
          aria-label="Categoria da skill"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="all">Todas as categorias</option>
          {Object.entries(LABELS).map(([id, label]) => (
            <option value={id} key={id}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Origem das skills"
          value={scope}
          onChange={(event) => {
            setScope(event.target.value);
            setSelected(null);
          }}
        >
          <option value="global">Ambiente do servidor</option>
          {workspace.server && workspace.project && (
            <option value="project">Projeto: {workspace.project.name}</option>
          )}
        </select>
        <button type="button" className="rw-button" onClick={() => void query.refetch()}>
          Atualizar
        </button>
      </div>
      <ErrorNotice error={query.error} />
      {query.isLoading ? (
        <p role="status">Carregando biblioteca…</p>
      ) : (
        <p className="rw-section-note">
          {filtered.length} recursos ·{" "}
          {scope === "global" ? "Disponíveis no servidor" : "Instruções do repositório"}
        </p>
      )}
      <div className="rw-resource-split">
        <section className="rw-resource-list" aria-label="Catálogo de skills">
          {filtered.map((entry) => (
            <button
              type="button"
              key={entry.filePath}
              className={selected?.filePath === entry.filePath ? "selected" : ""}
              onClick={() => setSelected(entry)}
            >
              <span className="rw-resource-type">{LABELS[entry.category]}</span>
              <strong>{entry.name}</strong>
              <small>{entry.description || "Abra para consultar as instruções."}</small>
            </button>
          ))}
          {!query.isLoading && !query.error && filtered.length === 0 && (
            <p className="rw-empty-card">Nenhum recurso encontrado para este filtro.</p>
          )}
        </section>
        <section className="rw-resource-detail" aria-label="Detalhes da skill">
          {selected ? (
            <>
              <h2>{selected.name}</h2>
              <p className="rw-section-note">{selected.description}</p>
              <code className="rw-path">{selected.filePath}</code>
              <ErrorNotice error={content.error} />
              {content.isLoading ? (
                <p role="status">Carregando instruções…</p>
              ) : scope === "project" ? (
                <p>
                  O catálogo do projeto disponibiliza os metadados. As instruções são aplicadas pelo
                  harness no workspace.
                </p>
              ) : (
                <div className="rw-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {content.data?.content ?? ""}
                  </ReactMarkdown>
                </div>
              )}
            </>
          ) : (
            <div className="rw-detail-placeholder">
              <Icon name="file" size={28} />
              <h2>Conheça as instruções</h2>
              <p>Selecione uma skill para ler o conteúdo e conferir a origem.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function PluginsPage() {
  const client = useQueryClient();
  const [repo, setRepo] = useState("https://github.com/juninmd/skills");
  const [ref, setRef] = useState("");
  const [source, setSource] = useState<{ repo: string; ref: string } | null>(null);
  const [search, setSearch] = useState("");
  const [review, setReview] = useState<RegistryAssetRecord | null>(null);
  const action = useAction();
  const [bulkBusy, setBulkBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [bulk, setBulk] = useState<SkillImportProgress | null>(null);
  const stopBulk = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopBulk.current = true;
    };
  }, []);
  const catalog = useQuery({
    queryKey: ["prototype-plugin-catalog", source],
    queryFn: () => api.skills.plugins.catalog(source?.repo ?? "", source?.ref || undefined),
    enabled: !!source,
    retry: false,
  });
  const installed = useQuery({
    queryKey: ["prototype-plugins"],
    queryFn: api.skills.plugins.list,
    retry: false,
  });
  const content = useQuery({
    queryKey: ["prototype-plugin-review", review?.id, review?.checksum],
    queryFn: () => api.skills.plugins.content(review?.id ?? ""),
    enabled: !!review,
    retry: false,
  });
  const refresh = async () => {
    await installed.refetch();
    await client.invalidateQueries({ queryKey: ["prototype-skills"] });
  };
  const filtered =
    catalog.data?.assets.filter((asset) =>
      `${asset.name} ${asset.path}`.toLowerCase().includes(search.toLowerCase())
    ) ?? [];
  const allSkills = uniqueRemoteSkills(catalog.data?.assets ?? []);
  const importAll = async () => {
    if (!catalog.data || !installed.data || bulkBusy || action.busy) return;
    stopBulk.current = false;
    setStopping(false);
    setBulkBusy(true);
    setBulk({ total: allSkills.length, results: [], current: null, stopped: false });
    try {
      await importRemoteSkills({
        catalog: catalog.data,
        installed: installed.data,
        importSkill: api.skills.plugins.import,
        shouldStop: () => stopBulk.current,
        onProgress: (progress) => {
          if (mounted.current) setBulk(progress);
        },
      });
      await refresh();
    } finally {
      if (mounted.current) setBulkBusy(false);
    }
  };
  return (
    <>
      <section className="rw-settings-card">
        <div className="rw-card-heading">
          <span className="rw-resource-type">GITHUB</span>
          <h2>Adicionar uma fonte</h2>
          <p>
            Consulte o catálogo e importe os recursos que deseja usar. A branch padrão é detectada
            automaticamente.
          </p>
        </div>
        <form
          className="rw-source-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (bulkBusy || action.busy) return;
            setSource({ repo, ref });
            setReview(null);
            setBulk(null);
          }}
        >
          <label>
            Repositório GitHub
            <input
              required
              disabled={bulkBusy}
              aria-label="Repositório GitHub do plugin"
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              placeholder="https://github.com/owner/repo"
            />
          </label>
          <label>
            Branch ou tag <small>opcional</small>
            <input
              aria-label="Referência do plugin"
              disabled={bulkBusy}
              value={ref}
              onChange={(event) => setRef(event.target.value)}
              placeholder="Padrão do repositório"
            />
          </label>
          <button
            type="submit"
            className="rw-button primary"
            disabled={catalog.isFetching || bulkBusy || !!action.busy}
          >
            {catalog.isFetching ? "Consultando…" : "Consultar repositório"}
          </button>
        </form>
      </section>
      <ErrorNotice error={catalog.error || installed.error || action.error} />
      {action.notice && (
        <p className="rw-success" role="status">
          {action.notice}
        </p>
      )}
      {catalog.data && (
        <section className="rw-settings-card">
          <div className="rw-card-heading">
            <h2>{catalog.data.repo}</h2>
            <p>
              {catalog.data.ref} · revisão {catalog.data.commit.slice(0, 8)} ·{" "}
              {catalog.data.assets.length} recursos
            </p>
          </div>
          <div className="rw-bulk-import-actions">
            <button
              type="button"
              className="rw-button primary"
              disabled={
                bulkBusy ||
                !!action.busy ||
                catalog.isFetching ||
                !installed.data ||
                allSkills.length === 0
              }
              onClick={() => void importAll()}
            >
              {bulkBusy ? "Importando skills…" : `Importar todas as skills (${allSkills.length})`}
            </button>
            {bulkBusy && (
              <button
                type="button"
                className="rw-button"
                disabled={stopping}
                onClick={() => {
                  stopBulk.current = true;
                  setStopping(true);
                }}
              >
                {stopping ? "Parando…" : "Parar importação"}
              </button>
            )}
            <p className="rw-section-note">
              Todas as skills do repositório, incluindo as que estão fora do filtro. As já
              importadas são preservadas; as novas aguardam revisão.
            </p>
          </div>
          {bulk && (
            <section
              className="rw-bulk-import-progress"
              aria-label="Progresso da importação de skills"
              aria-busy={bulkBusy}
            >
              <p role="status">
                {bulkBusy
                  ? bulk.current
                    ? `Importando ${bulk.current}…`
                    : "Preparando importação…"
                  : bulk.stopped
                    ? "Importação interrompida."
                    : "Importação concluída."}{" "}
                {bulk.results.length} de {bulk.total} skills processadas.
              </p>
              <progress
                aria-label="Skills processadas"
                max={bulk.total || 1}
                value={bulk.results.length}
              />
              <p>
                {bulk.results.filter((item) => item.status === "imported").length} importadas para
                revisão · {bulk.results.filter((item) => item.status === "skipped").length} já
                importadas · {bulk.results.filter((item) => item.status === "failed").length} com
                falha
              </p>
              {bulkBusy && stopping && (
                <p className="rw-section-note">A importação para após a skill em andamento.</p>
              )}
              <details>
                <summary>Resultado por skill</summary>
                <ul>
                  {bulk.results.map((item) => (
                    <li
                      key={item.path}
                      className={item.status === "failed" ? "rw-import-failed" : ""}
                    >
                      <strong>{item.name}</strong>
                      <span>{item.message}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )}
          <label className="rw-search">
            <Icon name="search" />
            <input
              aria-label="Filtrar plugins remotos"
              placeholder="Filtrar recursos do repositório…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="rw-plugin-catalog">
            {filtered.map((asset) => (
              <div className="rw-plugin-row" key={asset.path}>
                <span className="rw-resource-type">{LABELS[asset.category]}</span>
                <div>
                  <strong>{asset.name}</strong>
                  <small>
                    {asset.path} · {asset.files} arquivos
                  </small>
                </div>
                <button
                  type="button"
                  className="rw-button"
                  disabled={!!action.busy || bulkBusy}
                  onClick={() =>
                    void action.run(
                      asset.path,
                      async () => {
                        if (!catalog.data) return;
                        const imported = await api.skills.plugins.import(
                          catalog.data.repo,
                          catalog.data.commit,
                          asset.path
                        );
                        setReview(imported);
                        await refresh();
                      },
                      "Plugin importado para revisão. Leia as instruções antes de ativar."
                    )
                  }
                >
                  {action.busy === asset.path ? "Importando…" : "Importar"}
                </button>
              </div>
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="rw-section-note">Nenhum recurso compatível encontrado.</p>
          )}
        </section>
      )}
      <section className="rw-settings-card">
        <div className="rw-card-heading">
          <h2>Plugins do ambiente</h2>
          <p>
            Recursos ativos ficam disponíveis na biblioteca e podem ser aplicados às próximas
            execuções.
          </p>
        </div>
        {installed.isLoading && <p role="status">Carregando plugins…</p>}
        {installed.data
          ?.filter((record) => record.reviewStatus !== "rejected")
          .map((record) => (
            <div className="rw-plugin-row" key={record.id}>
              <span
                className={`rw-status-dot ${record.reviewStatus === "active" ? "waiting" : "review"}`}
              />
              <div>
                <strong>{record.name}</strong>
                <small>
                  {record.sourceRepo} · {record.sourceRef.slice(0, 8)} · {record.fileCount ?? 1}{" "}
                  arquivos · {record.reviewStatus === "active" ? "Ativo" : "Aguardando revisão"}
                </small>
              </div>
              <button type="button" className="rw-button" onClick={() => setReview(record)}>
                Revisar
              </button>
              <button
                type="button"
                className="rw-text-button"
                disabled={!!action.busy || bulkBusy}
                onClick={() =>
                  void action.run(
                    record.id,
                    async () => {
                      await api.skills.registry.uninstall(record.id);
                      if (review?.id === record.id) setReview(null);
                      await refresh();
                    },
                    "Plugin removido do ambiente."
                  )
                }
              >
                Remover
              </button>
            </div>
          ))}
        {!installed.isLoading &&
          !installed.data?.some((record) => record.reviewStatus !== "rejected") && (
            <p className="rw-section-note">
              Nenhum plugin importado. Consulte uma fonte GitHub acima.
            </p>
          )}
      </section>
      {review && (
        <section className="rw-settings-card" aria-label="Revisão do plugin">
          <div className="rw-card-heading">
            <h2>Revisar {review.name}</h2>
            <p>
              {review.fileCount ?? 1} arquivos · SHA-256 {review.checksum.slice(0, 16)}…
            </p>
            <a
              href={review.sourceUrl
                .replace("raw.githubusercontent.com", "github.com")
                .replace(`/${review.sourceRef}/`, `/blob/${review.sourceRef}/`)}
              target="_blank"
              rel="noreferrer"
            >
              Conferir origem no GitHub ↗
            </a>
          </div>
          <ErrorNotice error={content.error} />
          {content.isLoading ? (
            <p role="status">Carregando conteúdo…</p>
          ) : (
            <pre className="rw-plugin-preview">{content.data?.content}</pre>
          )}
          {review.reviewStatus === "pending_review" && (
            <div className="rw-form-actions">
              <button
                type="button"
                className="rw-button primary"
                disabled={!!action.busy || bulkBusy || !content.data}
                onClick={() =>
                  void action.run(
                    "approve",
                    async () => {
                      const updated = await api.skills.plugins.approve(review.id);
                      setReview(updated);
                      await refresh();
                    },
                    "Plugin ativado e disponível na biblioteca."
                  )
                }
              >
                Ativar plugin
              </button>
              <button
                type="button"
                className="rw-button"
                disabled={!!action.busy || bulkBusy}
                onClick={() =>
                  void action.run(
                    "reject",
                    async () => {
                      await api.skills.plugins.reject(review.id);
                      setReview(null);
                      await refresh();
                    },
                    "Plugin rejeitado."
                  )
                }
              >
                Rejeitar
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}

function AgentsPage() {
  const [search, setSearch] = useState("");
  const [slug, setSlug] = useState("");
  const query = useQuery({
    queryKey: ["prototype-agent-templates"],
    queryFn: api.agentTemplates.list,
    retry: false,
  });
  const selected = query.data?.find((agent) => agent.slug === slug);
  return (
    <>
      <label className="rw-search">
        <Icon name="search" />
        <input
          aria-label="Buscar agentes"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar especialidades…"
        />
      </label>
      <ErrorNotice error={query.error} />
      {query.isLoading && <p role="status">Carregando agentes…</p>}
      <div className="rw-resource-split">
        <div className="rw-resource-list">
          {query.data
            ?.filter((agent) =>
              `${agent.name} ${agent.description}`.toLowerCase().includes(search.toLowerCase())
            )
            .map((agent) => (
              <button
                type="button"
                className={slug === agent.slug ? "selected" : ""}
                key={agent.slug}
                onClick={() => setSlug(agent.slug)}
              >
                <span className="rw-resource-type">{agent.category ?? "Agente"}</span>
                <strong>{agent.name}</strong>
                <small>{agent.description}</small>
              </button>
            ))}
        </div>
        <section className="rw-resource-detail">
          {selected ? (
            <>
              <h2>{selected.name}</h2>
              <p>{selected.description}</p>
              <div className="rw-skill-chips">
                {selected.skills.map((skill) => (
                  <span key={skill.source_url}>{skill.cached_name}</span>
                ))}
              </div>
              <div className="rw-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.instructions}</ReactMarkdown>
              </div>
            </>
          ) : (
            <div className="rw-detail-placeholder">
              <Icon name="activity" size={28} />
              <h2>Agentes e suas instruções</h2>
              <p>
                Selecione uma especialidade para consultar o comportamento e as skills associadas.
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function ProjectSettings({ workspace }: { workspace: Workspace }) {
  const [url, setUrl] = useState("");
  const action = useAction();
  const projects = useQuery({
    queryKey: ["prototype-connected-repos"],
    queryFn: api.repos.list,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.some((repo) => repo.status === "cloning" || repo.status === "pending")
        ? 3000
        : false,
  });
  return (
    <section className="rw-settings-card">
      <div className="rw-card-heading">
        <h2>Projetos conectados</h2>
        <p>
          Adicione um repositório para desenvolver em sessões isoladas. O acesso ao GitHub usa a
          conexão configurada no servidor.
        </p>
      </div>
      <form
        className="rw-settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(
            "add",
            async () => {
              await api.repos.create({ url: url.trim() });
              setUrl("");
              await projects.refetch();
              if (workspace.server) await workspace.data.refetch();
            },
            "Projeto adicionado ao ambiente."
          );
        }}
      >
        <label>
          URL ou caminho Git
          <input
            required
            aria-label="Repositório do projeto"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://github.com/owner/projeto"
          />
        </label>
        <button type="submit" className="rw-button primary" disabled={!url.trim() || !!action.busy}>
          {action.busy ? "Adicionando…" : "Adicionar projeto"}
        </button>
      </form>
      <ErrorNotice error={action.error || projects.error} />
      {action.notice && (
        <p role="status" className="rw-success">
          {action.notice}
        </p>
      )}
      <div className="rw-connected-projects">
        {projects.data?.map((repo) => (
          <div className="rw-plugin-row" key={repo.id}>
            <Icon name="folder" />
            <div>
              <strong>{repo.name}</strong>
              <small>
                {repo.defaultBranch} ·{" "}
                {repo.status === "ready"
                  ? "Pronto para novas sessões"
                  : repo.status === "error"
                    ? (repo.errorMessage ?? "Falha ao clonar")
                    : "Preparando repositório…"}
              </small>
            </div>
          </div>
        ))}
        {projects.isLoading && <p role="status">Carregando projetos…</p>}
        {projects.data?.length === 0 && (
          <p className="rw-section-note">Nenhum projeto conectado.</p>
        )}
      </div>
    </section>
  );
}

function SettingsPage({
  workspace,
  compact,
  setCompact,
  inspector,
  setInspector,
  onSource,
}: {
  workspace: Workspace;
  compact: boolean;
  setCompact: (value: boolean) => void;
  inspector: boolean;
  setInspector: (value: boolean) => void;
  onSource: (source: "demo" | "server") => void;
}) {
  const [section, setSection] = useState("general");
  const [token, setToken] = useState("");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [maxAgents, setMaxAgents] = useState("");
  const [litellmUrl, setLitellmUrl] = useState<string | null>(null);
  const [litellmEnabled, setLitellmEnabled] = useState<boolean | null>(null);
  const [mcp, setMcp] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["prototype-settings"],
    queryFn: api.settings.get,
    retry: false,
  });
  const engines = useQuery({
    queryKey: ["prototype-engines"],
    queryFn: api.engines.list,
    enabled: section === "harness",
    retry: false,
  });
  const models = useQuery({
    queryKey: ["prototype-harness-models", workspace.engine],
    queryFn: () => api.engines.harnessModels(workspace.engine),
    enabled: section === "harness",
    retry: false,
    staleTime: 60_000,
  });
  const selectedModel = models.data?.find((model) => model.id === workspace.model);
  const action = useAction();
  const save = (data: UpdateSettingsRequest, reset?: () => void) =>
    action.run(
      "save",
      async () => {
        await api.settings.update(data);
        reset?.();
        await query.refetch();
      },
      "Configuração salva no servidor."
    );
  return (
    <>
      <nav className="rw-settings-tabs" aria-label="Seções de configurações">
        {[
          ["general", "Interface"],
          ["projects", "Projetos"],
          ["github", "Acesso ao GitHub"],
          ["harness", "Harnesses e modelos"],
          ["providers", "Provedores"],
          ["mcp", "MCP"],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={section === id ? "selected" : ""}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <ErrorNotice error={query.error || action.error} />
      {action.notice && (
        <p role="status" className="rw-success">
          {action.notice}
        </p>
      )}
      {section === "general" && (
        <>
          <section className="rw-settings-card">
            <div className="rw-card-heading">
              <h2>Origem das sessões</h2>
              <p>Escolha entre a demonstração e o ambiente conectado.</p>
            </div>
            <button
              type="button"
              className={`rw-source-option ${!workspace.server ? "selected" : ""}`}
              onClick={() => onSource("demo")}
            >
              <Icon name="play" />
              <span>
                <strong>Demonstração interativa</strong>
                <small>Conversas e comandos simulados.</small>
              </span>
            </button>
            <button
              type="button"
              className={`rw-source-option ${workspace.server ? "selected" : ""}`}
              onClick={() => onSource("server")}
            >
              <Icon name="cloud" />
              <span>
                <strong>Consultar servidor</strong>
                <small>Sessões reais e terminal do harness. Inicie execuções pelo terminal.</small>
              </span>
            </button>
          </section>
          <section className="rw-settings-card">
            <div className="rw-card-heading">
              <h2>Área de trabalho</h2>
            </div>
            <label className="rw-setting-toggle">
              <span>Interface compacta</span>
              <input
                type="checkbox"
                checked={compact}
                onChange={(event) => setCompact(event.target.checked)}
              />
            </label>
            <label className="rw-setting-toggle">
              <span>Painel de contexto</span>
              <input
                type="checkbox"
                checked={inspector}
                onChange={(event) => setInspector(event.target.checked)}
              />
            </label>
          </section>
        </>
      )}
      {section === "projects" && <ProjectSettings workspace={workspace} />}
      {section === "github" && (
        <section className="rw-settings-card">
          <div className="rw-card-heading">
            <span className="rw-resource-type">CONEXÃO DO SERVIDOR</span>
            <h2>GitHub</h2>
            <p>
              {query.data?.github.tokenSet
                ? `Credencial configurada${query.data.github.username ? ` · @${query.data.github.username}` : ""}`
                : "Configure o acesso para repositórios privados, clones e pull requests."}
            </p>
          </div>
          <form
            className="rw-settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save({ githubToken: token }, () => setToken(""));
            }}
          >
            <label>
              Token de acesso
              <input
                type="password"
                autoComplete="new-password"
                aria-label="Token de acesso ao GitHub"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={
                  query.data?.github.tokenSet
                    ? "Token configurado · digite para substituir"
                    : "Cole um token com acesso aos repositórios desejados"
                }
              />
            </label>
            <p className="rw-section-note">
              O token é enviado ao servidor. O valor existente não é preenchido nem salvo no
              armazenamento do navegador.
            </p>
            <div className="rw-form-actions">
              <button
                type="submit"
                className="rw-button primary"
                disabled={!!action.busy || !token.trim() || !query.data}
              >
                Salvar acesso ao GitHub
              </button>
              <button
                type="button"
                className="rw-button"
                disabled={!!action.busy || !query.data?.github.tokenSet}
                onClick={() =>
                  void action.run(
                    "test",
                    async () => {
                      const result = await api.settings.testConnection("github");
                      if (!result.ok)
                        throw new Error(result.error ?? "Falha na conexão com GitHub.");
                      await query.refetch();
                    },
                    "Conexão com GitHub validada."
                  )
                }
              >
                Testar conexão
              </button>
            </div>
          </form>
        </section>
      )}
      {section === "harness" && (
        <>
          <ErrorNotice error={engines.error || models.error} />
          <section className="rw-settings-card">
            <div className="rw-card-heading">
              <h2>Harness padrão para novas sessões</h2>
              <p>
                A preferência fica neste navegador. Sessões existentes mantêm seu harness e
                workspace.
              </p>
            </div>
            <div className="rw-settings-form">
              <label>
                Harness
                <select
                  aria-label="Harness padrão"
                  value={workspace.engine}
                  onChange={(event) => {
                    workspace.setEngine(event.target.value);
                    workspace.setModel("");
                    workspace.setEffort("");
                  }}
                >
                  <option value="opencode">OpenCode</option>
                  <option value="claude-code">Claude Code</option>
                </select>
              </label>
              <label>
                Modelo
                <select
                  aria-label="Modelo padrão do harness"
                  value={workspace.model}
                  onChange={(event) => {
                    workspace.setModel(event.target.value);
                    workspace.setEffort("");
                  }}
                >
                  <option value="">Padrão do harness</option>
                  {models.data?.map((model) => (
                    <option value={model.id} key={model.id}>
                      {model.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Effort / raciocínio
                <select
                  aria-label="Effort padrão"
                  value={workspace.effort}
                  onChange={(event) => workspace.setEffort(event.target.value)}
                  disabled={!selectedModel?.efforts.length}
                >
                  <option value="">Padrão do modelo</option>
                  {selectedModel?.efforts.map((effort) => (
                    <option value={effort} key={effort}>
                      {effort}
                    </option>
                  ))}
                </select>
              </label>
              <p className="rw-section-note">
                {models.isFetching
                  ? "Consultando modelos do harness instalado…"
                  : selectedModel && !selectedModel.efforts.length
                    ? "Este modelo não anuncia variantes de effort."
                    : "Modelos e variantes são consultados no harness instalado."}
              </p>
            </div>
          </section>
          <section className="rw-settings-card">
            <div className="rw-card-heading">
              <h2>Harnesses disponíveis no servidor</h2>
            </div>
            {engines.data?.map((engine) => (
              <div key={engine.name} className="rw-plugin-row">
                <span className={`rw-status-dot ${engine.available ? "waiting" : "failed"}`} />
                <div>
                  <strong>{engine.displayName}</strong>
                  <small>
                    {engine.available
                      ? (engine.version ?? "Instalado")
                      : (engine.setupIssue ?? "Não instalado")}{" "}
                    · {engine.activeRuns} execuções
                  </small>
                </div>
              </div>
            ))}
          </section>
          <section className="rw-settings-card">
            <div className="rw-card-heading">
              <h2>Concorrência do servidor</h2>
            </div>
            <form
              className="rw-settings-form"
              onSubmit={(event) => {
                event.preventDefault();
                void save({ maxAgents: Number(maxAgents) });
              }}
            >
              <label>
                Máximo de agentes simultâneos
                <input
                  aria-label="Máximo de agentes"
                  type="number"
                  min="1"
                  max="20"
                  required
                  value={maxAgents}
                  placeholder={String(query.data?.maxAgents ?? 1)}
                  onChange={(event) => setMaxAgents(event.target.value)}
                />
              </label>
              <button
                type="submit"
                className="rw-button"
                disabled={!!action.busy || !maxAgents || !query.data}
              >
                Salvar concorrência
              </button>
            </form>
          </section>
        </>
      )}
      {section === "providers" && (
        <>
          <section className="rw-settings-card">
            <div className="rw-card-heading">
              <h2>Chaves dos provedores</h2>
              <p>
                Credenciais usadas pelo harness no servidor. Preencha apenas as que deseja
                substituir.
              </p>
            </div>
            <form
              className="rw-settings-form"
              onSubmit={(event) => {
                event.preventDefault();
                const data: UpdateSettingsRequest = {};
                if (keys.anthropic) data.anthropicApiKey = keys.anthropic;
                if (keys.openai) data.openaiApiKey = keys.openai;
                if (keys.gemini) data.geminiApiKey = keys.gemini;
                void save(data, () => setKeys({}));
              }}
            >
              {(["anthropic", "openai", "gemini"] as const).map((provider) => (
                <label key={provider}>
                  {provider}
                  <input
                    aria-label={`Chave ${provider}`}
                    type="password"
                    autoComplete="new-password"
                    value={keys[provider] ?? ""}
                    placeholder={
                      query.data?.apiKeys[provider].tokenSet
                        ? "Configurada · digite para substituir"
                        : "Não configurada"
                    }
                    onChange={(event) => setKeys({ ...keys, [provider]: event.target.value })}
                  />
                </label>
              ))}
              <button
                type="submit"
                className="rw-button primary"
                disabled={!!action.busy || !Object.values(keys).some(Boolean) || !query.data}
              >
                Salvar chaves
              </button>
            </form>
          </section>
          <section className="rw-settings-card">
            <div className="rw-card-heading">
              <h2>Gateway LiteLLM</h2>
            </div>
            <form
              className="rw-settings-form"
              onSubmit={(event) => {
                event.preventDefault();
                void save({
                  litellmBaseUrl: litellmUrl ?? query.data?.litellm.baseUrl,
                  litellmEnabled: litellmEnabled ?? query.data?.litellm.enabled,
                });
              }}
            >
              <label>
                URL do gateway
                <input
                  type="url"
                  aria-label="URL LiteLLM"
                  value={litellmUrl ?? query.data?.litellm.baseUrl ?? ""}
                  onChange={(event) => setLitellmUrl(event.target.value)}
                />
              </label>
              <label className="rw-setting-toggle">
                <span>Usar gateway</span>
                <input
                  type="checkbox"
                  checked={litellmEnabled ?? query.data?.litellm.enabled ?? false}
                  onChange={(event) => setLitellmEnabled(event.target.checked)}
                />
              </label>
              <button type="submit" className="rw-button" disabled={!!action.busy || !query.data}>
                Salvar gateway
              </button>
            </form>
          </section>
        </>
      )}
      {section === "mcp" && (
        <section className="rw-settings-card">
          <div className="rw-card-heading">
            <h2>Servidores MCP</h2>
            <p>
              Edite o mapa de servidores do harness. Os valores mascarados são preservados ao
              salvar.
            </p>
          </div>
          <form
            className="rw-settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(
                "mcp",
                async () => {
                  const parsed: unknown = JSON.parse(mcp ?? "{}");
                  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
                    throw new Error("Informe um objeto JSON com os servidores MCP.");
                  await api.settings.update({ mcpServers: parsed as Record<string, unknown> });
                  setMcp(null);
                  await query.refetch();
                },
                "Servidores MCP salvos."
              );
            }}
          >
            <label>
              Configuração JSON
              <textarea
                aria-label="Configuração MCP"
                spellCheck={false}
                rows={12}
                value={mcp ?? JSON.stringify(query.data?.mcpServers ?? {}, null, 2)}
                onChange={(event) => setMcp(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="rw-button primary"
              disabled={!!action.busy || mcp === null || !query.data}
            >
              Salvar MCP
            </button>
          </form>
        </section>
      )}
    </>
  );
}
