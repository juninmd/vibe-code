interface IconProps {
  className?: string;
  size?: number;
}

// Claude / Anthropic — the distinctive upward-pointing chevrons logomark
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
      {/* Anthropic Claude mark — two stacked stylized "mountains" */}
      <path d="M12 2.5 L7 10.5 L12 9 L17 10.5 Z" />
      <path d="M12 8 L5.5 19.5 L9.5 19.5 L12 14 L14.5 19.5 L18.5 19.5 Z" />
    </svg>
  );
}

// OpenAI / Codex — the 6-petal bloom logomark
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
      {/* OpenAI bloom — 6 rounded petals rotated */}
      <g>
        <ellipse cx="12" cy="6.5" rx="2.6" ry="4.5" />
        <ellipse cx="12" cy="6.5" rx="2.6" ry="4.5" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="6.5" rx="2.6" ry="4.5" transform="rotate(120 12 12)" />
        <ellipse cx="12" cy="6.5" rx="2.6" ry="4.5" transform="rotate(180 12 12)" />
        <ellipse cx="12" cy="6.5" rx="2.6" ry="4.5" transform="rotate(240 12 12)" />
        <ellipse cx="12" cy="6.5" rx="2.6" ry="4.5" transform="rotate(300 12 12)" />
      </g>
    </svg>
  );
}

// Pi (Inflection) — π letterform
export function PiIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      {/* π symbol */}
      <path d="M5 7h14" />
      <path d="M9 7v10" />
      <path d="M15 7c0 5.5-1 10-1 10" />
    </svg>
  );
}

// Cursor — the brand cursor arrow mark
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
      {/* Cursor arrow shape */}
      <path d="M4 2 L4 18 L8.5 13.5 L11.5 20 L13.5 19 L10.5 12.5 L17 12.5 Z" />
    </svg>
  );
}

// GitHub Copilot — the distinctive goggles/face logomark
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
      {/* Copilot goggles face */}
      <path d="M12 2C8.5 2 5.5 4 5.5 7.5c0 1.2.4 2.3 1 3.2l-.5.3C4.5 12 3 13.5 3 16c0 2.8 2.5 4.5 5 4.5 1.2 0 2.3-.4 3.2-1h1.6c.9.6 2 1 3.2 1 2.5 0 5-1.7 5-4.5 0-2.5-1.5-4-2.5-5l-.5-.3c.6-.9 1-2 1-3.2C18.5 4 15.5 2 12 2z" />
      <circle cx="9.5" cy="13.5" r="1.5" fill="white" />
      <circle cx="14.5" cy="13.5" r="1.5" fill="white" />
      <circle cx="10" cy="14" r="0.7" />
      <circle cx="15" cy="14" r="0.7" />
    </svg>
  );
}

// AmpCode — lightning bolt (Ampere symbol)
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
      {/* Lightning bolt — Amp */}
      <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
    </svg>
  );
}

// OpenCode — terminal prompt > mark in a rounded square
export function OpenCodeIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 9l4 3-4 3" />
      <path d="M14 15h3" />
    </svg>
  );
}

// Aider — stylized "ai" in a hexagon
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
      {/* Hexagon + "ai" letterform inside */}
      <path d="M12 2l8 4.5v9L12 22l-8-4.5v-9z" opacity="0.25" />
      <path
        d="M9 16L11.5 8 14 16M9.8 13.5h3.4"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Gemini (Google) — the 4-pointed star sparkle, official shape
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
      {/* Gemini 4-pointed star — slim diamond sparkle */}
      <path d="M12 2C12 2 13 8.5 18.5 10 13 11.5 12 18 12 18 12 18 11 11.5 5.5 10 11 8.5 12 2 12 2z" />
      <path
        d="M12 2C12 2 13 8.5 18.5 10 13 11.5 12 18 12 18 12 18 11 11.5 5.5 10 11 8.5 12 2 12 2z"
        transform="rotate(90 12 10)"
        opacity="0.6"
      />
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

// Generic bot fallback icon
export function BotIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      <rect x="4" y="8" width="16" height="12" rx="3" opacity="0.9" />
      <rect x="9" y="11" width="2.5" height="2.5" rx="1" fill="white" />
      <rect x="12.5" y="11" width="2.5" height="2.5" rx="1" fill="white" />
      <path d="M9 17h6" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 4v4M10 4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
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
    icon: OpenClawIcon,
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
    icon: HermesIcon,
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
    icon: KimiIcon,
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
    icon: KiroIcon,
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
  icon: BotIcon,
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
      {/* Claw / talon mark */}
      <path d="M5 1 C5 1 3 4 4 7 C3 7 2 8.5 3 10 C2 10 1.5 12 3 13 L5 13 C4 12 4.5 11 5 10.5 C6 11.5 7 11 7.5 10 C8 11 9.5 11 10 10 C10.5 11.5 12 12 12 13 L14 13 C15 12 14 10 13.5 10 C14.5 8.5 13 7 12 7 C13 4 11 1 11 1 C11 1 10 3 10 5.5 C9.5 5 9 4.5 8 4 C7 4.5 6.5 5 6 5.5 C6 3 5 1 5 1 Z" />
    </svg>
  );
}

export function KimiIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      {/* Moonshot K mark */}
      <path d="M6 3h3v7.5L15 3h4L12 11l7.5 10H15l-6-8.5V21H6z" />
    </svg>
  );
}

export function KiroIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      {/* Kiro stylized K */}
      <path d="M5 3h3.5v7L14 3h4.5L11 11l8 10h-4.5L9 13.5 8.5 14v7H5z" />
    </svg>
  );
}

export function HermesIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="currentColor"
    >
      {/* Hermes — winged H letterform */}
      <path d="M5 4h3v6.5h8V4h3v16h-3v-7H8v7H5z" />
      <path d="M11 2l-2 2h6l-2-2z" opacity="0.7" />
    </svg>
  );
}
