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
  ValidationError,
} from "@vibe-code/db-adapter";
import type { Client as PgClient, QueryResult } from "pg";
import Pool from "pg-pool";

/**
 * PostgreSQL Database Adapter Implementation
 * Uses pg library with connection pooling
 */
export class PostgreSQLDatabaseAdapter implements DatabaseAdapter {
  private pool: Pool<PgClient>;
  private logger: DatabaseLogger;

  constructor(pool: Pool<PgClient>, config: DatabaseConfig) {
    this.pool = pool;
    this.logger = config.logger ?? new DefaultLogger();

    this.logger.info("PostgreSQL adapter initialized", {
      connectionString: config.connectionString?.replace(/password[=:][^@]*@/, "***@"),
    });
  }

  async query(
    sql: string,
    params: unknown[] = [],
    _options?: QueryOptions
  ): Promise<DatabaseResult> {
    const client = await this.pool.connect();

    try {
      if (process.env.DEBUG_QUERIES === "true") {
        this.logger.debug("Executing query", { sql, params });
      }

      const result: QueryResult<Record<string, unknown>> = await client.query(sql, params);

      if (process.env.DEBUG_QUERIES === "true") {
        this.logger.debug("Query result", { rowCount: result.rowCount });
      }

      return {
        rows: result.rows ?? [],
        rowCount: result.rowCount ?? 0,
      };
    } catch (error) {
      this.logger.error("Query failed", error as Error, { sql, params });
      throw new QueryError("Query execution failed", sql, params, error as Error);
    } finally {
      client.release();
    }
  }

  async exec(sql: string, params: unknown[] = []): Promise<number> {
    const client = await this.pool.connect();

    try {
      if (process.env.DEBUG_QUERIES === "true") {
        this.logger.debug("Executing exec", { sql, params });
      }

      const result: QueryResult = await client.query(sql, params);

      if (process.env.DEBUG_QUERIES === "true") {
        this.logger.debug("Exec result", { changes: result.rowCount });
      }

      return result.rowCount ?? 0;
    } catch (error) {
      this.logger.error("Exec failed", error as Error, { sql, params });
      throw new QueryError("Exec failed", sql, params, error as Error);
    } finally {
      client.release();
    }
  }

  async transaction<T>(
    callback: (tx: TransactionAdapter) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      this.logger.debug("Starting transaction");

      const isolationLevel = options?.isolationLevel ?? "READ COMMITTED";
      await client.query(`BEGIN ISOLATION LEVEL ${isolationLevel}`);

      const txAdapter: TransactionAdapter = {
        query: async (sql: string, params: unknown[], _opts?: QueryOptions) => {
          const result: QueryResult<Record<string, unknown>> = await client.query(sql, params);
          return {
            rows: result.rows ?? [],
            rowCount: result.rowCount ?? 0,
          };
        },
        exec: async (sql: string, params: unknown[]) => {
          const result: QueryResult = await client.query(sql, params);
          return result.rowCount ?? 0;
        },
        rollback: async () => {
          await client.query("ROLLBACK");
          this.logger.info("Transaction rolled back");
        },
        commit: async () => {
          await client.query("COMMIT");
          this.logger.debug("Transaction committed");
        },
      };

      try {
        const result = await callback(txAdapter);
        await txAdapter.commit();
        return result;
      } catch (error) {
        await txAdapter.rollback();
        throw error;
      }
    } catch (error) {
      this.logger.error("Transaction failed", error as Error);
      throw new TransactionError(`Transaction failed: ${(error as Error).message}`, error as Error);
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    const client = await this.pool.connect();

    try {
      const result = await client.query("SELECT 1 as test");
      return result.rows?.[0]?.test === 1;
    } catch {
      return false;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    try {
      await this.pool.end();
      this.logger.info("PostgreSQL adapter closed");
    } catch (error) {
      this.logger.error("Error closing connection", error as Error);
      throw new ConnectionError(`Failed to close connection: ${(error as Error).message}`);
    }
  }
}

/**
 * Create PostgreSQL adapter from connection string
 */
export async function createPostgreSQLAdapter(config: DatabaseConfig): Promise<DatabaseAdapter> {
  if (!config.connectionString) {
    throw new ValidationError("PostgreSQL connection string is required");
  }

  try {
    const pool = new Pool({
      connectionString: config.connectionString,
      max: config.poolSize ?? 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: config.connectionTimeout ?? 5000,
    });

    return new PostgreSQLDatabaseAdapter(pool, config);
  } catch (error) {
    const logger = config.logger ?? new DefaultLogger();
    logger.error("Failed to create PostgreSQL adapter", error as Error);
    throw new ConnectionError(
      `PostgreSQL connection failed: ${(error as Error).message}`,
      error as Error
    );
  }
}
