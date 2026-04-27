/**
 * Database Adapter Interface
 *
 * Defines a polymorphic interface for database access patterns.
 * Implementations: SQLite (dev), PostgreSQL (prod)
 */

export interface DatabaseResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface QueryOptions {
  timeout?: number;
  readOnly?: boolean;
  enableQueryLogging?: boolean;
}

export interface TransactionOptions {
  isolationLevel?: "READ UNCOMMITTED" | "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";
}

/**
 * Core Database Adapter Interface
 * All database operations go through this interface.
 */
export interface DatabaseAdapter {
  /**
   * Execute a query that returns rows
   * @param sql SQL query string (use parameterized queries)
   * @param params Array of parameters for parameterized query
   * @param options Query options (timeout, readOnly)
   * @returns Result with rows array and row count
   */
  query(sql: string, params: unknown[], options?: QueryOptions): Promise<DatabaseResult>;

  /**
   * Execute a query that doesn't return rows (INSERT, UPDATE, DELETE)
   * @param sql SQL query string
   * @param params Array of parameters
   * @returns Affected row count
   */
  exec(sql: string, params: unknown[]): Promise<number>;

  /**
   * Execute multiple queries in a single transaction
   * @param callback Function that receives a transaction adapter
   * @param options Transaction options (isolation level)
   * @returns Return value from callback
   */
  transaction<T>(
    callback: (tx: TransactionAdapter) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T>;

  /**
   * Check database connection health
   * @returns true if connected, false otherwise
   */
  ping(): Promise<boolean>;

  /**
   * Close database connection
   */
  close(): Promise<void>;
}

/**
 * Transaction Adapter Interface
 * Used within a transaction() callback for atomic operations
 */
export interface TransactionAdapter {
  /**
   * Query within transaction
   */
  query(sql: string, params: unknown[], options?: QueryOptions): Promise<DatabaseResult>;

  /**
   * Exec within transaction
   */
  exec(sql: string, params: unknown[]): Promise<number>;

  /**
   * Rollback current transaction (explicit)
   */
  rollback(): Promise<void>;

  /**
   * Commit current transaction (usually implicit)
   */
  commit(): Promise<void>;
}

/**
 * Migration Runner Interface
 * Used to execute polymorphic migrations (SQLite + PostgreSQL)
 */
export interface MigrationRunner {
  /**
   * Run pending migrations up
   * @returns Number of migrations executed
   */
  migrateUp(): Promise<number>;

  /**
   * Rollback last migration down
   * @returns Number of migrations rolled back
   */
  migrateDown(): Promise<number>;

  /**
   * Get current migration version
   */
  getCurrentVersion(): Promise<number>;

  /**
   * Get list of all migrations (up and down)
   */
  listMigrations(): Promise<{ version: number; name: string; status: "pending" | "applied" }[]>;
}

/**
 * Logging interface for database operations
 */
export interface DatabaseLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
}

/**
 * Configuration for database adapter initialization
 */
export interface DatabaseConfig {
  /** Database URL or connection string */
  connectionString: string;

  /** Logger instance */
  logger?: DatabaseLogger;

  /** Pool size (for PostgreSQL) */
  poolSize?: number;

  /** Connection timeout (ms) */
  connectionTimeout?: number;

  /** Enable query logging (debug mode) */
  enableQueryLogging?: boolean;
}

/**
 * Factory function type for creating database adapters
 */
export type AdapterFactory = (config: DatabaseConfig) => Promise<DatabaseAdapter>;

export {
  ConnectionError,
  DatabaseError,
  MigrationError,
  QueryError,
  TransactionError,
  ValidationError,
} from "./errors";
export { DefaultLogger, SilentLogger } from "./logger";
