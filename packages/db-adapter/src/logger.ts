import type { DatabaseLogger } from "./index";

/**
 * Default logger implementation
 * Uses console for output, respects NODE_ENV
 */
export class DefaultLogger implements DatabaseLogger {
  private isDev = process.env.NODE_ENV !== "production";

  debug(message: string, context?: Record<string, unknown>) {
    if (this.isDev) {
      console.debug(`[DB:DEBUG] ${message}`, context || "");
    }
  }

  info(message: string, context?: Record<string, unknown>) {
    console.info(`[DB:INFO] ${message}`, context || "");
  }

  warn(message: string, context?: Record<string, unknown>) {
    console.warn(`[DB:WARN] ${message}`, context || "");
  }

  error(message: string, error?: Error, context?: Record<string, unknown>) {
    console.error(`[DB:ERROR] ${message}`, {
      error: error?.message,
      stack: error?.stack,
      ...context,
    });
  }
}

/**
 * Silent logger (no output)
 */
export class SilentLogger implements DatabaseLogger {
  debug() {}
  info() {}
  warn() {}
  error() {}
}
