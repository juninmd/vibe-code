/**
 * Migration Runner for both SQLite and PostgreSQL
 * Executes polymorphic migrations (.sqlite.sql and .postgres.sql)
 */

import type { DatabaseAdapter, TransactionAdapter } from "./index";

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

export class MigrationManager {
  constructor(
    private adapter: DatabaseAdapter,
    private dbType: "sqlite" | "postgres"
  ) {}

  async initMigrationsTable(): Promise<void> {
    const createTableSQL =
      this.dbType === "sqlite"
        ? `
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          executed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          duration_ms INTEGER
        )
      `
        : `
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          duration_ms INTEGER
        )
      `;

    await this.adapter.exec(createTableSQL, []);
  }

  async getAppliedMigrations(): Promise<{ version: number; name: string }[]> {
    const result = await this.adapter.query(
      "SELECT version, name FROM schema_migrations ORDER BY version ASC",
      []
    );
    return result.rows as { version: number; name: string }[];
  }

  async getCurrentVersion(): Promise<number> {
    const result = await this.adapter.query(
      "SELECT MAX(version) as version FROM schema_migrations",
      []
    );
    return (result.rows[0]?.version as number) ?? 0;
  }

  async applyMigration(migration: Migration, direction: "up" | "down"): Promise<void> {
    await this.adapter.transaction(async (tx: TransactionAdapter) => {
      const sql = direction === "up" ? migration.up : migration.down;

      // Split SQL by semicolon and execute each statement
      const statements = sql.split(";").filter((s) => s.trim());

      for (const stmt of statements) {
        if (stmt.trim()) {
          await tx.exec(stmt, []);
        }
      }

      // Record migration
      if (direction === "up") {
        await tx.exec(`INSERT INTO schema_migrations (version, name) VALUES (?, ?)`, [
          migration.version,
          migration.name,
        ]);
      } else {
        await tx.exec(`DELETE FROM schema_migrations WHERE version = ?`, [migration.version]);
      }
    });
  }

  async migrate(migrations: Migration[], direction: "up" | "down" = "up"): Promise<number> {
    await this.initMigrationsTable();

    const applied = await this.getAppliedMigrations();
    const appliedVersions = new Set(applied.map((m) => m.version));

    let executedCount = 0;

    if (direction === "up") {
      for (const migration of migrations) {
        if (!appliedVersions.has(migration.version)) {
          await this.applyMigration(migration, "up");
          executedCount++;
        }
      }
    } else {
      // For down, go in reverse order
      for (let i = migrations.length - 1; i >= 0; i--) {
        const migration = migrations[i];
        if (appliedVersions.has(migration.version)) {
          await this.applyMigration(migration, "down");
          executedCount++;
          break; // Only one migration down at a time
        }
      }
    }

    return executedCount;
  }
}

export async function loadMigrationsFromFiles(
  _baseDir: string,
  _dbType: "sqlite" | "postgres"
): Promise<Migration[]> {
  // This would load from the migrations/ directory
  // For now, returning empty array (will be implemented with file system access)
  return [];
}
