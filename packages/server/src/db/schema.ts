import { Database } from "bun:sqlite";

export function initDatabase(dbPath: string): Database {
  const db = new Database(dbPath, { create: true });

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

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

    CREATE INDEX IF NOT EXISTS idx_tasks_repo_id ON tasks(repo_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_task_id ON agent_runs(task_id);
    CREATE INDEX IF NOT EXISTS idx_agent_logs_run_id ON agent_logs(run_id);
  `);

  // Migrations: add columns that may be missing from older databases
  const runCols = db.query("PRAGMA table_info(agent_runs)").all() as { name: string }[];
  const runColNames = runCols.map((c) => c.name);
  if (!runColNames.includes("current_status")) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN current_status TEXT");
  }

  const taskCols = db.query("PRAGMA table_info(tasks)").all() as { name: string }[];
  const taskColNames = taskCols.map((c) => c.name);
  if (!taskColNames.includes("model")) {
    db.exec("ALTER TABLE tasks ADD COLUMN model TEXT");
  }

  // Seed built-in prompt templates (INSERT OR IGNORE keeps them stable across restarts)
  db.exec(`
    INSERT OR IGNORE INTO prompt_templates (id, title, description, content, category, is_builtin) VALUES
    ('generate-agents-md', 'Gerar AGENTS.md', 'Analisa o código e gera instruções para agentes de IA', 'Analise todo o código deste projeto e gere um arquivo AGENTS.md na raiz com instruções claras para agentes de IA: arquitetura do projeto, convenções de código, comandos de build/test/lint, áreas sensíveis e guias de contribuição. O arquivo deve ser objetivo e útil para que futuros agentes entendam rapidamente o projeto.', 'docs', 1),
    ('security-review', 'Revisão de Segurança', 'Identifica e corrige vulnerabilidades de segurança', 'Realize uma revisão completa de segurança neste projeto. Identifique e corrija: injeção SQL/NoSQL, XSS, CSRF, exposição de credenciais ou segredos no código, dependências com vulnerabilidades conhecidas, autenticação/autorização fraca, validação insuficiente de inputs e dados sensíveis expostos em logs. Para cada problema encontrado, aplique a correção e adicione um comentário explicando o risco.', 'security', 1),
    ('performance-focus', 'Foco em Performance', 'Identifica e corrige gargalos de performance', 'Analise este projeto focando em performance. Identifique e corrija: queries N+1 ou sem índices, operações síncronas desnecessárias que bloqueiam a thread, bundles frontend grandes sem code splitting, re-renders desnecessários em componentes React, alocações de memória excessivas e processamento redundante. Priorize as otimizações de maior impacto e documente as mudanças realizadas.', 'perf', 1),
    ('ui-review', 'Revisão de UI/UX', 'Melhora a interface e experiência do usuário', 'Revise a interface deste projeto com foco em qualidade e usabilidade. Melhore: consistência visual entre componentes, acessibilidade (ARIA labels, contraste de cores, navegação por teclado, semântica HTML), responsividade em mobile, loading states e skeleton screens, empty states informativos, mensagens de erro claras e acionáveis, e UX geral dos fluxos principais. Implemente as melhorias diretamente no código.', 'ui', 1)
  `);

  return db;
}
