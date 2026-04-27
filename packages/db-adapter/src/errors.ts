/**
 * Database Adapter Errors
 */

export class DatabaseError extends Error {
  constructor(
    message: string,
    public code: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}

export class QueryError extends DatabaseError {
  constructor(message: string, sql: string, params: unknown[], originalError?: Error) {
    super(
      `Query error: ${message}\nSQL: ${sql}\nParams: ${JSON.stringify(params)}`,
      "QUERY_ERROR",
      originalError
    );
    this.name = "QueryError";
  }
}

export class ConnectionError extends DatabaseError {
  constructor(message: string, originalError?: Error) {
    super(`Connection error: ${message}`, "CONNECTION_ERROR", originalError);
    this.name = "ConnectionError";
  }
}

export class TransactionError extends DatabaseError {
  constructor(message: string, originalError?: Error) {
    super(`Transaction error: ${message}`, "TRANSACTION_ERROR", originalError);
    this.name = "TransactionError";
  }
}

export class MigrationError extends DatabaseError {
  constructor(message: string, version?: number, originalError?: Error) {
    super(
      `Migration error: ${message}${version ? ` (version: ${version})` : ""}`,
      "MIGRATION_ERROR",
      originalError
    );
    this.name = "MigrationError";
  }
}

export class ValidationError extends DatabaseError {
  constructor(message: string) {
    super(`Validation error: ${message}`, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}
