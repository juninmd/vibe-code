interface IconProps {
  className?: string;
  size?: number;
}

// Claude / Anthropic
export function ClaudeIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M12 2L4.5 20.29L5.21 21L12 18L18.79 21L19.5 20.29L12 2Z" />
    </svg>
  );
}

export function CodexIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M22.5 15.5c0-4.42-3.58-8-8-8s-8 3.58-8 8s3.58 8 8 8s8-3.58 8-8zm-8 6c-3.31 0-6-2.69-6-6s2.69-6 6-6s6 2.69 6 6s-2.69 6-6 6zM2 10.5c0-4.42 3.58-8 8-8s8 3.58 8 8s-3.58 8-8 8s-8-3.58-8-8zm8-6c-3.31 0-6 2.69-6 6s2.69 6 6 6s6-2.69 6-6s-2.69-6-6-6z" />
    </svg>
  );
}

export function PiIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
    </svg>
  );
}

export function CursorAgentIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M10.3 19L5.1 14l1.4-1.4 3.8 3.8 7.3-7.3 1.4 1.4L10.3 19z" />
    </svg>
  );
}

export function CopilotIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M12 2C6.47 2 2 6.47 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.08.39-1.98 1.03-2.67-.1-.25-.45-1.27.1-2.64 0 0 .83-.27 2.75 1.02.79-.22 1.63-.33 2.47-.33.84 0 1.68.11 2.47.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.69 1.03 1.58 1.03 2.67 0 3.82-2.34 4.66-4.57 4.91.36.31.67.92.67 1.85v2.77c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12c0-5.53-4.47-10-10-10z" />
    </svg>
  );
}

export function AmpCodeIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M13 2L3 14h9v8l10-12h-9l9-8z" />
    </svg>
  );
}

// OpenCode — stylized O
export function OpenCodeIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
      <path d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" />
    </svg>
  );
}

// Aider — stylized A
export function AiderIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M12 2L3 22h18L12 2zm0 4.84L17.16 18H6.84L12 6.84zM9.5 14h5v2h-5v-2z" />
    </svg>
  );
}

// Gemini — stylized sparkle
export function GeminiIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" />
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
    color: "text-warning",
    bgColor: "bg-warning/15",
    borderColor: "border-warning/30",
    provider: "Anthropic",
    install: "npm install -g @anthropic-ai/claude-code",
    docsUrl: "https://claude.ai/code",
    description: "Anthropic's Claude, expert in code architecture and security",
  },
  opencode: {
    icon: OpenCodeIcon,
    label: "opencode",
    color: "text-accent-text",
    bgColor: "bg-accent-muted",
    borderColor: "border-accent/30",
    provider: "OpenCode",
    install: "npm install -g opencode-ai",
    docsUrl: "https://opencode.ai",
    description: "Open-source AI coder supporting multiple models and providers",
  },
  aider: {
    icon: AiderIcon,
    label: "aider",
    color: "text-success",
    bgColor: "bg-success/15",
    borderColor: "border-success/30",
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
    color: "text-info",
    bgColor: "bg-info/15",
    borderColor: "border-info/30",
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
  kimi: {
    icon: KimiIcon as any,
    label: "kimi",
    color: "text-emerald-300",
    bgColor: "bg-emerald-950/30",
    borderColor: "border-emerald-800/40",
    provider: "Kimi",
    install: "",
    docsUrl: "https://kimi.moonshot.cn",
    description: "Kimi AI agent",
  },
  "kiro-cli": {
    icon: KiroIcon as any,
    label: "kiro-cli",
    color: "text-indigo-300",
    bgColor: "bg-indigo-950/30",
    borderColor: "border-indigo-800/40",
    provider: "Kiro",
    install: "",
    docsUrl: "https://kiro.ai",
    description: "Kiro CLI agent",
  },
};

const DEFAULT_META: EngineMeta = {
  icon: AiderIcon, // generic star as fallback
  label: "",
  color: "text-secondary",
  bgColor: "bg-surface/30",
  borderColor: "border-strong/40",
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

export function KimiIcon({ className = "", size = 16 }: IconProps) {
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

export function KiroIcon({ className = "", size = 16 }: IconProps) {
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
