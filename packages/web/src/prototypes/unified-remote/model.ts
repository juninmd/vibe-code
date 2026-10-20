import type { AgentLog, Repository, TaskWithRun } from "@vibe-code/shared";

export type SessionStatus = "working" | "waiting" | "review" | "failed";
export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  activity?: string[];
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
  branch: string;
  updatedAt: string;
  messages: Message[];
  changes: Change[];
  reviewAvailable?: boolean;
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
          text: "Quero desenvolver de qualquer lugar, com uma experiência parecida com o Claude Code. Repositórios, conversa e execução precisam fazer parte do mesmo fluxo.",
        },
        {
          id: "m2",
          role: "assistant",
          text: "Podemos organizar tudo em torno de **projetos e sessões**.\n\nCada sessão mantém a conversa, o terminal e as alterações na mesma área de trabalho. A navegação lateral continua disponível e o contexto acompanha o que você está fazendo.",
          activity: [
            "Explorar a navegação por projetos",
            "Organizar as três visualizações da sessão",
            "Preparar exemplos de alteração para revisão",
          ],
        },
        {
          id: "m3",
          role: "user",
          text: "E se eu quiser conferir o terminal ou revisar o código sem perder a conversa?",
        },
        {
          id: "m4",
          role: "assistant",
          text: "Use as abas **Conversa**, **Terminal** e **Alterações** logo acima. Elas compartilham a mesma sessão, branch e contexto.\n\nO painel à direita reúne o ambiente, a execução e os arquivos da revisão. Você pode recolhê-lo para dar mais espaço ao código.\n\nExperimente abrir as alterações ou enviar uma nova mensagem abaixo.",
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
  return { id: repo.id, name: repo.name, owner: "servidor", branch: repo.defaultBranch };
}
export function sessionFromTask(task: TaskWithRun): Session {
  return {
    id: task.id,
    projectId: task.repoId,
    title: task.title,
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
    model: task.model ?? "Modelo padrão",
    branch: task.branchName ?? task.baseBranch ?? task.repo?.defaultBranch ?? "—",
    updatedAt: task.updatedAt,
    messages: [],
    changes: [],
    reviewAvailable: !!task.branchName,
  };
}
export function messagesFromLogs(session: Session, logs: AgentLog[]): Message[] {
  const messages: Message[] = session.description
    ? [{ id: "initial", role: "user", text: session.description }]
    : [];
  for (const log of logs) {
    if (log.stream !== "stdout" && log.stream !== "stdin") continue;
    const role = log.stream === "stdin" ? "user" : "assistant";
    const previous = messages[messages.length - 1];
    if (previous?.role === role && role === "assistant") previous.text += `\n${log.content}`;
    else messages.push({ id: `log-${log.id}`, role, text: log.content });
  }
  return messages;
}
export function demoReply(prompt: string): string {
  if (/teste|valid|revis/i.test(prompt))
    return "Para revisar essa mudança, eu começaria pelos critérios de aceite e pelos cenários que podem regredir.\n\n1. Conferir o comportamento esperado.\n2. Executar as verificações do projeto.\n3. Revisar o diff e registrar as evidências.\n\nVocê pode explorar um exemplo de diff na aba **Alterações**.";
  return "Vamos trabalhar nessa ideia. Eu começaria entendendo o contexto do projeto, dividiria a mudança em uma etapa pequena e depois revisaria o resultado com você.\n\nVocê pode continuar esta conversa, consultar o terminal ou explorar as alterações sem sair da sessão.";
}
