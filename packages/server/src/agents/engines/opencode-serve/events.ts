/**
 * Turns `opencode serve` bus events into the JSON lines `opencode run --format json`
 * prints, so both transports share one parser and the conversation reads the same.
 */

export interface ServeEvent {
  type: string;
  properties?: Record<string, unknown>;
}

export interface PermissionAsk {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
}

export interface QuestionAsk {
  id: string;
  sessionID: string;
  text: string;
}

export type MappedEvent =
  | { kind: "line"; line: Record<string, unknown> }
  | { kind: "log"; stream: "stderr" | "system"; content: string }
  | { kind: "permission"; request: PermissionAsk }
  | { kind: "question"; request: QuestionAsk }
  | { kind: "error"; message: string }
  | { kind: "idle" };

const PART_LINE_TYPE: Record<string, string> = {
  "step-start": "step_start",
  "step-finish": "step_finish",
  tool: "tool_use",
  text: "text",
};

function errorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return String(error ?? "Unknown error");
  const value = error as { name?: string; message?: string; data?: { message?: string } };
  return value.data?.message ?? value.message ?? value.name ?? "Unknown error";
}

/** Stateful because the bus repeats a part on every update; each finished part is emitted once. */
export class ServeEventMapper {
  private emitted = new Set<string>();
  private retries = new Set<string>();

  constructor(private readonly sessionID: string) {}

  map(event: ServeEvent): MappedEvent[] {
    const props = event.properties ?? {};
    const own = props.sessionID === this.sessionID;
    switch (event.type) {
      case "message.part.updated":
        return own ? this.part(props.part as Record<string, unknown> | undefined) : [];
      case "permission.asked":
        // Subagent sessions ask too; the run must answer them or it stalls.
        return [{ kind: "permission", request: props as unknown as PermissionAsk }];
      case "question.asked":
        return [{ kind: "question", request: this.question(props) }];
      case "session.status":
        return own ? this.status(props.status as Record<string, unknown> | undefined) : [];
      case "session.idle":
        return own ? [{ kind: "idle" }] : [];
      case "session.error":
        return own || !props.sessionID
          ? [{ kind: "error", message: errorMessage(props.error) }]
          : [];
      default:
        return [];
    }
  }

  private part(part: Record<string, unknown> | undefined): MappedEvent[] {
    if (!part) return [];
    const lineType = PART_LINE_TYPE[String(part.type)];
    if (!lineType || !this.finished(part)) return [];
    const id = String(part.id ?? "");
    if (this.emitted.has(id)) return [];
    this.emitted.add(id);
    return [{ kind: "line", line: { type: lineType, part } }];
  }

  /** Text streams until `time.end`; tools until completed/error. The prompt echo has no time. */
  private finished(part: Record<string, unknown>): boolean {
    if (part.type === "text") {
      const time = part.time as { end?: number } | undefined;
      return !part.synthetic && !!time?.end;
    }
    if (part.type === "tool") {
      const status = (part.state as { status?: string } | undefined)?.status;
      return status === "completed" || status === "error";
    }
    return true;
  }

  private status(status: Record<string, unknown> | undefined): MappedEvent[] {
    if (!status) return [];
    if (status.type === "idle") return [{ kind: "idle" }];
    if (status.type !== "retry") return [];
    // An action (e.g. free tier exhausted) needs the operator; retrying forever would hang the turn.
    const action = status.action as { title?: string; message?: string } | undefined;
    if (action)
      return [
        { kind: "error", message: [action.title, action.message].filter(Boolean).join(": ") },
      ];
    const key = `${status.attempt}:${status.message}`;
    if (this.retries.has(key)) return [];
    this.retries.add(key);
    return [
      {
        kind: "log",
        stream: "stderr",
        content: `[opencode] retry ${status.attempt}: ${String(status.message ?? "provider error")}`,
      },
    ];
  }

  private question(props: Record<string, unknown>): QuestionAsk {
    const questions = (props.questions as Array<{ question?: string }> | undefined) ?? [];
    return {
      id: String(props.id ?? ""),
      sessionID: String(props.sessionID ?? ""),
      text:
        questions
          .map((q) => q.question ?? "")
          .filter(Boolean)
          .join(" / ") || "Pergunta",
    };
  }
}

/** `provider/model#variant` → the prompt body's model + variant. Model ids may hold slashes. */
export function promptModel(model: string | undefined): {
  model?: { providerID: string; modelID: string };
  variant?: string;
} {
  if (!model || model === "auto-free") return {};
  const [base, variant] = model.split("#");
  const slash = base.indexOf("/");
  if (slash <= 0 || slash === base.length - 1) return variant ? { variant } : {};
  return {
    model: { providerID: base.slice(0, slash), modelID: base.slice(slash + 1) },
    ...(variant ? { variant } : {}),
  };
}
