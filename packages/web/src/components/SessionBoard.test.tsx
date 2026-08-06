// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SessionBoardResponse, SessionCard } from "@vibe-code/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionBoard } from "./SessionBoard";

const list = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    sessions: {
      list: (...args: unknown[]) => list(...args),
    },
  },
}));

function card(overrides: Partial<SessionCard> = {}): SessionCard {
  return {
    id: "opencode:ses_1",
    sessionId: "ses_1",
    source: "opencode",
    title: "Ship the sessions board",
    status: "active",
    project: "vibe-code",
    branch: "main",
    messageCount: 12,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function board(cards: SessionCard[]): SessionBoardResponse {
  return {
    cards,
    sources: [
      { source: "opencode", available: true, roots: ["/store"], cards: cards.length, error: null },
      { source: "claude-code", available: true, roots: ["/store"], cards: 0, error: null },
      { source: "antigravity", available: true, roots: ["/store"], cards: 0, error: null },
    ],
    scannedAt: new Date().toISOString(),
  };
}

function column(name: string): HTMLElement {
  return screen.getByText(name).closest("div")?.parentElement as HTMLElement;
}

beforeEach(() => {
  list.mockReset();
});

describe("SessionBoard", () => {
  it("groups session cards into the derived kanban columns", async () => {
    list.mockResolvedValue(
      board([
        card(),
        card({
          id: "claude-code:s2",
          sessionId: "s2",
          source: "claude-code",
          title: "Idle work",
          status: "idle",
        }),
        card({
          id: "antigravity:s3",
          sessionId: "s3",
          source: "antigravity",
          title: "Old work",
          status: "done",
        }),
      ])
    );

    render(<SessionBoard open onClose={() => {}} />);

    await screen.findByText("Ship the sessions board");
    expect(within(column("Active")).getByText("Ship the sessions board")).toBeTruthy();
    expect(within(column("Idle")).getByText("Idle work")).toBeTruthy();
    expect(within(column("Done")).getByText("Old work")).toBeTruthy();
    expect(within(column("Failed")).getByText("No sessions")).toBeTruthy();
  });

  it("shows only the fields a card carries", async () => {
    list.mockResolvedValue(board([card()]));
    render(<SessionBoard open onClose={() => {}} />);

    const cardEl = (await screen.findByText("Ship the sessions board")).closest(
      "button"
    ) as HTMLElement;

    expect(within(cardEl).getByText("vibe-code")).toBeTruthy();
    expect(within(cardEl).getByText("main")).toBeTruthy();
    expect(within(cardEl).getByText("12 msg")).toBeTruthy();
  });

  it("filters by source", async () => {
    list.mockResolvedValue(
      board([
        card(),
        card({
          id: "claude-code:s2",
          sessionId: "s2",
          source: "claude-code",
          title: "Claude work",
        }),
      ])
    );

    render(<SessionBoard open onClose={() => {}} />);
    await screen.findByText("Claude work");

    fireEvent.click(screen.getByRole("button", { name: /Claude Code/ }));

    expect(screen.queryByText("Ship the sessions board")).toBeNull();
    expect(screen.getByText("Claude work")).toBeTruthy();
  });

  it("filters by title or project text", async () => {
    list.mockResolvedValue(
      board([card(), card({ id: "opencode:s2", sessionId: "s2", title: "Unrelated" })])
    );

    render(<SessionBoard open onClose={() => {}} />);
    await screen.findByText("Unrelated");

    fireEvent.change(screen.getByPlaceholderText("Filter by title or project…"), {
      target: { value: "sessions board" },
    });

    expect(screen.queryByText("Unrelated")).toBeNull();
    expect(screen.getByText("Ship the sessions board")).toBeTruthy();
  });

  it("copies the CLI resume command for a card", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    list.mockResolvedValue(board([card()]));

    render(<SessionBoard open onClose={() => {}} />);
    fireEvent.click(
      (await screen.findByText("Ship the sessions board")).closest("button") as HTMLElement
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("opencode --session ses_1"));
  });

  it("surfaces a scan error and does not claim the machine has no sessions", async () => {
    list.mockRejectedValue(new Error("permission denied"));
    render(<SessionBoard open onClose={() => {}} />);

    expect(await screen.findByText("permission denied")).toBeTruthy();
    expect(screen.getByText("Could not read the session stores")).toBeTruthy();
    expect(screen.queryByText("No CLI sessions found")).toBeNull();
  });

  it("names the missing store per CLI when nothing was found", async () => {
    list.mockResolvedValue({
      cards: [],
      sources: [
        { source: "opencode", available: true, roots: ["/store/opencode"], cards: 0, error: null },
        { source: "claude-code", available: false, roots: [], cards: 0, error: null },
        { source: "antigravity", available: false, roots: [], cards: 0, error: null },
      ],
      scannedAt: new Date().toISOString(),
    } satisfies SessionBoardResponse);

    render(<SessionBoard open onClose={() => {}} />);

    expect(await screen.findByText("No CLI sessions found")).toBeTruthy();
    expect(screen.getByText(/store found \(\/store\/opencode\)/)).toBeTruthy();
    expect(screen.getByText(/set VIBE_CLAUDE_SESSIONS_DIR/)).toBeTruthy();
    expect(screen.getByText(/set VIBE_ANTIGRAVITY_SESSIONS_DIR/)).toBeTruthy();
  });

  it("hides the message counter when a session has no messages yet", async () => {
    list.mockResolvedValue(board([card({ messageCount: 0 })]));
    render(<SessionBoard open onClose={() => {}} />);

    const cardEl = (await screen.findByText("Ship the sessions board")).closest(
      "button"
    ) as HTMLElement;
    expect(within(cardEl).queryByText(/msg$/)).toBeNull();
  });

  it("does not scan while closed", () => {
    render(<SessionBoard open={false} onClose={() => {}} />);
    expect(list).not.toHaveBeenCalled();
  });
});
