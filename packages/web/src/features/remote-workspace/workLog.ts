// Splits harness tool chatter out of assistant prose (idea from T3 Code's WorkLog, MIT).
export type WorkKind = "read" | "edit" | "command" | "search" | "web" | "think" | "other";
export interface WorkEntry {
  kind: WorkKind;
  label: string;
  detail?: string;
  result?: string;
  failed?: boolean;
}
export type Segment = { type: "text"; text: string } | { type: "work"; entries: WorkEntry[] };

const VERBS: Record<string, [WorkKind, string]> = {
  Reading: ["read", "Leu"],
  Listing: ["read", "Listou"],
  Writing: ["edit", "Escreveu"],
  Editing: ["edit", "Editou"],
  Deleting: ["edit", "Removeu"],
  Moving: ["edit", "Moveu"],
  Searching: ["search", "Buscou"],
  Fetching: ["web", "Acessou"],
  Running: ["command", "Executou"],
  Git: ["command", "Git"],
};
// Labels emitted by the OpenCode engine's humanizeToolCall/humanizeToolResult.
const CALL =
  /^(Reading|Writing|Editing|Deleting|Moving|Listing|Searching|Fetching|Running:|Git:)\s*(.*)$/;
const GENERIC_CALL = /^([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+){0,3}): (\S.*)$/;
const RESULT =
  /^(File saved|Command output: |Command completed|Command exited with code|Read \d+ non-empty lines?|Found \d+ match|Fetched \d+ non-empty lines?)/;
const THOUGHT = "💭 ";

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function parseCall(line: string, first: boolean): WorkEntry | null {
  const indent = indentOf(line);
  const text = line.trim();
  if (text.startsWith(THOUGHT))
    return { kind: "think", label: "Pensou", detail: text.slice(2).trim() };
  const known = CALL.exec(text);
  // Bubbles are trimmed, so only the first line may have lost its indent.
  if (known && indent < 4 && (indent === 2 || first)) {
    const verb = known[1].replace(":", "");
    const [kind, label] = VERBS[verb] ?? ["other", verb];
    const detail = known[2].trim().replace(/^"(.*)"$/, "$1");
    return { kind, label, detail: detail && detail !== "file" ? detail : undefined };
  }
  const generic = indent === 2 ? GENERIC_CALL.exec(text) : null;
  if (generic) return { kind: "other", label: generic[1], detail: generic[2] };
  return null;
}

/** Turns one assistant bubble into prose and work-log segments, keeping order. */
export function splitWork(text: string): Segment[] {
  const segments: Segment[] = [];
  const prose: string[] = [];
  let work: WorkEntry[] | null = null;
  const flushProse = () => {
    const body = prose.join("\n").trim();
    if (body) segments.push({ type: "text", text: body });
    prose.length = 0;
  };
  let first = true;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const call = parseCall(line, first);
    if (trimmed) first = false;
    if (call) {
      flushProse();
      if (!work) {
        work = [];
        segments.push({ type: "work", entries: work });
      }
      const last = work[work.length - 1];
      // The engine repeats the call label when the tool completes.
      if (!(last && last.label === call.label && last.detail === call.detail && !last.result))
        work.push(call);
      continue;
    }
    if (work && RESULT.test(trimmed)) {
      const last = work[work.length - 1];
      if (last) {
        last.result = trimmed;
        last.failed = /exited with code [1-9]/.test(trimmed);
      }
      continue;
    }
    if (work && !trimmed) continue;
    work = null;
    prose.push(line);
  }
  flushProse();
  return segments;
}

/** "3 edições · 1 comando" style summary for a collapsed work log. */
export function summarizeWork(entries: WorkEntry[]): string {
  const counts = new Map<WorkKind, number>();
  for (const entry of entries) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  const names: Record<WorkKind, [string, string]> = {
    edit: ["edição", "edições"],
    command: ["comando", "comandos"],
    read: ["leitura", "leituras"],
    search: ["busca", "buscas"],
    web: ["acesso web", "acessos web"],
    think: ["reflexão", "reflexões"],
    other: ["ferramenta", "ferramentas"],
  };
  const order: WorkKind[] = ["edit", "command", "read", "search", "web", "other", "think"];
  return order
    .filter((kind) => counts.has(kind))
    .map((kind) => {
      const n = counts.get(kind) ?? 0;
      return `${n} ${names[kind][n === 1 ? 0 : 1]}`;
    })
    .join(" · ");
}
