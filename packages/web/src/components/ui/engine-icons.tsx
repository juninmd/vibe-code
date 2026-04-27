interface IconProps {
  className?: string;
  size?: number;
}

// Claude / Anthropic — stylized diamond
export function ClaudeIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M8 1L14 8L8 15L2 8Z" />
    </svg>
  );
}

export function CodexIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <rect x="2" y="2" width="12" height="12" rx="2" />
    </svg>
  );
}

export function PiIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M4 4H12V12H4V4Z" />
    </svg>
  );
}

export function CursorAgentIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <polygon points="4,2 14,8 4,14" />
    </svg>
  );
}

export function CopilotIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M8 2C4.686 2 2 4.686 2 8s2.686 6 6 6 6-2.686 6-6-2.686-6-6-6zm0 10c-2.206 0-4-1.794-4-4s1.794-4 4-4 4 1.794 4 4-1.794 4-4 4z" />
    </svg>
  );
}

export function AmpCodeIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M8 1L14 15H2L8 1Z" />
    </svg>
  );
}

// OpenCode — hexagon
export function OpenCodeIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5Z" />
    </svg>
  );
}

// Aider — 4-pointed star
export function AiderIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M8 1L9.5 6.5L15 8L9.5 9.5L8 15L6.5 9.5L1 8L6.5 6.5Z" />
    </svg>
  );
}

// Gemini — Google's two triangles motif
export function GeminiIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M8 2C5.5 5 4 6.5 4 8C4 9.5 5.5 11 8 14C10.5 11 12 9.5 12 8C12 6.5 10.5 5 8 2Z" />
    </svg>
  );
}

// ─── Engine metadata map ──────────────────────────────────────────────────────

export interface EngineMeta {
  icon: typeof ClaudeIcon;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  provider: string;
  install: string;
  docsUrl: string;
  description: string;
}

export const ENGINE_META: Record<string, EngineMeta> = {
  "claude-code": {
    icon: ClaudeIcon,
    label: "claude-code",
    color: "text-amber-300",
    bgColor: "bg-amber-950/30",
    borderColor: "border-amber-800/40",
    provider: "Anthropic",
    install: "npm install -g @anthropic-ai/claude-code",
    docsUrl: "https://claude.ai/code",
    description: "Anthropic's Claude, expert in code architecture and security",
  },
  opencode: {
    icon: OpenCodeIcon,
    label: "opencode",
    color: "text-violet-300",
    bgColor: "bg-violet-950/30",
    borderColor: "border-violet-800/40",
    provider: "OpenCode",
    install: "npm install -g opencode-ai",
    docsUrl: "https://opencode.ai",
    description: "Open-source AI coder supporting multiple models and providers",
  },
  aider: {
    icon: AiderIcon,
    label: "aider",
    color: "text-emerald-300",
    bgColor: "bg-emerald-950/30",
    borderColor: "border-emerald-800/40",
    provider: "Aider",
    install: "pip install aider-install && aider-install",
    docsUrl: "https://aider.chat",
    description: "AI pair programming in your terminal with git integration",
  },
  openclaw: {
    icon: OpenClawIcon as any,
    label: "openclaw",
    color: "text-rose-300",
    bgColor: "bg-rose-950/30",
    borderColor: "border-rose-800/40",
    provider: "OpenClaw",
    install: "npm install -g openclaw",
    docsUrl: "https://github.com/openclaw/openclaw",
    description: "OpenClaw AI agent",
  },
  hermes: {
    icon: HermesIcon as any,
    label: "hermes",
    color: "text-orange-300",
    bgColor: "bg-orange-950/30",
    borderColor: "border-orange-800/40",
    provider: "Hermes",
    install: "npm install -g hermes-ai",
    docsUrl: "https://github.com/hermes/hermes",
    description: "Hermes AI agent",
  },
  gemini: {
    icon: GeminiIcon,
    label: "gemini",
    color: "text-blue-300",
    bgColor: "bg-blue-950/30",
    borderColor: "border-blue-800/40",
    provider: "Google",
    install: "npm install -g @google/gemini-cli",
    docsUrl: "https://github.com/google-gemini/gemini-cli",
    description: "Google's Gemini AI for coding, analysis and reasoning",
  },
  codex: {
    icon: CodexIcon,
    label: "codex",
    color: "text-slate-300",
    bgColor: "bg-slate-950/30",
    borderColor: "border-slate-800/40",
    provider: "OpenAI",
    install: "",
    docsUrl: "https://openai.com/blog/openai-codex",
    description: "OpenAI Codex agent",
  },
  pi: {
    icon: PiIcon,
    label: "pi",
    color: "text-lime-300",
    bgColor: "bg-lime-950/30",
    borderColor: "border-lime-800/40",
    provider: "Inflection",
    install: "",
    docsUrl: "https://pi.ai",
    description: "Pi AI agent",
  },
  "cursor-agent": {
    icon: CursorAgentIcon,
    label: "cursor-agent",
    color: "text-indigo-300",
    bgColor: "bg-indigo-950/30",
    borderColor: "border-indigo-800/40",
    provider: "Cursor",
    install: "",
    docsUrl: "https://cursor.sh",
    description: "Cursor AI agent",
  },
  copilot: {
    icon: CopilotIcon,
    label: "copilot",
    color: "text-sky-300",
    bgColor: "bg-sky-950/30",
    borderColor: "border-sky-800/40",
    provider: "GitHub",
    install: "npm install -g @githubnext/github-copilot-cli",
    docsUrl: "https://github.com/features/copilot",
    description: "GitHub Copilot agent",
  },
  ampcode: {
    icon: AmpCodeIcon,
    label: "ampcode",
    color: "text-pink-300",
    bgColor: "bg-pink-950/30",
    borderColor: "border-pink-800/40",
    provider: "AmpCode",
    install: "",
    docsUrl: "https://ampcode.ai",
    description: "AmpCode AI agent",
  },
};

const DEFAULT_META: EngineMeta = {
  icon: AiderIcon, // generic star as fallback
  label: "",
  color: "text-zinc-300",
  bgColor: "bg-zinc-800/30",
  borderColor: "border-zinc-700/40",
  provider: "",
  install: "",
  docsUrl: "",
  description: "",
};

export function getEngineMeta(name: string): EngineMeta {
  return ENGINE_META[name] ?? DEFAULT_META;
}

export function OpenClawIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M4 1L12 8L4 15L4 1Z" />
    </svg>
  );
}

export function HermesIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <circle cx="8" cy="8" r="6" />
    </svg>
  );
}
