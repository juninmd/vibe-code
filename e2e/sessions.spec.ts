import { expect, type Page, test } from "@playwright/test";
import { E2E } from "../playwright.config";

/**
 * Session board: the local CLI session stores seeded by the harness must reach
 * the API, land in the right kanban column, and drive the board's filters and
 * copy action in a real browser.
 */

const api = (path: string) => `${E2E.serverUrl}${path}`;

interface Card {
  id: string;
  sessionId: string;
  source: string;
  title: string;
  status: string;
  project: string;
  branch: string | null;
  messageCount: number;
}

async function openBoard(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sessions" }).first().click();
  const board = page.locator("div.fixed.inset-0.z-50");
  await expect(board.getByRole("heading", { name: "Sessions" })).toBeVisible();
  return board;
}

test.describe("GET /api/sessions", () => {
  test("projects each seeded CLI store onto a card", async ({ request }) => {
    const res = await request.get(api("/api/sessions?refresh=true"));
    expect(res.status()).toBe(200);
    const cards = (await res.json()).data.cards as Card[];

    const byId = new Map(cards.map((c) => [c.id, c]));

    const opencode = byId.get("opencode:ses_e2e_active");
    expect(opencode?.title).toBe("E2E opencode active session");
    expect(opencode?.status).toBe("active");
    expect(opencode?.project).toBe("storefront");
    expect(opencode?.messageCount).toBe(2);

    const idle = byId.get("claude-code:e2e-idle");
    expect(idle?.title).toBe("E2E claude idle session");
    expect(idle?.status).toBe("idle");
    expect(idle?.branch).toBe("main");

    const failed = byId.get("claude-code:e2e-failed");
    expect(failed?.status).toBe("failed");

    const done = byId.get("antigravity:e2e-done");
    expect(done?.status).toBe("done");
    expect(done?.project).toBe("mobile");

    // Sub-agent sessions are an implementation detail, never a card.
    expect(byId.has("opencode:ses_e2e_child")).toBe(false);

    // Cards carry only the projected fields.
    expect(Object.keys(opencode ?? {}).sort()).toEqual([
      "branch",
      "createdAt",
      "id",
      "messageCount",
      "project",
      "sessionId",
      "source",
      "status",
      "title",
      "updatedAt",
    ]);
  });

  test("filters by source and rejects an unknown one", async ({ request }) => {
    const filtered = await request.get(api("/api/sessions?source=opencode"));
    const cards = (await filtered.json()).data.cards as Card[];
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.source === "opencode")).toBe(true);

    const bad = await request.get(api("/api/sessions?source=cursor"));
    expect(bad.status()).toBe(400);
  });
});

test.describe("Session board UI", () => {
  test("renders one card per column", async ({ page }) => {
    const board = await openBoard(page);

    await expect(board.getByText("E2E opencode active session")).toBeVisible();
    await expect(board.getByText("E2E claude idle session")).toBeVisible();
    await expect(board.getByText("E2E antigravity done session")).toBeVisible();
    await expect(board.getByText("plan the upgrade")).toBeVisible();
    await expect(board.getByText("E2E opencode subagent")).toHaveCount(0);

    // All four columns are present (headers are uppercased in CSS, not in the DOM).
    for (const label of ["Active", "Idle", "Done", "Failed"]) {
      await expect(board.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("filters by source and by text", async ({ page }) => {
    const board = await openBoard(page);

    await board.getByRole("button", { name: /Claude Code/ }).click();
    await expect(board.getByText("E2E opencode active session")).toHaveCount(0);
    await expect(board.getByText("E2E claude idle session")).toBeVisible();

    await board.getByRole("button", { name: /^All \d/ }).click();
    await board.getByPlaceholder("Filter by title or project…").fill("antigravity");
    await expect(board.getByText("E2E antigravity done session")).toBeVisible();
    await expect(board.getByText("E2E claude idle session")).toHaveCount(0);
  });

  test("a card copies the command that resumes its session", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const board = await openBoard(page);

    await board.getByText("E2E opencode active session").click();
    await expect(page.getByText("Copied: opencode --session ses_e2e_active")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "opencode --session ses_e2e_active"
    );
  });

  test("closes with the button and reopens with the S shortcut", async ({ page }) => {
    const board = await openBoard(page);
    await board.getByRole("button", { name: "Close" }).click();
    await expect(board).toHaveCount(0);

    await page.keyboard.press("s");
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
  });

  test("explains itself instead of showing an empty board when the scan fails", async ({
    page,
  }) => {
    await page.route("**/api/sessions*", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "session_scan_failed", message: "EACCES: permission denied" }),
      })
    );

    const board = await openBoard(page);
    await expect(board.getByText("EACCES: permission denied")).toBeVisible();
    await expect(board.getByText("Could not read the session stores")).toBeVisible();
  });
});
