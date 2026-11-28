import {
  type AgentLog,
  REMOTE_SESSION_TAG,
  type Repository,
  SUPERVISED_TAG,
  type TaskWithRun,
} from "@vibe-code/shared";
import { buildChatItems } from "../../components/code-mode/chat";
import { splitWork, type WorkEntry } from "./workEntries";

export type SessionStatus = "working" | "waiting" | "review" | "failed";
export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  activity?: string[];
  /** Tool calls the agent made between prose replies. */
  work?: WorkEntry[];
  /** Engine that wrote this reply, when the session changed engine mid-conversation. */
  engine?: string;
  /** Turn a user message started (server sessions), so the conversation can rewind to it. */
  runId?: string;
  /** Marks the point where another engine took over the conversation. */
  handoff?: { from: string; to: string };
  /** When the log line was written, for the relative time next to the turn. */
  at?: string;
  /** The harness failed this turn; rendered as an error notice, not as prose. */
  error?: boolean;
}
export interface Change {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
}
export interface Project {
  id: string;
  name: string;
  owner: string;
  branch: string;
  /** Engine/model new sessions in this project start with. */
  defaultEngine?: string | null;
  defaultModel?: string | null;
}
export interface Session {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: SessionStatus;
  engine: string;
  model: string;
  effort?: string;
  conversational?: boolean;
  /** Edits, commands and web fetches wait for the operator's approval. */
  supervised?: boolean;
  tags?: string[];
  branch: string;
  updatedAt: string;
  messages: Message[];
  changes: Change[];
  reviewAvailable?: boolean;
  /** Pull request opened from this session, when there is one. */
  prUrl?: string | null;
}
export const STATUS: Record<SessionStatus, string> = {
  working: "Em execução",
  waiting: "Aguardando mensagem",
  review: "Em revisão",
  failed: "Precisa de atenção",
};
export const DEMO_PROJECTS: Project[] = [
  { id: "control", name: "control-plane", owner: "studio", branch: "main" },
  { id: "website", name: "website", owner: "studio", branch: "main" },
  { id: "ui", name: "design-system", owner: "studio", branch: "develop" },
];
const CHANGES: Change[] = [
  {
    path: "src/workspace/WorkspaceShell.tsx",
    additions: 32,
    deletions: 18,
    patch:
      "@@ -12,9 +12,10 @@\n export function WorkspaceShell() {\n-  return <ModeSwitcher />;\n+  return (\n+    <SessionWorkspace>\n+      <SessionNavigation />\n+      <SessionTabs tabs={['conversation', 'terminal', 'changes']} />\n+      <SessionContext />\n+    </SessionWorkspace>\n+  );\n }",
  },
  {
    path: "src/workspace/SessionTabs.tsx",
    additions: 24,
    deletions: 0,
    patch:
      '@@ -0,0 +1,8 @@\n+export function SessionTabs({ tabs }) {\n+  return (\n+    <nav aria-label="Session views">\n+      {tabs.map(tab => <SessionTab key={tab} value={tab} />)}\n+    </nav>\n+  );\n+}',
  },
  {
    path: "src/workspace/workspace.css",
    additions: 16,
    deletions: 6,
    patch:
      "@@ -4,6 +4,9 @@\n .workspace {\n-  display: flex;\n+  display: grid;\n+  grid-template-columns: 248px minmax(0, 1fr) 280px;\n+  height: 100dvh;\n+  overflow: hidden;\n }",
  },
];

export function initialSessions(): Session[] {
  return [
    {
      id: "unified",
      projectId: "control",
      title: "Unificar a experiência remota",
      description: "Uma área de trabalho para desenvolver de qualquer lugar.",
      status: "waiting",
      engine: "opencode",
      model: "Padrão do OpenCode",
      branch: "feat/unified-workspace",
      updatedAt: new Date().toISOString(),
      changes: CHANGES,
      messages: [
        {
          id: "m1",
          role: "user",
          at: new Date(Date.now() - 15 * 60_000).toISOString(),
          text: "Quero desenvolver de qualquer lugar, com uma experiência parecida com o Claude Code. Repositórios, conversa e execução precisam fazer parte do mesmo fluxo.",
        },
        {
          id: "m2",
          role: "assistant",
          at: new Date(Date.now() - 14 * 60_000).toISOString(),
          text: "Podemos organizar tudo em torno de **projetos e sessões**.\n\nCada sessão mantém a conversa, o terminal e as alterações na mesma área de trabalho. A navegação lateral continua disponível e o contexto acompanha o que você está fazendo.",
          activity: [
            "Explorar a navegação por projetos",
            "Organizar as três visualizações da sessão",
            "Preparar exemplos de alteração para revisão",
          ],
        },
        {
          id: "m2-work",
          role: "assistant",
          at: new Date(Date.now() - 13 * 60_000).toISOString(),
          text: "",
          work: [
            {
              kind: "read",
              label: "Leu",
              detail: "src/workspace/WorkspaceShell.tsx",
              result: "Read 48 non-empty lines",
            },
            {
              kind: "search",
              label: "Buscou",
              detail: '"SessionTabs"',
              result: "Found 6 matches",
            },
            {
              kind: "edit",
              label: "Editou",
              detail: "src/workspace/SessionTabs.tsx",
              result: "File saved",
            },
            {
              kind: "command",
              label: "Executou",
              detail: "bun run typecheck",
              result: "Command completed",
            },
          ],
        },
        {
          id: "m3",
          role: "user",
          at: new Date(Date.now() - 11 * 60_000).toISOString(),
          text: "E se eu quiser conferir o terminal ou revisar o código sem perder a conversa?",
        },
        {
          id: "m4",
          role: "assistant",
          at: new Date(Date.now() - 10 * 60_000).toISOString(),
          text: "Use as abas **Conversa**, **Terminal** e **Alterações** logo acima. Elas compartilham a mesma sessão, branch e contexto.\n\nO painel à direita reúne o ambiente, a execução e os arquivos da revisão. Você pode recolhê-lo para dar mais espaço ao código.\n\n```ts\nconst tabs = ['conversation', 'terminal', 'changes'];\n```\n\nExperimente abrir as alterações ou enviar uma nova mensagem abaixo.",
        },
      ],
    },
    {
      id: "auth",
      projectId: "website",
      title: "Revisar o fluxo de autenticação",
      description: "Simplificar login e estados de erro.",
      status: "review",
      engine: "opencode",
      model: "Padrão do OpenCode",
      branch: "fix/auth-flow",
      updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
      changes: CHANGES.slice(1, 2),
      messages: [
        { id: "auth-1", role: "user", text: "Como podemos deixar o login mais claro?" },
        {
          id: "auth-2",
          role: "assistant",
          text: "A proposta é reunir os estados de carregamento, sucesso e erro em um fluxo previsível. Abra **Alterações** para explorar um exemplo de revisão.",
        },
      ],
    },
    {
      id: "components",
      projectId: "ui",
      title: "Explorar os componentes da interface",
      description: "Inventário de componentes e padrões de interação.",
      status: "waiting",
      engine: "opencode",
      model: "Padrão do OpenCode",
      branch: "docs/components",
      updatedAt: new Date(Date.now() - 86_400_000).toISOString(),
      changes: [],
      messages: [
        {
          id: "comp-1",
          role: "assistant",
          text: "Por onde você gostaria de começar? Podemos explorar a navegação, os formulários ou os estados vazios.",
        },
      ],
    },
  ];
}

