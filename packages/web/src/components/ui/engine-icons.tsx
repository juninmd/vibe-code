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
