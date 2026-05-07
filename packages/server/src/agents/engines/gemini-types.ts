export interface GeminiCliBaseEvent {
  type?: string;
  timestamp?: string;
  session_id?: string;
}

export interface GeminiCliInitEvent extends GeminiCliBaseEvent {
  type: "init";
  session_id: string;
  model: string;
}

export interface GeminiCliMessageEvent extends GeminiCliBaseEvent {
  type: "message";
  role: "user" | "assistant" | string;
  content: string;
  delta?: boolean;
}

export interface GeminiCliToolUseEvent extends GeminiCliBaseEvent {
  type: "tool_use" | "tool_call";
  tool_name?: string;
  name?: string;
  tool_id?: string;
  id?: string;
  parameters?: Record<string, unknown>;
  args?: Record<string, unknown>;
}

export interface GeminiCliToolResultEvent extends GeminiCliBaseEvent {
  type: "tool_result" | "tool_result_legacy";
  tool_id?: string;
  call_id?: string;
  status?: "success" | "error" | string;
  output?: unknown;
  result?: unknown;
}

export interface GeminiCliStatsModel {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cached?: number;
  input?: number;
}

export interface GeminiCliStats {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cached?: number;
  input?: number;
  duration_ms?: number;
  tool_calls?: number;
  models?: Record<string, GeminiCliStatsModel>;
}

export interface GeminiCliResultEvent extends GeminiCliBaseEvent {
  type: "result";
  status: "success" | "error" | string;
  stats?: GeminiCliStats;
}

export interface GeminiCliLegacyResultEvent extends GeminiCliBaseEvent {
  session_id: string;
  result: {
    text?: string;
    [key: string]: unknown;
  };
}

export interface GeminiCliLegacyErrorEvent extends GeminiCliBaseEvent {
  session_id: string;
  error: {
    message?: string;
    [key: string]: unknown;
  };
}

export interface GeminiCliTextEvent extends GeminiCliBaseEvent {
  text?: string;
  content?: string;
}

export type GeminiCliStreamEvent =
  | GeminiCliInitEvent
  | GeminiCliMessageEvent
  | GeminiCliToolUseEvent
  | GeminiCliToolResultEvent
  | GeminiCliResultEvent
  | GeminiCliLegacyResultEvent
  | GeminiCliLegacyErrorEvent
  | GeminiCliTextEvent
  | (GeminiCliBaseEvent & Record<string, unknown>);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function parseGeminiCliStreamEvent(line: string): GeminiCliStreamEvent | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? (parsed as GeminiCliStreamEvent) : null;
  } catch {
    return null;
  }
}

export function getGeminiEventType(event: GeminiCliStreamEvent): string | null {
  return typeof event.type === "string" ? event.type : null;
}

export function getGeminiText(event: GeminiCliStreamEvent): string | null {
  if ("text" in event && typeof event.text === "string") return event.text;
  if ("content" in event && typeof event.content === "string") return event.content;
  return null;
}
