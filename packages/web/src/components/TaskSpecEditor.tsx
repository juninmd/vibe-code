import type { TaskSpec } from "@vibe-code/shared";
import { useState } from "react";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

interface TaskSpecEditorProps {
  value: TaskSpec;
  onChange: (spec: TaskSpec) => void;
}

function DynamicList({
  label,
  placeholder,
  items,
  onChange,
}: {
  label: string;
  placeholder: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const handleAdd = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...items, trimmed]);
    setDraft("");
  };

  const handleRemove = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  return (
    <div>
      <div className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      {items.length > 0 && (
        <ul className="space-y-1 mb-2">
          {items.map((item) => (
            <li
              key={item}
              className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md"
              style={{ background: "var(--bg-input)", color: "var(--text-primary)" }}
            >
              <span className="flex-1">{item}</span>
              <button
                type="button"
                onClick={() => handleRemove(items.indexOf(item))}
                className="text-dimmed hover:text-danger cursor-pointer shrink-0"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <button
          type="button"
          onClick={handleAdd}
          className="text-xs px-3 py-1.5 rounded-md border transition-colors cursor-pointer shrink-0"
          style={{
            borderColor: "var(--border-default)",
            color: "var(--text-muted)",
            background: "transparent",
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function TaskSpecEditor({ value, onChange }: TaskSpecEditorProps) {
  return (
    <div className="space-y-4">
      <div>
        <div className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
          Objetivo *
        </div>
        <Textarea
          value={value.objective}
          onChange={(e) => onChange({ ...value, objective: e.target.value })}
          placeholder="O que deve ser construído ou alterado?"
          rows={2}
        />
      </div>

      <DynamicList
        label="Critérios de Aceite"
        placeholder="Como saber que está pronto? (Enter para adicionar)"
        items={value.acceptance}
        onChange={(acceptance) => onChange({ ...value, acceptance })}
      />

      <DynamicList
        label="Restrições"
        placeholder="Requisitos técnicos ou de negócio (Enter para adicionar)"
        items={value.constraints}
        onChange={(constraints) => onChange({ ...value, constraints })}
      />

      <div>
        <div className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>
          Contexto adicional
        </div>
        <Textarea
          value={value.context}
          onChange={(e) => onChange({ ...value, context: e.target.value })}
          placeholder="Links, referências, tarefas relacionadas..."
          rows={2}
        />
      </div>

      <DynamicList
        label="Fora de Escopo"
        placeholder="O que NÃO deve ser alterado? (Enter para adicionar)"
        items={value.outOfScope}
        onChange={(outOfScope) => onChange({ ...value, outOfScope })}
      />
    </div>
  );
}

/**
 * Convert a TaskSpec into a markdown-formatted description suitable for prompt injection.
 */
export function taskSpecToDescription(spec: TaskSpec): string {
  const parts: string[] = [];

  if (spec.objective.trim()) {
    parts.push(`## Objective\n${spec.objective.trim()}`);
  }

  if (spec.acceptance.length > 0) {
    parts.push(`## Acceptance Criteria\n${spec.acceptance.map((a) => `- ${a}`).join("\n")}`);
  }

  if (spec.constraints.length > 0) {
    parts.push(`## Constraints\n${spec.constraints.map((c) => `- ${c}`).join("\n")}`);
  }

  if (spec.context.trim()) {
    parts.push(`## Context\n${spec.context.trim()}`);
  }

  if (spec.outOfScope.length > 0) {
    parts.push(`## Out of Scope\n${spec.outOfScope.map((o) => `- ${o}`).join("\n")}`);
  }

  return parts.join("\n\n");
}

export const EMPTY_TASK_SPEC: TaskSpec = {
  objective: "",
  acceptance: [],
  constraints: [],
  context: "",
  outOfScope: [],
};
