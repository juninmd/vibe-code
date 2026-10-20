import { type ReactNode, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { HarnessTerminal } from "./HarnessTerminal";
import { Icon } from "./Icon";
import { type ManagementPage, ManagementViews } from "./ManagementViews";
import { STATUS } from "./model";
import { usePrototype } from "./usePrototype";
import {
  ChangesView,
  Composer,
  Conversation,
  SessionOverview,
  TerminalView,
} from "./WorkspaceViews";
import "./prototype.css";

type Tab = "conversation" | "terminal" | "changes";
type Dialog = "projects" | "commands" | null;

function Modal({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="rw-dialog"
      aria-labelledby="rw-dialog-title"
      aria-describedby="rw-dialog-description"
      onCancel={onClose}
    >
      <div className="rw-dialog-heading">
        <div>
          <h2 id="rw-dialog-title">{title}</h2>
          <p id="rw-dialog-description">{description}</p>
        </div>
        <button
          type="button"
          className="rw-icon-button"
          onClick={onClose}
          aria-label="Fechar janela"
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function UnifiedRemotePrototype() {
  const workspace = usePrototype();
  const [view, setView] = useState<"session" | "overview" | "activity" | ManagementPage>("session");
  const [tab, setTab] = useState<Tab>("conversation");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [search, setSearch] = useState("");
  const [pickerSearch, setPickerSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [mobileNav, setMobileNav] = useState(false);
  const [inspector, setInspector] = useState(true);
  const [mobileContext, setMobileContext] = useState(false);
  const [compact, setCompact] = useState(false);
  const narrow = useMediaQuery("(max-width: 1199px)");
  const activeEngine = workspace.selected?.engine ?? workspace.engine;
  const draftId = workspace.selected?.id ?? `new-${workspace.project?.id}`;
  const draft = drafts[draftId] ?? "";
  const setDraft = (text: string) => setDrafts((all) => ({ ...all, [draftId]: text }));
  const active = workspace.sessions.filter((s) => s.status === "working");
  const reviews = workspace.sessions.filter((s) => s.status === "review");
  const selected = workspace.selected;
  const filtered = workspace.sessions.filter((s) =>
    `${s.title} ${workspace.projects.find((p) => p.id === s.projectId)?.name}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  const openSession = (id: string) => {
    workspace.selectSession(id);
    setView("session");
    setTab("conversation");
    setMobileNav(false);
    setDialog(null);
  };
  const newSession = (projectId?: string) => {
    workspace.newSession(projectId);
    setView("session");
    setTab("conversation");
    setMobileNav(false);
    setDialog(null);
  };
  const openContext = () => {
    setInspector(true);
    setMobileContext(true);
  };
  const selectTab = (next: Tab) => {
    setView("session");
    setTab(next);
    setMobileContext(false);
  };
  const management = ["skills", "plugins", "agents", "settings"].includes(view);
  const openManagement = (page: ManagementPage) => {
    setView(page);
    setMobileNav(false);
    setMobileContext(false);
    setDialog(null);
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPickerSearch("");
        setDialog("commands");
      }
      if (event.key === "Escape") {
        setMobileNav(false);
        setMobileContext(false);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <div className={`rw-root ${compact ? "rw-compact" : ""}`}>
      {mobileNav && (
        <button
          type="button"
          className="rw-backdrop"
          onClick={() => setMobileNav(false)}
          aria-label="Fechar navegação"
        />
      )}
      <aside
        className={`rw-sidebar ${mobileNav ? "is-open" : ""}`}
        aria-label="Navegação do espaço de trabalho"
      >
        <div className="rw-brand">
          <span className="rw-logo">
            <Icon name="code" size={19} />
          </span>
          <strong>
            vibe<span>remote</span>
          </strong>
          <button
            type="button"
            className="rw-icon-button rw-mobile-only"
            aria-label="Recolher navegação"
            onClick={() => setMobileNav(false)}
          >
            <Icon name="close" />
          </button>
          <span className="rw-prototype-label">PRÉVIA</span>
        </div>
        <button
          type="button"
          className="rw-workspace-switch"
          onClick={() => openManagement("settings")}
        >
          <span className="rw-workspace-avatar">W</span>
          <span>
            <strong>Meu workspace</strong>
            <small>{workspace.server ? "Dados do servidor" : "Ambiente de demonstração"}</small>
          </span>
          <Icon name="chevron" size={13} />
        </button>
        <button
          type="button"
          className="rw-new-session"
          disabled={workspace.server && !workspace.projects.length}
          onClick={() => newSession()}
        >
          <Icon name="plus" size={16} />
          Nova sessão<span aria-hidden="true">↗</span>
        </button>
        <button
          type="button"
          className={`rw-nav-item ${view === "overview" ? "selected" : ""}`}
          onClick={() => {
            setView("overview");
            setMobileNav(false);
          }}
        >
          <Icon name="grid" />
          Todas as sessões<span className="rw-nav-count">{workspace.sessions.length}</span>
        </button>
        <button
          type="button"
          className={`rw-nav-item ${view === "activity" ? "selected" : ""}`}
          onClick={() => {
            setView("activity");
            setMobileNav(false);
          }}
        >
          <Icon name="activity" />
          Atividade
          {active.length + reviews.length > 0 && (
            <span className="rw-nav-count">{active.length + reviews.length}</span>
          )}
        </button>
        <label className="rw-search rw-sidebar-search">
          <Icon name="search" size={14} />
          <input
            aria-label="Buscar sessões"
            placeholder="Buscar sessões…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            className="rw-search-shortcut"
            aria-label="Abrir busca rápida"
            onClick={() => {
              setPickerSearch("");
              setDialog("commands");
            }}
          >
            ⌘ K
          </button>
        </label>
        <div className="rw-project-heading">
          <span>PROJETOS</span>
          <button
            type="button"
            className="rw-icon-button"
            aria-label="Escolher projeto"
            onClick={() => {
              setPickerSearch("");
              setDialog("projects");
            }}
          >
            <Icon name="folder" size={13} />
          </button>
        </div>
        <nav className="rw-project-tree" aria-label="Projetos e sessões">
          {workspace.server && workspace.data.isLoading && (
            <p className="rw-inline-state" role="status">
              Carregando projetos…
            </p>
          )}
          {workspace.projects.map((project) => {
            const sessions = filtered.filter((s) => s.projectId === project.id);
            return (
              <details key={project.id} open>
                <summary>
                  <Icon name="chevron" size={11} />
                  <Icon name="folder" size={15} />
                  <span>{project.name}</span>
                  <small>{sessions.length}</small>
                </summary>
                <div className="rw-project-sessions">
                  {sessions.map((session) => (
                    <button
                      type="button"
                      key={session.id}
                      onClick={() => openSession(session.id)}
                      className={
                        view === "session" && selected?.id === session.id ? "selected" : ""
                      }
                      aria-current={
                        view === "session" && selected?.id === session.id ? "page" : undefined
                      }
                    >
                      <span className={`rw-status-dot ${session.status}`} />
                      <span title={session.title}>{session.title}</span>
                      {session.status === "review" && <Icon name="code" size={12} />}
                    </button>
                  ))}
                  {sessions.length === 0 && (
                    <p className="rw-project-empty">
                      {search ? "Nenhuma correspondência" : "Sem sessões"}
                    </p>
                  )}
                  {(!workspace.server || workspace.projects.length > 0) && (
                    <button
                      type="button"
                      className="rw-project-new"
                      onClick={() => newSession(project.id)}
                    >
                      <Icon name="plus" size={12} />
                      Nova sessão neste projeto
                    </button>
                  )}
                </div>
              </details>
            );
          })}
          {!workspace.data.isLoading && workspace.server && workspace.projects.length === 0 && (
            <p className="rw-inline-state">Nenhum projeto disponível.</p>
          )}
        </nav>
        <div className="rw-sidebar-footer">
          {(
            [
              ["skills", "Skills", "file"],
              ["plugins", "Plugins remotos", "cloud"],
              ["agents", "Agentes", "activity"],
            ] as const
          ).map(([page, label, icon]) => (
            <button
              type="button"
              key={page}
              className={`rw-nav-item ${view === page ? "selected" : ""}`}
              onClick={() => openManagement(page)}
            >
              <Icon name={icon} />
              {label}
            </button>
          ))}
          <button
            type="button"
            className={`rw-nav-item ${view === "settings" ? "selected" : ""}`}
            onClick={() => openManagement("settings")}
          >
            <Icon name="settings" />
            Configurações
          </button>
          <a className="rw-nav-item" href="/">
            <Icon name="external" />
            Versão atual
          </a>
          <div className="rw-source-status">
            <span
              className={`rw-status-dot ${workspace.server && workspace.data.isError ? "failed" : "waiting"}`}
            />
            {workspace.server
              ? workspace.data.isLoading
                ? "Consultando servidor…"
                : "Consulta ao servidor"
              : "Protótipo interativo"}
            <span className="rw-version">v3</span>
          </div>
        </div>
      </aside>

      <div className="rw-main-shell">
        <header className="rw-topbar">
          <button
            type="button"
            className="rw-icon-button rw-mobile-only"
            aria-label="Abrir navegação"
            onClick={() => setMobileNav(true)}
          >
            <Icon name="menu" />
          </button>
          <div className="rw-breadcrumb">
            <span className="rw-breadcrumb-project">
              <Icon name="folder" size={14} />
              {workspace.project?.name ?? "Workspace"}
            </span>
            <span className="rw-breadcrumb-slash">/</span>
            <span>
              {management
                ? {
                    skills: "Skills",
                    plugins: "Plugins remotos",
                    agents: "Agentes",
                    settings: "Configurações",
                  }[view as ManagementPage]
                : view === "overview"
                  ? "Todas as sessões"
                  : view === "activity"
                    ? "Atividade"
                    : (selected?.title ?? "Nova sessão")}
            </span>
          </div>
          <button
            type="button"
            className="rw-source-badge"
            onClick={() => openManagement("settings")}
          >
            <span className="rw-status-dot waiting" />
            {management
              ? "Recursos do servidor"
              : workspace.server
                ? "Servidor conectado"
                : "Demonstração"}
          </button>
          <button
            type="button"
            className="rw-icon-button rw-top-search"
            aria-label="Busca rápida"
            onClick={() => {
              setPickerSearch("");
              setDialog("commands");
            }}
          >
            <Icon name="search" />
          </button>
          <button
            type="button"
            className={`rw-icon-button ${inspector ? "is-active" : ""}`}
            aria-label="Alternar painel de contexto"
            aria-expanded={narrow ? mobileContext && inspector : inspector}
            onClick={() => {
              if (narrow) {
                setInspector(true);
                setMobileContext(!mobileContext);
              } else {
                setInspector(!inspector);
                setMobileContext(false);
              }
            }}
          >
            <Icon name="panel" />
          </button>
        </header>
        <div className="rw-work-area">
          <main className="rw-main" aria-label="Área de desenvolvimento">
            {workspace.server && workspace.data.isError && (
              <div className="rw-alert" role="alert">
                Não foi possível consultar o servidor. Verifique a conexão e a autenticação.{" "}
                <button type="button" onClick={() => void workspace.data.refetch()}>
                  Tentar novamente
                </button>
                <button type="button" onClick={() => workspace.changeSource("demo")}>
                  Voltar à demonstração
                </button>
              </div>
            )}
            {management ? (
              <ManagementViews
                page={view as ManagementPage}
                workspace={workspace}
                compact={compact}
                setCompact={setCompact}
                inspector={inspector}
                setInspector={setInspector}
                onPage={openManagement}
                onSource={(source) => {
                  workspace.changeSource(source);
                  setView(source === "server" ? "overview" : "session");
                  setTab("conversation");
                }}
              />
            ) : view === "session" ? (
              <>
                <div className="rw-session-toolbar">
                  <div
                    className="rw-tabs"
                    role="tablist"
                    aria-label="Visualizações da sessão"
                    onKeyDown={(event) => {
                      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                      event.preventDefault();
                      const buttons = Array.from(
                        event.currentTarget.querySelectorAll<HTMLButtonElement>(
                          "button:not(:disabled)"
                        )
                      );
                      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                      const next =
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? buttons.length - 1
                            : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
                              buttons.length;
                      buttons[next]?.focus();
                      buttons[next]?.click();
                    }}
                  >
                    {(
                      [
                        { value: "conversation", label: "Conversa", icon: "chat" },
                        {
                          value: "terminal",
                          label: "Terminal",
                          icon: "terminal",
                        },
                        { value: "changes", label: "Alterações", icon: "code" },
                      ] as const
                    ).map((item) => (
                      <button
                        type="button"
                        key={item.value}
                        id={`rw-tab-${item.value}`}
                        role="tab"
                        tabIndex={tab === item.value ? 0 : -1}
                        aria-selected={tab === item.value}
                        aria-controls={`rw-panel-${item.value}`}
                        disabled={!selected && item.value !== "conversation"}
                        onClick={() => selectTab(item.value)}
                      >
                        <Icon name={item.icon} size={15} />
                        {item.label}
                        {item.value === "changes" && !!selected?.changes.length && (
                          <span className="rw-tab-count">{selected.changes.length}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  {selected && (
                    <span className="rw-session-state">
                      <span className={`rw-status-dot ${selected.status}`} />
                      {STATUS[selected.status]}
                    </span>
                  )}
                </div>
                <div
                  className="rw-tab-panel"
                  id="rw-panel-conversation"
                  role="tabpanel"
                  aria-labelledby="rw-tab-conversation"
                  hidden={tab !== "conversation"}
                >
                  <Conversation
                    workspace={workspace}
                    onSuggest={(text) => {
                      setDraft(text);
                      document.querySelector<HTMLTextAreaElement>(".rw-composer textarea")?.focus();
                    }}
                  />
                  <Composer
                    workspace={workspace}
                    draft={draft}
                    setDraft={setDraft}
                    onRepository={() => {
                      setPickerSearch("");
                      setDialog("projects");
                    }}
                    onContext={openContext}
                    onTerminal={() => selectTab("terminal")}
                  />
                </div>
                {selected && (
                  <>
                    <div
                      className="rw-tab-panel"
                      id="rw-panel-terminal"
                      role="tabpanel"
                      aria-labelledby="rw-tab-terminal"
                      hidden={tab !== "terminal"}
                    >
                      {workspace.server ? (
                        <HarnessTerminal key={selected.id} workspace={workspace} />
                      ) : (
                        <TerminalView key={selected.id} workspace={workspace} />
                      )}
                    </div>
                    <div
                      className="rw-tab-panel"
                      id="rw-panel-changes"
                      role="tabpanel"
                      aria-labelledby="rw-tab-changes"
                      hidden={tab !== "changes"}
                    >
                      <ChangesView key={selected.id} workspace={workspace} />
                    </div>
                  </>
                )}
              </>
            ) : (
              <SessionOverview
                workspace={workspace}
                activity={view === "activity"}
                query={search}
                onOpen={openSession}
              />
            )}
          </main>
          {!management && mobileContext && inspector && (
            <button
              type="button"
              className="rw-context-backdrop"
              aria-label="Fechar contexto"
              onClick={() => setMobileContext(false)}
            />
          )}
          {!management && inspector && (
            <aside
              className={`rw-inspector ${mobileContext ? "is-open" : ""}`}
              aria-label="Contexto da sessão"
            >
              <div className="rw-inspector-heading">
                <h2>Contexto</h2>
                <button
                  type="button"
                  className="rw-icon-button"
                  aria-label="Recolher contexto"
                  onClick={() => {
                    setInspector(false);
                    setMobileContext(false);
                  }}
                >
                  <Icon name="panel" size={15} />
                </button>
              </div>
              <section>
                <h3>
                  <Icon name="cloud" size={14} />
                  Ambiente
                </h3>
                <div className="rw-environment">
                  <span className="rw-environment-icon">
                    <Icon name="terminal" size={19} />
                  </span>
                  <div>
                    <strong>{workspace.server ? "Servidor atual" : "Development"}</strong>
                    <span>
                      {workspace.server ? "Consulta autenticada" : "Ambiente demonstrativo"}
                    </span>
                  </div>
                  <span className="rw-status-dot waiting" />
                </div>
                <dl>
                  <div>
                    <dt>Projeto</dt>
                    <dd>
                      {workspace.project?.owner}/{workspace.project?.name}
                    </dd>
                  </div>
                  <div>
                    <dt>Branch</dt>
                    <dd title={selected?.branch ?? workspace.branch}>
                      <Icon name="branch" size={12} />
                      {selected?.branch ?? workspace.branch}
                    </dd>
                  </div>
                  <div>
                    <dt>Workspace</dt>
                    <dd>{workspace.server ? "Do servidor" : "Isolado por sessão"}</dd>
                  </div>
                </dl>
              </section>
              <section>
                <h3>
                  <Icon name="activity" size={14} />
                  Sessão
                </h3>
                <dl>
                  <div>
                    <dt>Agente</dt>
                    <dd>
                      {activeEngine === "opencode"
                        ? "OpenCode"
                        : activeEngine === "claude-code"
                          ? "Claude Code"
                          : activeEngine}
                    </dd>
                  </div>
                  <div>
                    <dt>Modelo</dt>
                    <dd>{selected?.model ?? "Modelo padrão"}</dd>
                  </div>
                  <div>
                    <dt>Estado</dt>
                    <dd>
                      <span className={`rw-status-dot ${selected?.status ?? "waiting"}`} />
                      {selected ? STATUS[selected.status] : "Pronta para começar"}
                    </dd>
                  </div>
                </dl>
                {!workspace.server && selected?.status === "working" && (
                  <button type="button" className="rw-button subtle" onClick={workspace.stop}>
                    <Icon name="stop" size={13} />
                    Parar demonstração
                  </button>
                )}
              </section>
              <section>
                <h3>
                  <Icon name="code" size={14} />
                  Revisão<span>{selected?.changes.length ?? "—"}</span>
                </h3>
                {selected?.changes.length ? (
                  <>
                    <div className="rw-inspector-files">
                      {selected.changes.map((file) => (
                        <button key={file.path} type="button" onClick={() => selectTab("changes")}>
                          <Icon name="file" size={13} />
                          <span title={file.path}>{file.path.split("/").pop()}</span>
                          <small>+{file.additions}</small>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="rw-text-button"
                      onClick={() => selectTab("changes")}
                    >
                      Revisar alterações
                      <Icon name="chevron" size={12} />
                    </button>
                  </>
                ) : (
                  <p className="rw-section-note">
                    {workspace.server
                      ? "Consulte a aba Alterações para carregar o diff."
                      : "Os arquivos da mudança aparecerão aqui."}
                  </p>
                )}
              </section>
              <section>
                <h3>
                  <Icon name="terminal" size={14} />
                  Em segundo plano<span>{active.length}</span>
                </h3>
                {active.length ? (
                  active.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      className="rw-background-session"
                      onClick={() => openSession(session.id)}
                    >
                      <span className="rw-status-dot working" />
                      {session.title}
                    </button>
                  ))
                ) : (
                  <p className="rw-section-note">Nenhuma sessão em execução.</p>
                )}
              </section>
              <div className="rw-inspector-footnote">
                <span className="rw-footnote-icon">
                  <Icon name="code" size={15} />
                </span>
                <p>
                  Um projeto. Uma sessão.
                  <br />
                  <strong>Todo o contexto, junto.</strong>
                </p>
              </div>
            </aside>
          )}
        </div>
      </div>

      {dialog === "projects" && (
        <Modal
          title="Escolher projeto"
          description="O repositório define o contexto da nova sessão."
          onClose={() => setDialog(null)}
        >
          <label className="rw-search rw-dialog-search">
            <Icon name="search" />
            <input
              aria-label="Buscar repositórios"
              placeholder="Buscar por nome ou organização…"
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
            />
          </label>
          <div className="rw-picker-list">
            {workspace.projects
              .filter((project) =>
                `${project.owner}/${project.name}`
                  .toLowerCase()
                  .includes(pickerSearch.toLowerCase())
              )
              .map((project) => (
                <button type="button" key={project.id} onClick={() => newSession(project.id)}>
                  <span className="rw-project-icon">
                    <Icon name="folder" size={18} />
                  </span>
                  <span>
                    <strong>
                      {project.owner}/{project.name}
                    </strong>
                    <small>
                      <Icon name="branch" size={11} />
                      {project.branch}
                    </small>
                  </span>
                  {workspace.project?.id === project.id && <Icon name="check" size={16} />}
                </button>
              ))}
            {!workspace.projects.some((project) =>
              `${project.owner}/${project.name}`.toLowerCase().includes(pickerSearch.toLowerCase())
            ) && <p className="rw-inline-state">Nenhum repositório encontrado.</p>}
          </div>
        </Modal>
      )}
      {dialog === "commands" && (
        <Modal
          title="Ir para…"
          description="Encontre uma sessão ou navegue pelo workspace."
          onClose={() => setDialog(null)}
        >
          <label className="rw-search rw-dialog-search">
            <Icon name="search" />
            <input
              aria-label="Buscar comandos e sessões"
              placeholder="Buscar sessões…"
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
            />
          </label>
          <div className="rw-command-list">
            {!pickerSearch && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setView("overview");
                    setDialog(null);
                  }}
                >
                  <Icon name="grid" />
                  Todas as sessões
                </button>
                {!workspace.server && (
                  <button type="button" onClick={() => newSession()}>
                    <Icon name="plus" />
                    Nova sessão
                  </button>
                )}
              </>
            )}
            {workspace.sessions
              .filter((session) => session.title.toLowerCase().includes(pickerSearch.toLowerCase()))
              .map((session) => (
                <button type="button" key={session.id} onClick={() => openSession(session.id)}>
                  <span className={`rw-status-dot ${session.status}`} />
                  <span>{session.title}</span>
                  <Icon name="chevron" size={12} />
                </button>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