export function projectFromRepo(repo: Repository): Project {
  return {
    id: repo.id,
    name: repo.name,
    owner: "servidor",
    branch: repo.defaultBranch,
    defaultEngine: repo.defaultEngine ?? null,
    defaultModel: repo.defaultModel ?? null,
  };
}
/**
 * What the session list shows: the first line of the request, like Claude Code,
 * instead of the generated `<host>-<slug>` name (which stays the branch/name).
 */
export function sessionTitle(task: Pick<TaskWithRun, "title" | "description">): string {
  const line = (task.description ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
    .find(Boolean);
  if (!line) return task.title;
  return line.length > 80 ? `${line.slice(0, 77).trimEnd()}…` : line;
}
export function sessionFromTask(task: TaskWithRun): Session {
  return {
    id: task.id,
    projectId: task.repoId,
    title: sessionTitle(task),
    description: task.description,
    status:
      task.status === "in_progress"
        ? "working"
        : task.status === "review"
          ? "review"
          : task.status === "failed" || task.status === "blocked"
            ? "failed"
            : "waiting",
    engine: task.latestRun?.engine ?? task.engine ?? "Automático",
    model: task.model?.split("#")[0] ?? "Modelo padrão",
    effort: task.model?.split("#")[1],
    conversational: task.tags.includes(REMOTE_SESSION_TAG),
    supervised: task.tags.includes(SUPERVISED_TAG),
    tags: task.tags,
    branch: task.branchName ?? task.baseBranch ?? task.repo?.defaultBranch ?? "—",
    updatedAt: task.updatedAt,
    messages: [],
    changes: [],
    reviewAvailable: !!task.branchName,
    prUrl: task.prUrl,
  };
}
const HANDOFF = /\[handoff\] (\S+) → (\S+):/;

export function messagesFromLogs(session: Session, logs: AgentLog[]): Message[] {
  const items = buildChatItems(
    {
      id: session.id,
      description: session.description,
      title: session.title,
      goal: null,
      createdAt: session.updatedAt,
    },
    logs
  );
  // Replies before the first handoff belong to the engine it handed off from.
  const first = items
    .map((item) => item.kind === "system" && HANDOFF.exec(item.text))
    .find(Boolean);
  let engine = first ? first[1] : session.engine;
  return items.flatMap((item): Message[] => {
    if (item.kind === "system") {
      const handoff = HANDOFF.exec(item.text);
      if (!handoff) return [];
      engine = handoff[2];
      return [
        {
          id: item.id,
          role: "assistant",
          text: "",
          at: item.timestamp,
          handoff: { from: handoff[1], to: engine },
        },
      ];
    }
    if (item.kind === "prompt")
      return [
        {
          id: item.id,
          role: "user",
          text: item.text,
          at: item.timestamp,
          ...(item.runId ? { runId: item.runId } : {}),
        },
      ];
    if (item.kind === "error")
      return [
        {
          id: item.id,
          role: "assistant",
          engine,
          text: item.text,
          at: item.timestamp,
          error: true,
        },
      ];
    return splitWork(item.text).map((segment, index) => ({
      id: `${item.id}-${index}`,
      role: "assistant",
      engine,
      at: item.timestamp,
      ...(segment.type === "text" ? { text: segment.text } : { text: "", work: segment.entries }),
    }));
  });
}
export function demoReply(prompt: string): string {
  if (/teste|valid|revis/i.test(prompt))
    return "Para revisar essa mudança, eu começaria pelos critérios de aceite e pelos cenários que podem regredir.\n\n1. Conferir o comportamento esperado.\n2. Executar as verificações do projeto.\n3. Revisar o diff e registrar as evidências.\n\nVocê pode explorar um exemplo de diff na aba **Alterações**.";
  return "Vamos trabalhar nessa ideia. Eu começaria entendendo o contexto do projeto, dividiria a mudança em uma etapa pequena e depois revisaria o resultado com você.\n\nVocê pode continuar esta conversa, consultar o terminal ou explorar as alterações sem sair da sessão.";
}
