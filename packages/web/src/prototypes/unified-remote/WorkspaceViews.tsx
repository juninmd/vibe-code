import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../../api/client";
import { Icon } from "./Icon";
import { ErrorNotice } from "./ManagementViews";
import { type Change, STATUS } from "./model";
import type { usePrototype } from "./usePrototype";

export type Workspace = ReturnType<typeof usePrototype>;

export function Conversation({
  workspace,
  onSuggest,
}: {
  workspace: Workspace;
  onSuggest: (text: string) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const { selected, messages, server } = workspace;
  const count = messages.length;
  const working = selected?.status === "working";
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different session resets scroll following.
  useEffect(() => {
    atBottom.current = true;
  }, [selected?.id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the transcript when a turn or status changes.
  useEffect(() => {
    if (scroll.current && atBottom.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [count, working]);
  return (
    <div
      className="rw-conversation"
      ref={scroll}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      {!selected ? (
        <div className="rw-welcome">
          <span className="rw-welcome-symbol" aria-hidden="true">
            <Icon name="code" size={30} />
          </span>
          <p className="rw-eyebrow">UM ESPAÇO PARA SUAS IDEIAS</p>
          <h1>O que vamos construir?</h1>
          <p>
            {server
              ? "Abra uma sessão na lateral para consultar a conversa, os logs e as alterações do servidor."
              : "Do primeiro prompt à revisão do código.\nTudo na mesma sessão, de onde você estiver."}
          </p>
          {!server && (
            <div className="rw-suggestions">
              <button
                type="button"
                onClick={() =>
                  onSuggest(
                    "Me ajude a entender a estrutura deste projeto e sugerir o próximo passo."
                  )
                }
              >
                <Icon name="folder" /> Explorar este projeto <Icon name="chevron" size={13} />
              </button>
              <button
                type="button"
                onClick={() =>
                  onSuggest(
                    "Quero implementar uma nova funcionalidade. Vamos começar pelo escopo e pelos critérios de aceite."
                  )
                }
              >
                <Icon name="plus" /> Começar uma mudança <Icon name="chevron" size={13} />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="rw-transcript">
          <div className="rw-session-intro">
            <span className="rw-agent-mark">
              o<span>_</span>
            </span>
            <div>
              <h1>{selected.title}</h1>
              <p>
                {server ? "Histórico do servidor" : "Conversa de demonstração"} <span>·</span>{" "}
                {selected.engine === "opencode" ? "OpenCode" : selected.engine}
              </p>
            </div>
          </div>
          {workspace.historyLoading && (
            <p role="status" className="rw-inline-state">
              Carregando a conversa…
            </p>
          )}
          {workspace.historyError && (
            <div role="alert" className="rw-alert">
              Não foi possível carregar os logs.{" "}
              <button type="button" onClick={() => void workspace.refreshHistory()}>
                Atualizar dados
              </button>
            </div>
          )}
          {messages.map((message) => (
            <article
              key={message.id}
              className={`rw-message rw-message-${message.role}`}
              aria-label={message.role === "user" ? "Mensagem do usuário" : "Resposta do agente"}
            >
              {message.role === "assistant" && (
                <div className="rw-message-author">
                  <span className="rw-agent-small">o_</span>{" "}
                  {selected.engine === "opencode" ? "OpenCode" : selected.engine}
                  <span>{server ? "Histórico" : "Demonstração"}</span>
                </div>
              )}
              {message.activity && (
                <details className="rw-activity-fold">
                  <summary>
                    <Icon name="check" size={13} /> Exploração da proposta{" "}
                    <span>{message.activity.length} etapas</span>
                  </summary>
                  <ul>
                    {message.activity.map((text) => (
                      <li key={text}>
                        <Icon name="check" size={12} />
                        {text}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="rw-message-text">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
              </div>
            </article>
          ))}
          {working && (
            <div className="rw-thinking" role="status">
              <span className="rw-status-dot working" />
              {server
                ? "Sessão em execução no servidor"
                : "Preparando uma resposta de demonstração…"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Composer({
  workspace,
  draft,
  setDraft,
  onRepository,
  onContext,
  onTerminal,
}: {
  workspace: Workspace;
  draft: string;
  setDraft: (text: string) => void;
  onRepository: () => void;
  onContext: () => void;
  onTerminal: () => void;
}) {
  const { selected, project, server } = workspace;
  const working = selected?.status === "working";
  const models = useQuery({
    queryKey: ["prototype-harness-models", workspace.engine],
    queryFn: () => api.engines.harnessModels(workspace.engine),
    enabled: server && !selected,
    staleTime: 60_000,
    retry: false,
  });
  const efforts = server
    ? (models.data?.find((model) => model.id === workspace.model)?.efforts ?? [])
    : ["low", "medium", "high"];
  const send = async () => {
    if (!draft.trim() || working || workspace.sending) return;
    if (await workspace.send(draft)) setDraft("");
  };
  return (
    <div className="rw-composer-wrap">
      <ErrorNotice error={workspace.sendError || models.error} />
      {server && selected ? (
        <div className="rw-readonly-note">
          <Icon name="terminal" /> Continue a sessão no harness atual.
          <button type="button" className="rw-button primary" onClick={onTerminal}>
            Abrir terminal
          </button>
        </div>
      ) : (
        <>
          <form
            className="rw-composer"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <textarea
              aria-label="Mensagem para o agente"
              placeholder={
                selected
                  ? "Continue a conversa ou descreva o próximo passo…"
                  : "Descreva o que você quer construir…"
              }
              rows={2}
              value={draft}
              disabled={working || workspace.sending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="rw-composer-tools">
              <button
                type="button"
                className="rw-icon-button"
                title="Mostrar contexto da sessão"
                aria-label="Mostrar contexto da sessão"
                onClick={onContext}
              >
                <Icon name="plus" />
              </button>
              <span className="rw-composer-hint">
                {working ? "A demonstração está respondendo" : "Enter para enviar"}
              </span>
              {working ? (
                <button
                  type="button"
                  className="rw-send"
                  onClick={workspace.stop}
                  aria-label="Parar demonstração"
                >
                  <Icon name="stop" size={15} />
                </button>
              ) : (
                <button
                  type="submit"
                  className="rw-send"
                  disabled={!draft.trim() || workspace.sending}
                  aria-label={server ? "Criar sessão" : "Enviar mensagem"}
                >
                  <Icon name="arrow" size={18} />
                </button>
              )}
            </div>
          </form>
          <div className="rw-composer-settings">
            <div className="rw-composer-target">
              <button type="button" onClick={onRepository} className="rw-inline-button">
                <Icon name="folder" size={14} />
                <span>
                  {project?.owner}/{project?.name}
                </span>
                <Icon name="chevron" size={10} />
              </button>
              <span className="rw-branch">
                <Icon name="branch" size={12} />
                {selected ? (
                  selected.branch
                ) : (
                  <select
                    aria-label="Branch da nova sessão"
                    value={workspace.branch}
                    onChange={(e) => workspace.setBranch(e.target.value)}
                  >
                    <option value={project?.branch ?? "main"}>{project?.branch ?? "main"}</option>
                    <option value="demo/interface-preview">demo/interface-preview</option>
                  </select>
                )}
              </span>
            </div>
            <div className="rw-composer-model">
              <select
                aria-label="Engine do protótipo"
                value={selected?.engine ?? workspace.engine}
                disabled={!!selected}
                onChange={(e) => {
                  workspace.setEngine(e.target.value);
                  workspace.setModel("");
                  workspace.setEffort("");
                }}
              >
                <option value="opencode">OpenCode</option>
                <option value="claude-code">Claude Code</option>
              </select>
              <select
                aria-label="Modelo do protótipo"
                value={selected ? "" : workspace.model}
                disabled={!!selected}
                onChange={(e) => {
                  workspace.setModel(e.target.value);
                  workspace.setEffort("");
                }}
              >
                <option value="">{selected?.model ?? "Modelo padrão"}</option>
                {server ? (
                  models.data?.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.id}
                    </option>
                  ))
                ) : (
                  <option value="demo/modelo-exemplo">demo/modelo-exemplo</option>
                )}
              </select>
              <select
                aria-label="Effort do modelo"
                value={selected?.effort ?? workspace.effort}
                disabled={!!selected || !efforts.length}
                onChange={(event) => workspace.setEffort(event.target.value)}
              >
                <option value="">Effort padrão</option>
                {efforts.map((effort) => (
                  <option value={effort} key={effort}>
                    {effort}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}
      <p className="rw-composer-caption">
        {server
          ? selected
            ? "O terminal mantém o contexto e a conversa do harness."
            : "Crie a sessão e abra o terminal para iniciar o harness."
          : "Protótipo interativo · respostas e comandos demonstrativos"}
      </p>
    </div>
  );
}

export function TerminalView({ workspace }: { workspace: Workspace }) {
  const [lines, setLines] = useState([
    "Terminal de demonstração",
    "Experimente: help, pwd, git status, clear",
    "",
  ]);
  const [command, setCommand] = useState("");
  const [copied, setCopied] = useState(false);
  const output = useRef<HTMLPreElement>(null);
  const lineCount = lines.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll after a simulated terminal command adds output.
  useEffect(() => {
    if (output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [lineCount]);
  const text = workspace.server
    ? workspace.logs.map((log) => `[${log.stream}] ${log.content}`).join("\n")
    : lines.join("\n");
  const run = () => {
    const input = command.trim();
    if (!input) return;
    const result =
      input === "pwd"
        ? `/demo/workspaces/${workspace.project?.name ?? "project"}`
        : input === "git status"
          ? `On branch ${workspace.selected?.branch ?? "main"}\n${workspace.selected?.changes.length ?? 0} arquivos na revisão demonstrativa.`
          : input === "help"
            ? "Comandos disponíveis: help, pwd, git status, clear\nNenhum comando é executado no servidor."
            : `Comando não disponível na demonstração: ${input}\nDigite help para ver as opções.`;
    setLines((previous) => (input === "clear" ? [] : [...previous, `$ ${input}`, result, ""]));
    setCommand("");
  };
  return (
    <div className="rw-terminal-view">
      <div className="rw-view-heading">
        <div>
          <h2>{workspace.server ? "Logs da sessão" : "Terminal"}</h2>
          <p>
            {workspace.server
              ? "Saída persistida pelo servidor. Esta visualização é somente leitura."
              : "Um terminal no contexto da mesma sessão. Comandos locais simulados."}
          </p>
        </div>
        <button
          type="button"
          className="rw-button subtle"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          <Icon name={copied ? "check" : "copy"} />
          {copied ? "Copiado" : "Copiar saída"}
        </button>
      </div>
      <div className="rw-terminal">
        <div className="rw-terminal-bar">
          <span className="rw-status-dot waiting" />
          <span>
            {workspace.project?.name} <span className="rw-dim">—</span> {workspace.selected?.branch}
          </span>
          <span className="rw-terminal-label">
            {workspace.server ? "HISTÓRICO" : "DEMONSTRAÇÃO"}
          </span>
        </div>
        <section aria-label="Saída do terminal" className="rw-code-output">
          <pre ref={output}>{text || "Sem saída disponível."}</pre>
        </section>
        {!workspace.server && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
          >
            <span aria-hidden="true">❯</span>
            <input
              aria-label="Comando de demonstração"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="Digite um comando…"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className="rw-icon-button"
              aria-label="Executar comando demonstrativo"
            >
              <Icon name="arrow" size={15} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export function ChangesView({ workspace }: { workspace: Workspace }) {
  const [path, setPath] = useState("");
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState(false);
  const diff = useQuery({
    queryKey: ["unified-prototype", "diff", workspace.selected?.id],
    queryFn: () => api.tasks.diff(workspace.selected?.id ?? ""),
    enabled:
      workspace.server &&
      workspace.selected?.reviewAvailable !== false &&
      !!workspace.selected?.branch &&
      workspace.selected.branch !== "—",
    retry: false,
  });
  const changes: Change[] = workspace.server
    ? (diff.data?.files ?? []).map((file) => ({ ...file, patch: "" }))
    : (workspace.selected?.changes ?? []);
  const current = changes.find((file) => file.path === path) ?? changes[0];
  const patch = useQuery({
    queryKey: ["unified-prototype", "patch", workspace.selected?.id, current?.path],
    queryFn: () => api.tasks.diffFile(workspace.selected?.id ?? "", current?.path ?? ""),
    enabled: workspace.server && !!current,
    retry: false,
  });
  const content = workspace.server ? (patch.data?.patch ?? "") : (current?.patch ?? "");
  const total = changes.reduce(
    (sum, file) => ({ add: sum.add + file.additions, remove: sum.remove + file.deletions }),
    { add: 0, remove: 0 }
  );
  return (
    <div className="rw-changes-view">
      <div className="rw-view-heading">
        <div>
          <h2>
            Revisar alterações <span className="rw-count">{changes.length}</span>
          </h2>
          <p>
            {workspace.server
              ? "Alterações disponíveis na API do servidor."
              : "Exemplos de diff para explorar a experiência de revisão."}
          </p>
        </div>
        <span className="rw-change-totals">
          <span>+{total.add}</span>
          <span>−{total.remove}</span>
        </span>
      </div>
      {diff.isLoading && workspace.server ? (
        <p className="rw-inline-state" role="status">
          Carregando alterações…
        </p>
      ) : diff.isError ? (
        <div className="rw-alert" role="alert">
          Não foi possível consultar as alterações.{" "}
          <button type="button" onClick={() => void diff.refetch()}>
            Tentar novamente
          </button>
        </div>
      ) : changes.length === 0 ? (
        <div className="rw-empty-view">
          <Icon name="code" size={28} />
          <h3>Nenhuma alteração para revisar</h3>
          <p>Os arquivos aparecerão aqui quando houver um diff disponível.</p>
        </div>
      ) : (
        <div className="rw-diff-layout">
          <nav aria-label="Arquivos alterados">
            <label className="rw-search">
              <Icon name="search" size={14} />
              <input
                aria-label="Filtrar arquivos"
                placeholder="Filtrar arquivos…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            {changes
              .filter((file) => file.path.toLowerCase().includes(filter.toLowerCase()))
              .map((file) => (
                <button
                  type="button"
                  key={file.path}
                  className={file.path === current?.path ? "selected" : ""}
                  onClick={() => {
                    setPath(file.path);
                    setCopied(false);
                  }}
                >
                  <Icon name="file" size={14} />
                  <span title={file.path}>{file.path.split("/").pop()}</span>
                  <small>+{file.additions}</small>
                </button>
              ))}
          </nav>
          <div className="rw-diff">
            <div className="rw-diff-header">
              <span title={current?.path}>{current?.path}</span>
              <button
                type="button"
                className="rw-icon-button"
                aria-label={copied ? "Patch copiado" : "Copiar patch"}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(content);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                <Icon name={copied ? "check" : "copy"} size={14} />
              </button>
            </div>
            {patch.isError ? (
              <p className="rw-inline-state" role="alert">
                Não foi possível carregar este arquivo.
              </p>
            ) : (
              <section aria-label="Diff do arquivo" className="rw-code-output">
                <pre>
                  {content.split("\n").map((line, index) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: immutable diff rows are identified by their line number.
                      key={`${index}-${line}`}
                      className={
                        line.startsWith("+")
                          ? "added"
                          : line.startsWith("-")
                            ? "removed"
                            : line.startsWith("@@")
                              ? "hunk"
                              : ""
                      }
                    >
                      <span className="rw-line-number">{index + 1}</span>
                      {line || " "}
                      {"\n"}
                    </span>
                  ))}
                </pre>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SessionOverview({
  workspace,
  activity,
  query,
  onOpen,
}: {
  workspace: Workspace;
  activity: boolean;
  query: string;
  onOpen: (id: string) => void;
}) {
  const sessions = workspace.sessions.filter(
    (s) =>
      `${s.title} ${workspace.projects.find((p) => p.id === s.projectId)?.name}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!activity || s.status === "working" || s.status === "review" || s.status === "failed")
  );
  return (
    <div className="rw-overview">
      <div className="rw-view-heading">
        <div>
          <p className="rw-eyebrow">SEU ESPAÇO DE TRABALHO</p>
          <h1>{activity ? "Atividade" : "Todas as sessões"}</h1>
          <p>
            {activity
              ? "Execuções, revisões e pontos que precisam de atenção."
              : "Encontre uma conversa e continue de onde parou."}
          </p>
        </div>
        <span className="rw-count">{sessions.length}</span>
      </div>
      <div className="rw-session-table">
        <div className="rw-table-heading">
          <span>Sessão</span>
          <span>Projeto</span>
          <span>Estado</span>
        </div>
        {sessions.length === 0 ? (
          <div className="rw-empty-view">
            <Icon name="activity" size={26} />
            <h3>{query ? "Nenhuma sessão encontrada" : "Tudo em dia por aqui"}</h3>
            <p>
              {query
                ? "Experimente buscar outro nome ou projeto."
                : "Novas execuções e revisões aparecerão neste espaço."}
            </p>
          </div>
        ) : (
          sessions.map((session) => (
            <button type="button" key={session.id} onClick={() => onOpen(session.id)}>
              <span>
                <strong>{session.title}</strong>
                <small>
                  {session.engine} <span>·</span> {session.branch}
                </small>
              </span>
              <span className="rw-table-project">
                {workspace.projects.find((p) => p.id === session.projectId)?.name}
              </span>
              <span className="rw-state">
                <i className={`rw-status-dot ${session.status}`} />
                {STATUS[session.status]}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
