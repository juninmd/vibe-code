import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  AppliedSkill,
  EngineInfo,
  SkillPlan,
  TaskWithRun,
  TerminalState,
} from "@vibe-code/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({
  api: {
    terminal: {
      state: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      finish: vi.fn(),
      setSkills: vi.fn(),
      previewSkills: vi.fn(),
    },
    skills: { index: vi.fn() },
    engines: { models: vi.fn() },
    tasks: { openEditor: vi.fn() },
  },
}));

vi.mock("../api/client", () => ({ api }));
vi.mock("./DiffViewer", () => ({ DiffViewer: () => <div>diff-viewer</div> }));
vi.mock("./TaskTerminal", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    TaskTerminal: forwardRef((_props: unknown, ref) => {
      useImperativeHandle(ref, () => ({ size: () => ({ cols: 90, rows: 28 }), focus: () => {} }));
      return <div data-testid="xterm" />;
    }),
  };
});

import { TaskPanel } from "./TaskPanel";

const engines: EngineInfo[] = [
  {
    name: "claude-code",
    displayName: "Claude Code",
    available: true,
    version: null,
    activeRuns: 0,
  },
  { name: "opencode", displayName: "OpenCode", available: false, version: null, activeRuns: 0 },
];

const task = {
  id: "task-1",
  title: "Fix login",
  description: "Redirect loops on /login",
  repoId: "repo-1",
  status: "backlog",
  engine: "claude-code",
  model: null,
  priority: "none",
  baseBranch: null,
  branchName: null,
  prUrl: null,
  tags: [],
  repo: { id: "repo-1", name: "fixture", url: "https://github.com/o/r", defaultBranch: "main" },
} as unknown as TaskWithRun;

const idle: TerminalState = {
  taskId: "task-1",
  live: false,
  runId: null,
  engine: null,
  skills: [],
  applied: [],
  skillMode: "auto",
  cwd: null,
};

const builtIn: AppliedSkill = {
  name: "vibe-code-orchestrator",
  source: "always",
  reasons: ["built in"],
};
const autoPlan: SkillPlan = {
  mode: "auto",
  applied: [builtIn, { name: "test-first", source: "auto", reasons: ["matches: tests"] }],
};

function renderPanel(overrides: Partial<TaskWithRun> = {}, props: Record<string, unknown> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onRetryPR: vi.fn().mockResolvedValue(undefined),
    onOpenAdvanced: vi.fn(),
    onClone: vi.fn(),
    onDelete: vi.fn(),
    onNotify: vi.fn(),
    onWsSend: vi.fn(),
  };
  const view = render(
    <TaskPanel
      task={{ ...task, ...overrides }}
      engines={engines}
      connected
      {...handlers}
      {...props}
    />
  );
  return { ...view, ...handlers };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.terminal.state.mockResolvedValue(idle);
  api.terminal.stop.mockResolvedValue({ stopped: true });
  api.terminal.previewSkills.mockResolvedValue(autoPlan);
  api.skills.index.mockResolvedValue({
    skills: [
      { name: "test-first", description: "Write the test first", filePath: "/s/SKILL.md" },
      { name: "review", description: "Review the diff", filePath: "/r/SKILL.md" },
    ],
    rules: [],
    agents: [],
    workflows: [],
  });
  api.engines.models.mockResolvedValue([]);
});

