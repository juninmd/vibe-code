import type { EngineInfo } from "@vibe-code/shared";
import { HARNESS_ENGINES } from "@vibe-code/shared";
import { Button } from "./ui/button";

interface OnboardingProps {
  engines: EngineInfo[];
  onAddRepo: () => void;
  onOpenSettings: () => void;
}

const HARNESS_LABEL: Record<string, string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
};

/** First-run screen: an empty kanban says nothing, so say what to do and in which order. */
export function Onboarding({ engines, onAddRepo, onOpenSettings }: OnboardingProps) {
  const harnesses = HARNESS_ENGINES.map((name) => ({
    name,
    label: HARNESS_LABEL[name] ?? name,
    installed: engines.some((engine) => engine.name === name && engine.available),
  }));
  const anyInstalled = harnesses.some((harness) => harness.installed);

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-lg space-y-8">
        <header className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-text-primary">
            Welcome to vibe-code
          </h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            A kanban where every card is a terminal. Each task runs an agent (Claude Code or
            OpenCode) in its own git worktree, and you can type into it, give it skills, and turn
            the result into a pull request.
          </p>
        </header>

        <ol className="space-y-4">
          <li className="flex gap-4">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
              1
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium text-text-primary">Add a repository</p>
              <p className="text-xs text-text-dimmed">
                Paste a Git URL or a local path, or pick one from GitHub or GitLab.
              </p>
              <Button variant="primary" size="md" onClick={onAddRepo}>
                Add repository
              </Button>
            </div>
          </li>

          <li className="flex gap-4">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/20 text-xs font-bold text-text-secondary">
              2
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium text-text-primary">Connect GitHub or GitLab</p>
              <p className="text-xs text-text-dimmed">
                Optional. A token lets you browse your repositories and open pull requests.
              </p>
              <Button variant="outline" size="sm" onClick={onOpenSettings}>
                Open settings
              </Button>
            </div>
          </li>

          <li className="flex gap-4">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/20 text-xs font-bold text-text-secondary">
              3
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium text-text-primary">
                Create a task, open its terminal
              </p>
              <p className="text-xs text-text-dimmed">
                Press <kbd className="rounded border border-white/20 px-1">N</kbd> or use the Task
                button once a repository is added.
              </p>
            </div>
          </li>
        </ol>

        <section aria-label="Installed agents" className="space-y-2 border-t border-white/10 pt-5">
          <ul className="flex flex-wrap gap-2">
            {harnesses.map((harness) => (
              <li
                key={harness.name}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                  harness.installed
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-white/10 text-text-dimmed"
                }`}
              >
                <span aria-hidden="true">{harness.installed ? "●" : "○"}</span>
                {harness.label}
                <span className="sr-only">
                  {harness.installed ? " installed" : " not installed"}
                </span>
              </li>
            ))}
          </ul>
          {!anyInstalled && (
            <p role="status" className="text-xs text-warning">
              No agent CLI found on this machine. Install Claude Code or OpenCode to run tasks in a
              terminal (a plain shell works without either).
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
