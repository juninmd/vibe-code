import { Database } from "bun:sqlite";

export function initDatabase(dbPath: string): Database {
  const db = new Database(dbPath, { create: true });

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS repositories (
      id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      name           TEXT NOT NULL,
      url            TEXT NOT NULL UNIQUE,
      default_branch TEXT NOT NULL DEFAULT 'main',
      local_path     TEXT,
      status         TEXT NOT NULL DEFAULT 'pending',
      error_message  TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      title          TEXT NOT NULL,
      description    TEXT NOT NULL DEFAULT '',
      repo_id        TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      status         TEXT NOT NULL DEFAULT 'backlog',
      engine         TEXT,
      priority       INTEGER NOT NULL DEFAULT 0,
      column_order   REAL NOT NULL DEFAULT 0,
      branch_name    TEXT,
      pr_url         TEXT,
      goal           TEXT,
      desired_outcome TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      task_id        TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      engine         TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'queued',
      current_status TEXT,
      worktree_path  TEXT,
      started_at     TEXT,
      finished_at    TEXT,
      exit_code      INTEGER,
      error_message  TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_logs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id         TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      stream         TEXT NOT NULL DEFAULT 'stdout',
      content        TEXT NOT NULL,
      timestamp      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id             TEXT PRIMARY KEY,
      github_id      TEXT NOT NULL,
      username       TEXT NOT NULL,
      display_name   TEXT,
      avatar_url     TEXT,
      access_token   TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_templates (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      title       TEXT NOT NULL,
      description TEXT,
      content     TEXT NOT NULL,
      category    TEXT,
      is_builtin  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_schedules (
      id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      task_id         TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
      cron_expression TEXT NOT NULL,
      enabled         INTEGER NOT NULL DEFAULT 1,
      deadline_at     TEXT,
      last_run_at     TEXT,
      next_run_at     TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_repo_id ON tasks(repo_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_task_id ON agent_runs(task_id);
    CREATE INDEX IF NOT EXISTS idx_agent_logs_run_id ON agent_logs(run_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
  `);

  // Migrations: add columns that may be missing from older databases
  const runCols = db.query("PRAGMA table_info(agent_runs)").all() as { name: string }[];
  const runColNames = runCols.map((c) => c.name);
  if (!runColNames.includes("current_status")) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN current_status TEXT");
  }
  if (!runColNames.includes("litellm_token_id")) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN litellm_token_id TEXT");
  }
  if (!runColNames.includes("session_id")) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN session_id TEXT");
  }

  const taskCols = db.query("PRAGMA table_info(tasks)").all() as { name: string }[];
  const taskColNames = taskCols.map((c) => c.name);
  if (!taskColNames.includes("model")) {
    db.exec("ALTER TABLE tasks ADD COLUMN model TEXT");
  }
  if (!taskColNames.includes("parent_task_id")) {
    db.exec(
      "ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL"
    );
  }
  if (!taskColNames.includes("base_branch")) {
    db.exec("ALTER TABLE tasks ADD COLUMN base_branch TEXT");
  }
  if (!taskColNames.includes("tags")) {
    db.exec("ALTER TABLE tasks ADD COLUMN tags TEXT DEFAULT '[]'");
  }
  if (!taskColNames.includes("notes")) {
    db.exec("ALTER TABLE tasks ADD COLUMN notes TEXT DEFAULT ''");
  }
  if (!taskColNames.includes("agent_id")) {
    db.exec("ALTER TABLE tasks ADD COLUMN agent_id TEXT");
  }
  if (!taskColNames.includes("workflow_id")) {
    db.exec("ALTER TABLE tasks ADD COLUMN workflow_id TEXT");
  }
  if (!taskColNames.includes("matched_skills")) {
    db.exec("ALTER TABLE tasks ADD COLUMN matched_skills TEXT DEFAULT '[]'");
  }
  // Migration: tasks.depends_on column for task dependency graph
  if (!taskColNames.includes("depends_on")) {
    db.exec("ALTER TABLE tasks ADD COLUMN depends_on TEXT DEFAULT '[]'");
  }
  // Migration: tasks.pending_approval column for human-in-the-loop gates
  if (!taskColNames.includes("pending_approval")) {
    db.exec("ALTER TABLE tasks ADD COLUMN pending_approval INTEGER NOT NULL DEFAULT 0");
  }
  // Migration: tasks.max_cost column for budget hard-stops
  if (!taskColNames.includes("max_cost")) {
    db.exec("ALTER TABLE tasks ADD COLUMN max_cost REAL");
  }
  // Migration: tasks.issue_url column for linked GitHub/GitLab issues
  if (!taskColNames.includes("issue_url")) {
    db.exec("ALTER TABLE tasks ADD COLUMN issue_url TEXT");
  }
  // Migration: tasks.issue_number for per-repo sequential issue IDs (Multica-style)
  if (!taskColNames.includes("issue_number")) {
    db.exec("ALTER TABLE tasks ADD COLUMN issue_number INTEGER");
  }
  // Paperclip-inspired: explicit goal alignment for tasks.
  if (!taskColNames.includes("goal")) {
    db.exec("ALTER TABLE tasks ADD COLUMN goal TEXT");
  }
  if (!taskColNames.includes("desired_outcome")) {
    db.exec("ALTER TABLE tasks ADD COLUMN desired_outcome TEXT");
  }

  // Migration: add provider column to repositories
  const repoCols = db.query("PRAGMA table_info(repositories)").all() as { name: string }[];
  const repoColNames = repoCols.map((c) => c.name);
  if (!repoColNames.includes("provider")) {
    db.exec("ALTER TABLE repositories ADD COLUMN provider TEXT NOT NULL DEFAULT 'github'");
  }

  // Migration: matched_skills column on agent_runs (M7.2)
  if (!runColNames.includes("matched_skills")) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN matched_skills TEXT DEFAULT '[]'");
  }

  // M-harness: state_snapshot for durable run-phase tracking & restart recovery
  if (!runColNames.includes("state_snapshot")) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN state_snapshot TEXT");
  }

  // M6.5: cost_stats for provider billing summary (JSON from provider result events)
  if (!runColNames.includes("cost_stats")) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN cost_stats TEXT");
  }

  // Labels system (Multica-inspired): colored labels per repo + task_labels join
  db.exec(`
    CREATE TABLE IF NOT EXISTS labels (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      repo_id    TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT '#6366f1',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repo_id, name)
    );
    CREATE TABLE IF NOT EXISTS task_labels (
      task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, label_id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_labels_task  ON task_labels(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_labels_label ON task_labels(label_id);
    CREATE INDEX IF NOT EXISTS idx_labels_repo       ON labels(repo_id);
  `);

  // M4.1: review_findings table
  db.exec(`
      CREATE TABLE IF NOT EXISTS review_findings (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        run_id      TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
        task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        repo_id     TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        persona     TEXT NOT NULL,
        severity    TEXT NOT NULL,
        content     TEXT NOT NULL,
        file_path   TEXT,
        resolved    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_review_findings_repo ON review_findings(repo_id, resolved, created_at);
      CREATE INDEX IF NOT EXISTS idx_review_findings_run ON review_findings(run_id);
    `);

  // Compozy-inspired: workflow_memories table (two-tier cross-task memory)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_memories (
      id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      scope        TEXT NOT NULL CHECK(scope IN ('shared','task')),
      content      TEXT NOT NULL DEFAULT '',
      needs_compaction INTEGER NOT NULL DEFAULT 0,
      compacted_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(task_id, scope)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_memories_task ON workflow_memories(task_id);
  `);

  // Compozy-inspired: review_rounds table for numbered review cycles
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_rounds (
      id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      round_number INTEGER NOT NULL DEFAULT 1,
      status       TEXT NOT NULL DEFAULT 'open',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(task_id, round_number)
    );
    CREATE INDEX IF NOT EXISTS idx_review_rounds_task ON review_rounds(task_id);
  `);

  // Compozy-inspired: review_issues table with per-issue lifecycle
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_issues (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      round_id    TEXT NOT NULL REFERENCES review_rounds(id) ON DELETE CASCADE,
      task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      persona     TEXT NOT NULL DEFAULT 'general',
      severity    TEXT NOT NULL DEFAULT 'medium',
      title       TEXT NOT NULL,
      content     TEXT NOT NULL DEFAULT '',
      file_path   TEXT,
      status      TEXT NOT NULL DEFAULT 'open',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_review_issues_round ON review_issues(round_id);
    CREATE INDEX IF NOT EXISTS idx_review_issues_task  ON review_issues(task_id, status);
  `);

  // Paperclip-inspired: Immutable Audit Log
  db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        task_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        action      TEXT NOT NULL,
        actor       TEXT NOT NULL, -- 'agent', 'human', or 'system'
        details     TEXT, -- JSON string
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_audit_logs_task ON audit_logs(task_id);
    `);

  // Paperclip-inspired: task work products / artifacts.
  db.exec(`
      CREATE TABLE IF NOT EXISTS task_artifacts (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        run_id      TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
        kind        TEXT NOT NULL,
        title       TEXT NOT NULL,
        uri         TEXT NOT NULL,
        metadata    TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(task_id, kind, uri)
      );
      CREATE INDEX IF NOT EXISTS idx_task_artifacts_task ON task_artifacts(task_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_task_artifacts_run ON task_artifacts(run_id);
    `);

  // M5.1: run_metrics table
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_metrics (
      id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      run_id              TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      task_id             TEXT NOT NULL,
      repo_id             TEXT NOT NULL,
      engine              TEXT NOT NULL,
      model               TEXT,
      matched_skills      TEXT DEFAULT '[]',
      matched_rules       TEXT DEFAULT '[]',
      duration_ms         INTEGER,
      validator_attempts  INTEGER NOT NULL DEFAULT 0,
      review_blockers     INTEGER NOT NULL DEFAULT 0,
      review_warnings     INTEGER NOT NULL DEFAULT 0,
      final_status        TEXT NOT NULL,
      pr_created          INTEGER NOT NULL DEFAULT 0,
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_run_metrics_engine ON run_metrics(engine);
    CREATE INDEX IF NOT EXISTS idx_run_metrics_repo ON run_metrics(repo_id);
  `);

  // Composite indexes for common query patterns
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_repo_status ON tasks(repo_id, status);
    CREATE INDEX IF NOT EXISTS idx_agent_logs_run_timestamp ON agent_logs(run_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_task_status ON agent_runs(task_id, status);
  `);

  // Seed built-in prompt templates (INSERT OR IGNORE keeps them stable across restarts)
  db.exec(`
    INSERT OR IGNORE INTO prompt_templates (id, title, description, content, category, is_builtin) VALUES
    ('generate-agents-md', 'Gerar AGENTS.md', 'Analisa o código e gera instruções para agentes de IA', 'Analise todo o código deste projeto e gere um arquivo AGENTS.md na raiz com instruções claras para agentes de IA: arquitetura do projeto, convenções de código, comandos de build/test/lint, áreas sensíveis e guias de contribuição. O arquivo deve ser objetivo e útil para que futuros agentes entendam rapidamente o projeto.', 'docs', 1),
    ('security-review', 'Revisão de Segurança', 'Identifica e corrige vulnerabilidades de segurança', 'Realize uma revisão completa de segurança neste projeto. Identifique e corrija: injeção SQL/NoSQL, XSS, CSRF, exposição de credenciais ou segredos no código, dependências com vulnerabilidades conhecidas, autenticação/autorização fraca, validação insuficiente de inputs e dados sensíveis expostos em logs. Para cada problema encontrado, aplique a correção e adicione um comentário explicando o risco.', 'security', 1),
    ('performance-focus', 'Foco em Performance', 'Identifica e corrige gargalos de performance', 'Analise este projeto focando em performance. Identifique e corrija: queries N+1 ou sem índices, operações síncronas desnecessárias que bloqueiam a thread, bundles frontend grandes sem code splitting, re-renders desnecessários em componentes React, alocações de memória excessivas e processamento redundante. Priorize as otimizações de maior impacto e documente as mudanças realizadas.', 'perf', 1),
    ('ui-review', 'Revisão de UI/UX', 'Melhora a interface e experiência do usuário', 'Revise a interface deste projeto com foco em qualidade e usabilidade. Melhore: consistência visual entre componentes, acessibilidade (ARIA labels, contraste de cores, navegação por teclado, semântica HTML), responsividade em mobile, loading states e skeleton screens, empty states informativos, mensagens de erro claras e acionáveis, e UX geral dos fluxos principais. Implemente as melhorias diretamente no código.', 'ui', 1),
    ('kanban-trello-clone', 'Kanban — Clone do Trello', 'Cria um clone completo do Trello do zero', 'Crie um clone completo do Trello chamado KanbanFlow usando as seguintes especificações:

## Stack
- React 18 + TypeScript + Vite
- TailwindCSS (dark theme principal)
- @dnd-kit/core + @dnd-kit/sortable para drag-and-drop
- Zustand para gerenciamento de estado global
- Persistência em localStorage (sem backend necessário)

## Estrutura de arquivos
src/
  components/
    Board/        — BoardView, BoardHeader, BoardMenu
    Column/       — ColumnView, ColumnHeader, AddCardButton
    Card/         — CardView, CardDetail, CardBadges
    ui/           — Button, Input, Textarea, Modal, Badge, Tooltip
  store/
    boardStore.ts — Zustand store principal
    types.ts      — Todas as interfaces TypeScript
  hooks/
    useDnD.ts     — Drag-and-drop handlers
    useLocalStorage.ts
  App.tsx
  main.tsx

## Funcionalidades obrigatórias

### Boards
- Criar, renomear e deletar boards
- Selecionar board ativo via sidebar
- Board padrão "My Board" na inicialização

### Colunas (Lists)
- Criar, renomear, reordenar e deletar colunas
- Drag-and-drop de colunas entre si
- Contador de cards no header da coluna

### Cards
- Criar card com título (inline quick-add)
- Reordenar cards dentro da coluna
- Mover cards entre colunas (drag-and-drop)
- Modal de detalhes ao clicar no card com:
  - Título editável
  - Descrição (markdown preview básico)
  - Labels coloridas (vermelho, laranja, amarelo, verde, azul, roxo)
  - Data de vencimento com indicador de atraso
  - Checklist com progresso (barra + %)
  - Comentários com timestamp
  - Botão "Arquivar" e "Mover para coluna"

### UX
- Tema escuro moderno (zinc/slate palette)
- Animações suaves no drag-and-drop
- Tooltip nos ícones
- Kbd shortcuts: N = novo card, Esc = fechar modal
- Empty state com ilustração simples em SVG inline
- Responsive (funciona em tablet/mobile)

## Qualidade
- Zero any no TypeScript
- Todos os componentes com React.memo quando aplicável
- Acessibilidade: aria-labels, role corretos, foco visível
- README.md com print screen em ASCII art e instruções

Ao terminar, rode "npm run build" para garantir zero erros de compilação.', 'app', 1),
    ('refactor-readability', 'Refactor for Readability', 'Improve code clarity and maintainability', 'Refactor this code to improve readability, maintainability, and follow best practices:\n\nFocus on:\n- Clear variable and function naming\n- Reducing complexity and nesting\n- Adding helpful comments for complex logic\n- Breaking down large functions into smaller ones\n- Following the project''s established patterns\n\nKeep all functionality unchanged.', 'code', 1),
    ('add-unit-tests', 'Add Unit Tests', 'Write comprehensive unit tests for existing code', 'Write comprehensive unit tests for this code using the project''s testing framework.\n\nRequirements:\n- Test happy paths and edge cases\n- Achieve at least 90% code coverage\n- Use descriptive test names\n- Follow the project''s testing conventions\n- Include setup/teardown where needed\n- Mock external dependencies appropriately', 'code', 1),
    ('seo-optimization', 'SEO Optimization', 'Improve content for search engines', 'Analyze and optimize this content for SEO:\n\nFocus on:\n- Keyword research and integration\n- Meta description and title tag optimization\n- Heading structure (H1, H2, H3)\n- Internal and external linking opportunities\n- Content length and readability\n- Schema markup suggestions (if applicable)\n\nProvide specific recommendations for each section.', 'content', 1),
    ('technical-documentation', 'Technical Documentation', 'Create clear, comprehensive technical documentation', 'Write clear, user-friendly technical documentation for this feature/code:\n\nInclude:\n- Overview and use cases\n- Prerequisites and installation steps\n- Step-by-step usage examples\n- Common pitfalls and troubleshooting\n- API documentation (if applicable)\n- Links to related resources\n\nTarget audience: Developers with basic knowledge of the domain.\nUse Markdown format with code examples.', 'content', 1),
    ('cicd-review', 'CI/CD Pipeline Review', 'Analyze and optimize CI/CD configuration', 'Review this CI/CD pipeline configuration for best practices:\n\nEvaluate:\n- Build performance and caching strategies\n- Security (secrets management, permissions)\n- Test coverage and failure detection\n- Deployment safety checks and rollback strategy\n- Monitoring and alerting after deployment\n- Cost optimization opportunities\n\nProvide specific recommendations for improvement.', 'devops', 1),
    ('iac-audit', 'Infrastructure as Code Audit', 'Audit IaC for security, scalability, and cost', 'Audit this Infrastructure as Code (Terraform/CloudFormation/etc.):\n\nCheck for:\n- Security best practices (encryption, least privilege, network isolation)\n- Scalability and performance\n- Cost optimization opportunities\n- Disaster recovery and backup strategy\n- Monitoring and logging setup\n- Documentation and tagging standards\n\nProvide detailed recommendations with code examples.', 'devops', 1),
    ('a11y-review', 'Accessibility (A11y) Review', 'Audit UI for accessibility compliance', 'Perform an accessibility audit of this UI component/page:\n\nCheck for:\n- WCAG 2.1 AA compliance\n- Keyboard navigation and focus management\n- Screen reader compatibility (ARIA labels, roles)\n- Color contrast ratios\n- Touch target sizes (mobile friendliness)\n- Form accessibility (labels, error messages)\n\nProvide specific violations and fixes with code examples.', 'ui', 1),
    ('component-design-audit', 'Component Design System Audit', 'Review component consistency with design system', 'Audit this React component for design system consistency:\n\nEvaluate:\n- Visual consistency with design tokens (colors, typography, spacing)\n- Responsive design implementation\n- Variant coverage and prop documentation\n- Accessibility considerations\n- Performance (unnecessary re-renders, bundle size)\n- Storybook/documentation quality\n\nSuggest improvements for consistency and maintainability.', 'ui', 1)
  `);

  return db;
}