describe("TaskPanel", () => {
  it("offers only the harnesses that are installed", async () => {
    renderPanel();
    expect(await screen.findByRole("button", { name: "Claude Code" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "OpenCode" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Shell" })).toBeEnabled();
  });

  it("shows the plugins picked for the task and starts without forcing a skill list", async () => {
    api.terminal.start.mockResolvedValue({
      ...idle,
      live: true,
      engine: "claude-code",
      skills: ["vibe-code-orchestrator", "test-first"],
      applied: autoPlan.applied,
      cwd: "/w",
    });
    renderPanel();

    const plugins = await screen.findByRole("region", { name: "Plugins" });
    expect(within(plugins).getByText("test-first")).toBeInTheDocument();
    expect(within(plugins).getByText("matches: tests")).toBeInTheDocument();
    expect(within(plugins).getByText("Auto")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /start claude code/i }));

    // No `skills`: the server keeps choosing from the task text.
    await waitFor(() =>
      expect(api.terminal.start).toHaveBeenCalledWith("task-1", {
        engine: "claude-code",
        cols: 90,
        rows: 28,
      })
    );
    expect(await screen.findByRole("button", { name: "Finish" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("makes the plan manual when the operator edits it before starting", async () => {
    api.terminal.previewSkills.mockImplementation(async (_id: string, skills?: string[]) =>
      skills
        ? {
            mode: "manual",
            applied: [
              builtIn,
              ...skills.map((name) => ({ name, source: "manual", reasons: ["picked by you"] })),
            ],
          }
        : autoPlan
    );
    api.terminal.start.mockResolvedValue({ ...idle, live: true, engine: "claude-code", cwd: "/w" });
    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: /^skills/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^review/ }));
    await waitFor(() =>
      expect(api.terminal.previewSkills).toHaveBeenLastCalledWith("task-1", [
        "test-first",
        "review",
      ])
    );
    const plugins = screen.getByRole("region", { name: "Plugins" });
    expect(await within(plugins).findByText("Manual")).toBeInTheDocument();
    expect(within(plugins).getAllByText("picked by you")).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: /start claude code/i }));
    await waitFor(() =>
      expect(api.terminal.start).toHaveBeenCalledWith("task-1", {
        engine: "claude-code",
        skills: ["test-first", "review"],
        cols: 90,
        rows: 28,
      })
    );
  });

  it("can drop a picked skill from its chip and go back to automatic", async () => {
    api.terminal.previewSkills.mockImplementation(async (_id: string, skills?: string[]) =>
      skills
        ? {
            mode: "manual",
            applied: [
              builtIn,
              ...skills.map((name) => ({ name, source: "manual", reasons: ["picked by you"] })),
            ],
          }
        : autoPlan
    );
    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: /^skills/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^review/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove review" }));
    await waitFor(() =>
      expect(api.terminal.previewSkills).toHaveBeenLastCalledWith("task-1", ["test-first"])
    );

    await userEvent.click(screen.getByRole("button", { name: /^skills/i }));
    await userEvent.click(screen.getByRole("button", { name: "Reset to auto" }));
    await waitFor(() =>
      expect(api.terminal.previewSkills).toHaveBeenLastCalledWith("task-1", undefined)
    );
    const plugins = screen.getByRole("region", { name: "Plugins" });
    expect(await within(plugins).findByText("matches: tests")).toBeInTheDocument();
    expect(within(plugins).getByText("Auto")).toBeInTheDocument();
  });

  it("starts a plain shell without skills", async () => {
    api.terminal.start.mockResolvedValue({ ...idle, live: true, engine: "shell", cwd: "/w" });
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Shell" }));
    await userEvent.click(screen.getByRole("button", { name: /start shell/i }));
    await waitFor(() =>
      expect(api.terminal.start).toHaveBeenCalledWith("task-1", {
        engine: "shell",
        cols: 90,
        rows: 28,
      })
    );
  });

  it("shows Resume when the task already has a workspace", async () => {
    api.terminal.state.mockResolvedValue({ ...idle, engine: "claude-code", cwd: "/w" });
    renderPanel({ status: "in_progress" });
    expect(await screen.findByRole("button", { name: /resume claude code/i })).toBeInTheDocument();
  });

  it("surfaces start failures without losing the form", async () => {
    api.terminal.start.mockRejectedValue(new Error("claude is not installed"));
    const { onNotify } = renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /start claude code/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("claude is not installed");
    expect(onNotify).toHaveBeenCalledWith("claude is not installed", "error");
    expect(screen.getByRole("button", { name: /start claude code/i })).toBeEnabled();
  });

  it("finishes and stops a live session", async () => {
    api.terminal.state.mockResolvedValue({ ...idle, live: true, engine: "claude-code", cwd: "/w" });
    api.terminal.finish.mockResolvedValue({});
    const { onNotify } = renderPanel({ status: "in_progress" });

    await userEvent.click(await screen.findByRole("button", { name: "Finish" }));
    await waitFor(() => expect(api.terminal.finish).toHaveBeenCalledWith("task-1"));
    expect(onNotify).toHaveBeenCalledWith(expect.stringContaining("pull request"), "success");

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(api.terminal.stop).toHaveBeenCalledWith("task-1"));
  });

  it("applies skill changes to the live workspace through the server", async () => {
    api.terminal.state.mockResolvedValue({
      ...idle,
      live: true,
      engine: "claude-code",
      cwd: "/w",
      skills: autoPlan.applied.map((skill) => skill.name),
      applied: autoPlan.applied,
    });
    api.terminal.setSkills.mockResolvedValue({
      ...idle,
      live: true,
      engine: "claude-code",
      cwd: "/w",
      skillMode: "manual",
      applied: [builtIn, { name: "review", source: "manual", reasons: ["picked by you"] }],
    });
    renderPanel({ status: "in_progress" });
    // Wait for the live state: before it loads, the idle card has its own picker.
    await screen.findByRole("button", { name: "Finish" });

    await userEvent.click(screen.getByRole("button", { name: /^skills/i }));
    expect(screen.getByText("Changes apply the next time the session starts.")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /^review/ }));

    await waitFor(() =>
      expect(api.terminal.setSkills).toHaveBeenCalledWith("task-1", {
        skills: ["test-first", "review"],
      })
    );
    expect(await screen.findByText("Manual")).toBeInTheDocument();

    api.terminal.setSkills.mockResolvedValue({
      ...idle,
      live: true,
      engine: "claude-code",
      cwd: "/w",
      applied: autoPlan.applied,
    });
    await userEvent.click(screen.getByRole("button", { name: "Reset to auto" }));
    await waitFor(() =>
      expect(api.terminal.setSkills).toHaveBeenLastCalledWith("task-1", { mode: "auto" })
    );
  });

  it("offers Create PR for a reviewed task and Open PR once there is one", async () => {
    const first = renderPanel({ status: "review", branchName: "vibe-code/x" });
    await userEvent.click(await screen.findByRole("button", { name: "Create PR" }));
    expect(first.onRetryPR).toHaveBeenCalledWith("task-1");
    first.unmount();

    renderPanel({ status: "review", prUrl: "https://github.com/o/r/pull/9" });
    expect(await screen.findByRole("link", { name: "Open PR" })).toHaveAttribute(
      "href",
      "https://github.com/o/r/pull/9"
    );
  });

  it("keeps heavy views one click away and out of the way", async () => {
    const { onOpenAdvanced, onDelete } = renderPanel({ branchName: "vibe-code/x" });
    await screen.findByTestId("xterm");

    await userEvent.click(screen.getByRole("button", { name: "changes" }));
    expect(await screen.findByText("diff-viewer")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("button", { name: "Advanced view" }));
    expect(onOpenAdvanced).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete task" }));
    expect(onDelete).toHaveBeenCalledWith("task-1");
  });

  it("opens the workspace in the editor from the menu, reporting failures", async () => {
    api.tasks.openEditor.mockRejectedValueOnce(new Error("no editor found"));
    const { onNotify } = renderPanel({ branchName: "vibe-code/x" });
    await screen.findByTestId("xterm");

    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("button", { name: "Open in editor" }));

    expect(api.tasks.openEditor).toHaveBeenCalledWith("task-1");
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith("no editor found", "error"));
  });

  it("links to the issue a task came from", async () => {
    renderPanel({ issueUrl: "https://github.com/o/r/issues/7", issueNumber: 7 });
    await screen.findByTestId("xterm");
    await userEvent.click(screen.getByRole("button", { name: "details" }));
    expect(screen.getByRole("link", { name: /Linked issue #7/ })).toHaveAttribute(
      "href",
      "https://github.com/o/r/issues/7"
    );
  });

  it("goes back to the board", async () => {
    const { onClose } = renderPanel();
    await act(async () => {});
    await userEvent.click(screen.getByRole("button", { name: "Back to board" }));
    expect(onClose).toHaveBeenCalled();
  });
});
