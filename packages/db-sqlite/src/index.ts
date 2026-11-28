import type {
  DatabaseAdapter,
  DatabaseConfig,
  DatabaseLogger,
  DatabaseResult,
  QueryOptions,
  TransactionAdapter,
  TransactionOptions,
} from "@vibe-code/db-adapter";
import {
  ConnectionError,
  DefaultLogger,
  QueryError,
  TransactionError,
} from "@vibe-code/db-adapter";

// Bun SQLite Database type (imported at runtime, not compile-time)
type BunDatabase = any;

/**
 * SQLite Database Adapter Implementation
 * Uses Bun's built-in sqlite bindings
 */
export class SQLiteDatabaseAdapter implements DatabaseAdapter {
  private db: BunDatabase;
  private logger: DatabaseLogger;
  private inTransaction = false;

  constructor(db: BunDatabase, config: DatabaseConfig) {
    this.db = db;
    this.logger = config.logger ?? new DefaultLogger();

    // Configure pragmas for consistency
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");

    this.logger.info("SQLite adapter initialized", {
      path: config.connectionString,
    });
  }

  async query(
    sql: string,
    params: unknown[] = [],
    options?: QueryOptions
  ): Promise<DatabaseResult> {
    try {
      if (options?.enableQueryLogging || process.env.DEBUG_QUERIES === "true") {
        this.logger.debug("Executing query", { sql, params });
      }

      const stmt = this.db.prepare(sql);
      const rows = (stmt.all(...params) as Record<string, unknown>[]) ?? [];

      const result: DatabaseResult = {
        rows,
        rowCount: rows.length,
      };

      if (process.env.DEBUG_QUERIES === "true") {
        this.logger.debug("Query result", { rowCount: result.rowCount });
      }

      return result;
    } catch (error) {
      this.logger.error("Query failed", error as Error, { sql, params });
      throw new QueryError("Query execution failed", sql, params, error as Error);
    }
  }

  async exec(sql: string, params: unknown[] = []): Promise<number> {
    try {
      if (process.env.DEBUG_QUERIES === "true") {
        this.logger.debug("Executing exec", { sql, params });
      }

      const stmt = this.db.prepare(sql);
      const changes = stmt.run(...params) as { changes: number };

      if (process.env.DEBUG_QUERIES === "true") {
        this.logger.debug("Exec result", { changes: changes.changes });
      }

      return changes.changes ?? 0;
    } catch (error) {
      this.logger.error("Exec failed", error as Error, { sql, params });
      throw new QueryError("Exec failed", sql, params, error as Error);
    }
  }

  async transaction<T>(
    callback: (tx: TransactionAdapter) => Promise<T>,
    _options?: TransactionOptions
  ): Promise<T> {
    if (this.inTransaction) {
      throw new TransactionError("Nested transactions not supported in SQLite");
    }

    try {
      this.logger.debug("Starting transaction");
      this.db.exec("BEGIN");
      this.inTransaction = true;

      const txAdapter: TransactionAdapter = {
        query: (sql: string, params: unknown[], opts?: QueryOptions) =>
          this.query(sql, params, opts),
        exec: (sql: string, params: unknown[]) => this.exec(sql, params),
        rollback: async () => {
          if (this.inTransaction) {
            this.db.exec("ROLLBACK");
            this.inTransaction = false;
            this.logger.info("Transaction rolled back");
          }
        },
        commit: async () => {
          if (this.inTransaction) {
            this.db.exec("COMMIT");
            this.inTransaction = false;
            this.logger.debug("Transaction committed");
          }
        },
      };

      try {
        const result = await callback(txAdapter);

        // Auto-commit if not already committed
        if (this.inTransaction) {
          await txAdapter.commit();
        }

        return result;
      } catch (error) {
        await txAdapter.rollback();
        throw error;
      }
    } catch (error) {
      this.logger.error("Transaction failed", error as Error);
      throw new TransactionError(`Transaction failed: ${(error as Error).message}`, error as Error);
    }
  }

  async ping(): Promise<boolean> {
    try {
      const result = this.db.prepare("SELECT 1 as test").get() as { test: number } | null;
      return result?.test === 1;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      this.db.close();
      this.logger.info("SQLite adapter closed");
    } catch (error) {
      this.logger.error("Error closing connection", error as Error);
      throw new ConnectionError(`Failed to close connection: ${(error as Error).message}`);
    }
  }
}

/**
 * Create SQLite adapter from connection string (file path)
 */
export async function createSQLiteAdapter(config: DatabaseConfig): Promise<DatabaseAdapter> {
  try {
    // Using dynamic import to avoid TypeScript compile-time resolution issues
    // bun:sqlite is available at runtime in Bun runtime
    // @ts-expect-error - bun:sqlite types not available in TypeScript
    const { Database } = await import("bun:sqlite");
    const dbPath = config.connectionString.replace("sqlite://", "");

    const db = new Database(dbPath, { create: true });
    return new SQLiteDatabaseAdapter(db, config);
  } catch (error) {
    const logger = config.logger ?? new DefaultLogger();
    logger.error("Failed to create SQLite adapter", error as Error);
    throw new ConnectionError(
      `SQLite connection failed: ${(error as Error).message}`,
      error as Error
    );
  }
}
