import type { Database, Statement } from "bun:sqlite";
import {
  createArtifactQueries,
  createFindingsQueries,
  createLabelQueries,
  createLogQueries,
  createMemoryQueries,
  createMetricsQueries,
  createPromptTemplateQueries,
  createRepoQueries,
  createReviewIssueQueries,
  createReviewRoundQueries,
  createRunQueries,
  createScheduleQueries,
  createSettingsQueries,
  createTaskQueries,
  createWorkspaceQueries,
} from "./queries";
import { initDatabase } from "./schema";

/**
 * bun:sqlite closes with `sqlite3_close_v2`: the connection (and the file
 * handle) is only released once every statement created with `prepare()` or
 * `query()` is finalized or collected. On Windows that keeps the database
 * directory locked (`EBUSY`) long after `Database#close()`.
 *
 * `Database#close(true)` is not a way out — it fails with "database is locked"
 * while cached statements exist. Instead we keep weak references to the
 * statements and finalize the live ones in `close()`, which releases the
 * connection synchronously and lets callers delete the file.
 */
export function createDb(dbPath: string) {
  const raw = initDatabase(dbPath);

  const statements = new Set<WeakRef<Statement>>();
  // Statements are finalized by the collector when nothing references them;
  // drop those bookkeeping entries so a long-lived handle does not grow forever.
  const finalizer = new FinalizationRegistry<WeakRef<Statement>>((ref) => {
    statements.delete(ref);
  });
  const track = (statement: Statement) => {
    const ref = new WeakRef(statement);
    statements.add(ref);
    finalizer.register(statement, ref);
    if (statements.size > 1024) {
      for (const entry of statements) {
        if (!entry.deref()) statements.delete(entry);
      }
    }
  };
  const tracked = new Proxy(raw, {
    get(target, prop) {
      if (prop === "prepare" || prop === "query") {
        return (sql: string) => {
          const statement = prop === "prepare" ? target.prepare(sql) : target.query(sql);
          track(statement);
          return statement;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Database;

  const queries = {
    workspaces: createWorkspaceQueries(tracked),
    repos: createRepoQueries(tracked),
    tasks: createTaskQueries(tracked),
    runs: createRunQueries(tracked),
    logs: createLogQueries(tracked),
    settings: createSettingsQueries(tracked),
    prompts: createPromptTemplateQueries(tracked),
    schedules: createScheduleQueries(tracked),
    findings: createFindingsQueries(tracked),
    metrics: createMetricsQueries(tracked),
    artifacts: createArtifactQueries(tracked),
    labels: createLabelQueries(tracked),
    memories: createMemoryQueries(tracked),
    reviewRounds: createReviewRoundQueries(tracked),
    reviewIssues: createReviewIssueQueries(tracked),
  };

  return {
    /** Underlying handle. Statements prepared directly on it are not tracked. */
    raw,
    /**
     * Finalize every cached statement, then release the SQLite connection so
     * the database files (including `-wal`/`-shm`) are no longer locked.
     */
    close() {
      for (const ref of statements) {
        const statement = ref.deref();
        if (!statement) continue;
        try {
          statement.finalize();
        } catch {}
      }
      statements.clear();
      raw.close();
    },
    ...queries,
  };
}

export type Db = ReturnType<typeof createDb>;
