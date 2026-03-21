export interface AgentEvent {
  type: "log" | "status" | "error" | "complete";
  stream?: "stdout" | "stderr" | "system";
  content?: string;
  exitCode?: number;
}

export interface EngineOptions {
  runId: string;
  signal?: AbortSignal;
}

export interface AgentEngine {
  /** Unique identifier, e.g., "claude-code" */
  name: string;

  /** Human-readable label */
  displayName: string;

  /** Check if the CLI tool is installed and accessible */
  isAvailable(): Promise<boolean>;

  /**
   * Execute a task in the given directory.
   * Yields events as the agent works.
   */
  execute(prompt: string, workdir: string, options?: EngineOptions): AsyncGenerator<AgentEvent>;

  /** Kill a running agent process */
  abort(runId: string): void;

  /** Send input to a running agent's stdin */
  sendInput(runId: string, input: string): boolean;
}
