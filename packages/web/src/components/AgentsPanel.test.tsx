// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { AgentTemplate } from "@vibe-code/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsPanel } from "./AgentsPanel";

const list = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    agentTemplates: {
      list: (...args: unknown[]) => list(...args),
    },
  },
}));

function template(overrides: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    slug: "code-reviewer",
    name: "Code Reviewer",
    description: "Reviews a diff for correctness and type safety.",
    category: "Engineering",
    accent: "info",
    instructions: "## Rules\n\nCite file:line for every finding.",
    skills: [
      {
        source_url: "https://example.com/skill",
        cached_name: "react-best-practices",
        cached_description: "React performance guidelines.",
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  list.mockReset();
});

describe("AgentsPanel", () => {
  it("does not fetch while closed", () => {
    render(<AgentsPanel open={false} onClose={() => {}} />);
    expect(list).not.toHaveBeenCalled();
  });

  it("lists the available agent templates", async () => {
    list.mockResolvedValue([
      template(),
      template({ slug: "tutor", name: "Tutor", category: "Writing" }),
    ]);

    render(<AgentsPanel open onClose={() => {}} />);

    expect(await screen.findByText("Code Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Tutor")).toBeInTheDocument();
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
  });

  it("filters templates by search text", async () => {
    list.mockResolvedValue([template(), template({ slug: "tutor", name: "Tutor" })]);

    render(<AgentsPanel open onClose={() => {}} />);
    await screen.findByText("Code Reviewer");

    fireEvent.change(screen.getByPlaceholderText("Search agents…"), {
      target: { value: "tutor" },
    });

    expect(screen.getByText("Tutor")).toBeInTheDocument();
    expect(screen.queryByText("Code Reviewer")).toBeNull();
  });

  it("opens the detail pane with instructions and skills", async () => {
    list.mockResolvedValue([template()]);

    render(<AgentsPanel open onClose={() => {}} />);
    fireEvent.click(await screen.findByText("Code Reviewer"));

    expect(screen.getByText("Instructions")).toBeInTheDocument();
    expect(screen.getByText("Cite file:line for every finding.")).toBeInTheDocument();
    expect(screen.getByText("react-best-practices")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Source/ })).toHaveAttribute(
      "href",
      "https://example.com/skill"
    );
  });

  it("surfaces a load error", async () => {
    list.mockRejectedValue(new Error("registry unavailable"));

    render(<AgentsPanel open onClose={() => {}} />);

    expect(await screen.findByText("registry unavailable")).toBeInTheDocument();
    expect(screen.getByText("No agents found")).toBeInTheDocument();
  });
});
